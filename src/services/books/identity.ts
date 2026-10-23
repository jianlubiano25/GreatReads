import type { Book, BookIdentity } from '../../types';
import { sameAuthorByAlias } from './authorAliases';

/**
 * The single source of truth for "which book is this?".
 *
 * - `Book.id` is GreatReads' own record id. It is never derived from, or changed by, anything here.
 * - WORK identity: the book as a creation. Open Library work id, or (when there is none) normalised title + author.
 * - EDITION identity: one publication. ISBN-13/10, Open Library edition id, Google Books volume id.
 */

const strip = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

/** "The Fruit Fly: A Novel" -> "fruit fly". Subtitles, brackets and leading articles never block a match. */
export function titleKey(title = ''): string {
  let t = strip(title).replace(/&/g, ' and ');
  t = t.replace(/\(.*?\)|\[.*?\]/g, ' ').split(/\s*[:–—]\s+|\s+-\s+/)[0];
  // Letters of other scripts (\u5909\u306a\u7d75, \u0412\u043e\u0439\u043d\u0430) stay in the key: they used to be erased, leaving '' and a title nothing could ever match
  t = t.replace(/[^a-z0-9\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Arabic}\p{Script=Hebrew}\u3099\u309a\u30fc]+/gu, ' ').replace(/\s+/g, ' ').trim();
  return t.replace(/^(the|a|an) /, '');
}

/** Subtitles that only describe the kind of book, so they never make two titles different books. */
const GENERIC_SUBTITLE = /^(an? |the )?(novel|memoir|story|stories|thriller|mystery|romance|true story|short stories|collection|essays|biography|play|poems?)( of .*)?$/;

/** Publisher / club / retailer wording ("A Reese's Book Club Pick", "Special Edition", "Now a Major Film"): marketing, not part of the title. */
const MARKETING_SUBTITLE = /\b(book club|club pick|pick|edition|bestsell\w*|best seller|winner|award|prize|booker|pulitzer|oprah|reese|now a|major (motion )?picture|netflix|tv series|movie tie|illustrated|annotated|with a new|new (foreword|introduction|afterword)|signed|deluxe|collector)\b/;

/**
 * A subtitle that describes the book rather than names a volume of a series ("Love, Loss, and Liberation"; "How to ..."). Series
 * volumes ("Mistborn: The Final Empire") are short and have no list commas, so they stay distinct. Judged on the raw text, because
 * the commas are gone once it is normalised.
 */
function isDescriptiveSubtitle(raw: string, norm: string): boolean {
  if (MARKETING_SUBTITLE.test(norm)) return true;
  if (/,/.test(raw)) return true; // a list: "Love, Loss, and Liberation"
  if (/^(how|why|what|when|where|who|a |an )/.test(norm)) return true;
  return norm.split(' ').filter(Boolean).length >= 6;
}

/** "Mistborn: The Final Empire" -> "final empire". Empty when there is no subtitle or it only describes / markets the book ("A Novel"). */
export function subtitleKey(title = ''): string {
  const t = strip(title).replace(/&/g, ' and ').replace(/\(.*?\)|\[.*?\]/g, ' ');
  const parts = t.split(/\s*[:–—]\s+|\s+-\s+/);
  if (parts.length < 2) return '';
  const rawSub = parts.slice(1).join(' ');
  const sub = rawSub.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(the|a|an) /, '');
  return !sub || GENERIC_SUBTITLE.test(sub) || /^(a |an |the )?novel\b/.test(sub) || isDescriptiveSubtitle(rawSub, sub) ? '' : sub;
}

/** First author only: "Neil Gaiman & Terry Pratchett" -> "Neil Gaiman"; "King, Lily" -> "Lily King". */
export function primaryAuthor(author = ''): string {
  const parts = author.split(/\s*(?:&|;|\/|\band\b)\s*/i).filter(Boolean);
  const first = parts[0] || '';
  if (parts.length === 1 && /^[^,]+,[^,]+$/.test(first)) {
    const [last, given] = first.split(',');
    return `${given.trim()} ${last.trim()}`;
  }
  return first.trim();
}

