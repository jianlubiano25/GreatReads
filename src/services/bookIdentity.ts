/**
 * Canonical book identity: a quiet, additive layer used ONLY to decide "is this the same book?" when results come from
 * different sources (Open Library, Google Books, Apple Books). It never replaces or edits a saved `Book.id`, and nothing
 * here is required for a book to work, so older saved books (which have no `canon`) behave exactly as before.
 */

export interface BookCanon {
  olWork?: string; // Open Library work id, e.g. "OL123W"
  olEdition?: string; // Open Library edition id, e.g. "OL456M"
  isbn10?: string;
  isbn13?: string;
  gbId?: string; // Google Books volume id
  titleKey: string; // normalised title (no subtitle, no leading "the/a/an")
  authorKey: string; // normalised full author name, "first last"
}

const strip = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

/** "The Fruit Fly: A Novel" -> "fruit fly". Subtitles, brackets and leading articles never block a match. */
export function titleKey(title = ''): string {
  let t = strip(title).replace(/&/g, ' and ');
  t = t.replace(/\(.*?\)|\[.*?\]/g, ' ').split(/\s*[:–—]\s+|\s+-\s+/)[0];
  t = t.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.replace(/^(the|a|an) /, '');
}

/** "King, Lily" / "Lily  King" / "LILY KING Jr." -> "lily king" */
export function authorKey(author = ''): string {
  let a = strip(author);
  if (a.includes(',')) {
    const [last, first] = a.split(',', 2);
    a = `${first} ${last}`;
  }
  return a.replace(/\b(jr|sr|ii|iii|phd|md)\b\.?/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const isUnknownAuthor = (k: string) => !k || /^(unknown|featured) author$/.test(k);

/** Digits only (X allowed last); returns '' unless it is a plausible ISBN-10/13. */
export function cleanIsbn(raw = ''): string {
  const s = raw.replace(/[^0-9xX]/g, '').toUpperCase();
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

/** Any ISBN-ish string -> both forms where possible. */
export function isbnPair(raw?: string): { isbn10?: string; isbn13?: string } {
  const s = cleanIsbn(raw);
  if (!s) return {};
  if (s.length === 13) return { isbn13: s, isbn10: isbn13to10(s) || undefined };
  return { isbn10: s, isbn13: isbn10to13(s) };
}

export function makeCanon(parts: Partial<BookCanon> & { title?: string; author?: string }): BookCanon {
  const { title, author, ...ids } = parts;
  return {
    ...ids,
    titleKey: ids.titleKey ?? titleKey(title),
    authorKey: ids.authorKey ?? authorKey(author),
  };
}

export const workIdFromKey = (key?: string): string | undefined => key?.match(/OL\d+W/)?.[0];

/** Pick the usable ISBN from Google's industryIdentifiers. */
export function canonFromGoogle(item: any, title: string, author: string): BookCanon {
  const ids: { type: string; identifier: string }[] = item?.volumeInfo?.industryIdentifiers || [];
  const i13 = ids.find(i => i.type === 'ISBN_13')?.identifier;
  const i10 = ids.find(i => i.type === 'ISBN_10')?.identifier;
  return makeCanon({ title, author, gbId: item?.id, ...isbnPair(i13 || i10) });
}

/** Do two author strings plausibly name the same person? (full-name match, or same surname + first initial) */
export function authorsCompatible(a: string, b: string): boolean {
  const ka = authorKey(a);
  const kb = authorKey(b);
  if (isUnknownAuthor(ka) || isUnknownAuthor(kb)) return true; // nothing to contradict
  if (ka === kb) return true;
  const pa = ka.split(' ');
  const pb = kb.split(' ');
  if (pa[pa.length - 1] !== pb[pb.length - 1]) return false;
  return pa[0][0] === pb[0][0];
}

/** Does `candidate` (a result's author list or string) include the wanted author? */
export function authorListMatches(candidate: string | string[] | undefined, want: string): boolean {
  if (!want || isUnknownAuthor(authorKey(want))) return true;
  const list = Array.isArray(candidate) ? candidate : candidate ? candidate.split(/\s*(?:,|&| and )\s*/) : [];
  if (!list.length) return false;
  return list.some(c => authorsCompatible(c, want));
}

export function titlesMatch(a: string, b: string): boolean {
  const ka = titleKey(a);
  const kb = titleKey(b);
  return !!ka && ka === kb;
}

/**
 * Same book? Shared hard ids win (work id, ISBN, Google volume id); otherwise the normalised title must match and the
 * authors must not contradict each other.
 */
export function sameCanon(a?: BookCanon, b?: BookCanon): boolean {
  if (!a || !b) return false;
  if (a.olWork && a.olWork === b.olWork) return true;
  if (a.isbn13 && a.isbn13 === b.isbn13) return true;
  if (a.isbn10 && a.isbn10 === b.isbn10) return true;
  if (a.gbId && a.gbId === b.gbId) return true;
  if (a.olEdition && a.olEdition === b.olEdition) return true;
  return !!a.titleKey && a.titleKey === b.titleKey && authorsCompatible(a.authorKey, b.authorKey);
}

/** Union of two canons (first one wins on conflicts): lets a merged result carry every id we learned. */
export function mergeCanon(a?: BookCanon, b?: BookCanon): BookCanon | undefined {
  if (!a || !b) return a || b;
  return {
    olWork: a.olWork || b.olWork,
    olEdition: a.olEdition || b.olEdition,
    isbn10: a.isbn10 || b.isbn10,
    isbn13: a.isbn13 || b.isbn13,
    gbId: a.gbId || b.gbId,
    titleKey: a.titleKey || b.titleKey,
    authorKey: isUnknownAuthor(a.authorKey) ? b.authorKey || a.authorKey : a.authorKey,
  };
}