/** Normalised full name of the first author: "lily king". */
export function authorKey(author = ''): string {
  return strip(primaryAuthor(author)).replace(/\b(jr|sr|ii|iii|phd|md)\b\.?/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "All the Way to the River: Love, Loss, and Liberation" -> "All the Way to the River". The title as a search engine most often has it. */
export const mainTitle = (title = ''): string => title.split(/\s*[:–—]\s+|\s+-\s+/)[0].trim() || title;

/**
 * "The Discomfort of Evening, De avond is ongemak" is one book under two titles (English, original). When the main title is
 * exactly two comma-separated halves of at least two words each, both halves are returned; otherwise [] ("Hello, Goodbye" and
 * "Shine, Shine, Shine" are single titles).
 */
export function dualTitleParts(title = ''): string[] {
  const parts = mainTitle(title).replace(/\(.*?\)|\[.*?\]/g, ' ').split(/\s*,\s+/).map(p => p.trim()).filter(Boolean);
  if (parts.length !== 2) return [];
  return parts.every(p => titleKey(p).split(' ').filter(Boolean).length >= 2) ? parts : [];
}

/**
 * Narrow English aliases of a famous title catalogued under another language's name (Camus: "L'Etranger" is "The Stranger" / "The Outsider").
 * One-way on purpose: the foreign title also answers to its English names, but the English names do not answer to each other
 * ("The Outsider" by Stephen King must never match "The Stranger"). Authors are still compared by every caller.
 */
const TITLE_ALIASES: Record<string, string[]> = {
  'l etranger': ['stranger', 'outsider'],
  'etranger': ['stranger', 'outsider'],
};

/**
 * The other way round, for searching: what to ask the catalogues so that a search for the ORIGINAL title also brings up the English translation
 * ("L'Étranger" -> "The Stranger"). Each entry is a plain "Title Author" query; a title that is not listed adds nothing.
 */
const ENGLISH_EDITIONS: Record<string, string[]> = {
  'l etranger': ['The Stranger Albert Camus', 'The Outsider Albert Camus'],
  'etranger': ['The Stranger Albert Camus', 'The Outsider Albert Camus'],
};
/**
 * The English title of a few books whose catalogues do not link the translation to the original, so no lookup can find it ("変な絵" -> "Strange Pictures").
 * Only the fallback: a catalogue's own English edition title (resolve.ts) is used first.
 */
const ENGLISH_TITLES: Record<string, string> = { '変な絵': 'Strange Pictures', 'l etranger': 'The Stranger' };
export const knownEnglishTitle = (title = ''): string => {
  // the title as written, in compatibility form (full-width letters, ...), and each half of a dual title ("Strange Pictures, 変な絵")
  for (const k of [titleKey(title), titleKey(title.normalize('NFKC')), ...dualTitleParts(title).map(titleKey)]) if (ENGLISH_TITLES[k]) return ENGLISH_TITLES[k];
  return '';
};
export const englishEditionQueries = (title = ''): string[] => ENGLISH_EDITIONS[titleKey(title)] || [];

/** Every main-title key a title answers to: the whole main title, plus each half of a dual title, plus any narrow alias. */
export function titleKeys(title = ''): string[] {
  // a title on the known-English list is the same book as its English title ("変な絵" / "Strange Pictures"): the saved record and the copy drawn with the English title stay ONE book
  const en = knownEnglishTitle(title);
  const keys = [titleKey(title), ...dualTitleParts(title).map(titleKey), ...(en ? [titleKey(en)] : [])].filter(Boolean);
  return [...new Set([...keys, ...keys.flatMap(k => TITLE_ALIASES[k] || [])])];
}

/**
 * What to type into a catalogue search for this book, best first: the title as given, without its subtitle, then each half of a
 * dual title. Searches stop at the first form that finds the book, so a book listed under a shorter or translated title is still found.
 */
export function titleVariants(title = ''): string[] {
  const t = title.trim();
  return [...new Set([t, mainTitle(t), ...dualTitleParts(t)].map(x => x.trim()).filter(x => x.length > 1))];
}

/**
 * The ways one author's name is written, for a search that must find the book however the catalogue spells it:
 * as given, with a hyphen closed up ("al-Harthi" -> "alHarthi": catalogues write Jokha Alharthi), and with it as a space.
 */
export function authorVariants(author = ''): string[] {
  const out = [author.trim()];
  if (/[-\u2010\u2011\u2013]/.test(author)) out.push(author.replace(/[-\u2010\u2011\u2013]/g, '').trim(), author.replace(/[-\u2010\u2011\u2013]/g, ' ').replace(/\s+/g, ' ').trim());
  // A name with a middle name ("Marieke Lucas Rijneveld") is often catalogued without it ("Marieke Rijneveld") or by its last two parts ("Lucas Rijneveld")
  const parts = author.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 3 && !/[,;&]| and /.test(author)) out.push(`${parts[0]} ${parts[parts.length - 1]}`, parts.slice(-2).join(' '));
  return [...new Set(out.filter(Boolean))];
}

export const isUnknownAuthor = (author = '') => {
  const k = authorKey(author);
  return !k || /^(unknown|featured)( author)?$/.test(k);
};

/* ---------------- ISBN ---------------- */

export function cleanIsbn(raw = ''): string {
  const s = String(raw).replace(/[^0-9xX]/g, '').toUpperCase();
  return s.length === 10 || s.length === 13 ? s : '';
}

export function isbn10to13(isbn10: string): string {
  const core = `978${isbn10.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 ? 3 : 1);
  return core + String((10 - (sum % 10)) % 10);
}

export function isbn13to10(isbn13: string): string {
  if (!isbn13.startsWith('978')) return '';
  const core = isbn13.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? 'X' : String(check));
}

/** Any ISBN-looking string -> both forms where possible. */
export function isbnPair(raw?: string): Pick<BookIdentity, 'isbn10' | 'isbn13'> {
  const s = cleanIsbn(raw);
  if (!s) return {};
  if (s.length === 13) return { isbn13: s, isbn10: isbn13to10(s) || undefined };
  return { isbn10: s, isbn13: isbn10to13(s) };
}

/* ---------------- ids ---------------- */

export const workIdFromKey = (key?: string): string | undefined => key?.match(/OL\d+W/)?.[0];

/**
 * Everything we know about a book's outside identity: what is saved on it, plus what its (legacy) record id reveals.
 * Books saved before identity existed still carry "ol_/works/OL123W"-style or "gb_<volume>" ids, so they get an identity too.
 */
export function identityOf(b: Pick<Book, 'id' | 'identity'>): BookIdentity {
  const out: BookIdentity = { ...(b.identity || {}) };
  const id = String(b.id);
  if (!out.olWork) out.olWork = id.startsWith('ol_') ? id.match(/OL\d+W/)?.[0] : undefined;
  if (!out.gbVolume && id.startsWith('gb_')) out.gbVolume = id.slice(3);
  if (!out.isbn13 && id.startsWith('isbn_')) Object.assign(out, isbnPair(id.slice(5)));
  Object.keys(out).forEach(k => (out as any)[k] === undefined && delete (out as any)[k]);
  return out;
}

export function mergeIdentity(a?: BookIdentity, b?: BookIdentity): BookIdentity | undefined {
  if (!a && !b) return undefined;
  const out: BookIdentity = { ...(b || {}), ...Object.fromEntries(Object.entries(a || {}).filter(([, v]) => v)) };
  return Object.keys(out).length ? out : undefined;
}

/* ---------------- matching ---------------- */

export function authorsCompatible(a = '', b = ''): boolean {
  if (isUnknownAuthor(a) || isUnknownAuthor(b)) return true; // nothing to contradict
  const ka = authorKey(a);
  const kb = authorKey(b);
  if (ka === kb || sameAuthorByAlias(ka, kb)) return true; // (or two names the catalogues say are one author)
  if (ka.replace(/ /g, '') === kb.replace(/ /g, '')) return true; // "Jokha al-Harthi" / "Jokha Alharthi": a hyphen or a space inside a surname
  const pa = ka.split(' ');
  const pb = kb.split(' ');
  if (pa[pa.length - 1] === pb[pb.length - 1] && pa[0][0] === pb[0][0]) return true;
  // One catalogue gives the full name, another drops or adds a name ("Marieke Lucas Rijneveld" / "Lucas Rijneveld"): the shorter name
  // (at least first + last) is contained in the longer one
  const [short, long] = pa.length <= pb.length ? [pa, pb] : [pb, pa];
  return short.length >= 2 && short.every(w => long.includes(w));
}

/** Does a result's author (or author list) include the wanted author? Unknown wanted author matches anything. */
export function authorListMatches(candidate: string | string[] | undefined, want: string): boolean {
  if (isUnknownAuthor(want)) return true;
  const list = Array.isArray(candidate) ? candidate : candidate ? [candidate] : [];
  return list.some(c => authorsCompatible(c, want));
}

/**
 * Same title? The main title must match (either half of an "English, Original" dual title counts). Subtitles only matter when BOTH
 * titles have a series-style one and they clearly differ ("Mistborn: The Final Empire" vs "Mistborn: The Well of Ascension"), so
 * "The Fruit Fly: A Novel", a club or edition subtitle, or a one-sided subtitle still match, and a shortened subtitle still matches the full one.
 */
export const titlesMatch = (a = '', b = ''): boolean => {
  const kb = titleKeys(b);
  if (!titleKeys(a).some(k => kb.includes(k))) return false;
  const sa = subtitleKey(a);
  const sb = subtitleKey(b);
  if (!sa || !sb || sa === sb) return true;
  return sa.startsWith(sb) || sb.startsWith(sa);
};

/** Same publication: a shared ISBN or edition/volume id. */
export function sameEdition(a: Pick<Book, 'id' | 'identity'>, b: Pick<Book, 'id' | 'identity'>): boolean {
  const x = identityOf(a);
  const y = identityOf(b);
  return !!((x.isbn13 && x.isbn13 === y.isbn13) || (x.isbn10 && x.isbn10 === y.isbn10) || (x.olEdition && x.olEdition === y.olEdition) || (x.gbVolume && x.gbVolume === y.gbVolume));
}

/**
 * Same book (any edition)? Shared work or edition ids win; otherwise the titles must match and the authors must not
 * contradict each other. `strict` also requires both authors to be known (used for the library, where merging two
 * different "Unknown Author" books would be wrong).
 */
export function sameWork(a: Pick<Book, 'id' | 'identity' | 'title' | 'author'>, b: Pick<Book, 'id' | 'identity' | 'title' | 'author'>, strict = false): boolean {
  if (sameEdition(a, b)) return true;
  const x = identityOf(a);
  const y = identityOf(b);
  if (x.olWork && x.olWork === y.olWork) return true;
  if (!titlesMatch(a.title, b.title)) return false;
  if (strict && (isUnknownAuthor(a.author) || isUnknownAuthor(b.author))) return false;
  return authorsCompatible(a.author, b.author);
}

/** A stable key for caches: the exact edition if known, else the work, else title + author. */
export function bookKey(b: Pick<Book, 'id' | 'identity' | 'title' | 'author'>): string {
  const i = identityOf(b);
  return i.isbn13 ? `isbn:${i.isbn13}` : i.olWork ? `work:${i.olWork}` : `ta:${titleKey(b.title)}|${authorKey(b.author)}`;
}
