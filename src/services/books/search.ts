import type { Book } from '../../types';
import { dedupeBooks } from './merge';
import { hasRealSummary, isKnownGenre, shrunkRating } from './model';
import { searchGoogle } from './sources/googleBooks';
import { searchOpenLibrary } from './sources/openLibrary';
import type { Hit } from './sources/types';
import { isUnknownAuthor, sameWork, titleKey } from './identity';
import { isBlocked } from './quality';
import { titleLooksForeign } from './language';
import { rememberExcluded } from './eligibility';
import { localMatches, rememberSeen } from './localIndex';
import { contentTokens, normQ, parseQuery, tokenHits, type ParsedQuery, type SearchScope } from './query';
import { keywordGroups, keywordPhrases, stem } from './keywords';
import { coverBonus } from './coverQuality';
import { diversify, kindAdjust, kindOfQuery, thinRecord } from './genreRank';

/** Editions that are about a book, not the book ("Study Guide", "Summary of ...", boxed sets): ranked far down unless that is what was asked for. */
const NOT_THE_BOOK = /\b(study guide|summary of|summary and analysis|sparknotes|cliffsnotes|workbook|analysis of|box(?:ed)? set|trivia|conversation starters|lesson plans?|teacher'?s? guide|readers? guide|large print|annotated|omnibus|graphic novel adaptation|import and export market|world forecasts?|market (?:research|report|forecast)s?|industry report|(?:19|20)\d\d (?:import|world|global|forecast))\b/i;

/**
 * Books ABOUT a method or a field of study (proceedings, monographs, bibliographies, handbooks of ...): on a broad one-word search they
 * are what crowds out the widely read books ("chess" -> a shelf of old specialist titles above The Queen's Gambit). Only ever a penalty,
 * and only for books few people have rated.
 */
const SPECIALIST = /\b(proceedings|symposium|monograph|bibliograph\w*|dissertation|thesis|journal of|annals of|handbook of|textbook|treatise|encyclopedia of|catalog(?:ue)?|directory|yearbook|lecture notes|conference|congress|statistics|studies in|report of|(?:19|20)\d\d (?:edition|annual))\b/i;

/** How established a book is, 0..1, from how many readers rated it (about 2,000 ratings or more = 1). Only used by a broad search (`popular`). */
const established = (b: Book): number => Math.min(1, Math.log10((b.ratingCount || 0) + 1) / 3.3);

/** An old book that many people have rated: catalogs rarely label books as classics, so this stands in for the label in a "classics" search. */
const classicish = (b: Book): boolean => {
  const year = Number(b.year);
  return !!year && year <= new Date().getFullYear() - 70 && (b.ratingCount || 0) >= 300;
};

/** An exact title match is worth more than anything else can add on top of a weaker title match (popularity, rating, metadata, cover, keywords: at most ~50). */
const EXACT_TITLE = 130;
const EXACT_TITLE_KEY = 125; // the same title once a subtitle / edition note is dropped ("Verity: Special Edition" -> "Verity")
/** A full author name (two or more words, all whole words of the author) must stay above an exact title match by somebody else ("jane austen" -> her books before "Jane Austen: A Life"). */
const AUTHOR_FULL_NAME = 170;
/** One word of an author's name: only counts when the title did not already match, otherwise a title that merely CONTAINS the word and an author who has it stack up above the exact title. */
const AUTHOR_PARTIAL = 60;

/**
 * How well a result fits what was typed, in this order of importance:
 * exact / strong title match -> author match -> keyword match -> popularity (rating count) -> rating quality -> metadata completeness -> cover -> a small recency nudge.
 * The title tier is worth up to 130 (an exact title); everything after it adds only a few points each, so a better title match nearly always
 * wins, and among similar title matches the established, well-documented book comes first. One author word never stacks on a title match.
 *
 * `partial` says the last word typed may be only a beginning ("harry pot"): it then matches the start of a word, a little below a whole word.
 */
export function searchRelevance(b: Book, qTitle: string, qAuthor = '', partial = false, titleOnly = false, popular = false, topic = false): number {
  const q = normQ(qTitle);
  const t = normQ(b.title || '');
  const a = normQ(b.author || '');
  const qTokens = q.split(' ').filter(Boolean);
  const tWords = t.split(' ').filter(Boolean);
  const aWords = a.split(' ').filter(Boolean);
  const need = contentTokens(qTokens);
  const lastNeed = need[need.length - 1];
  let score = 0;
  if (q && t) {
    // The best of: the title as written, and the title without its leading article ("The Threshing" answers to "threshing" and to "threshing fl")
    const titleTier = (tt: string): number => {
      if (tt === q) return EXACT_TITLE;
      if (tt.startsWith(`${q} `)) return 70;
      if (partial && tt.startsWith(q)) return 66; // "harry pot" -> "Harry Potter and the ..."
      if (` ${tt} `.includes(` ${q} `)) return 55;
      if (partial && ` ${tt}`.includes(` ${q}`)) return 50; // a beginning inside the title
      return -1;
    };
    const bare = t.replace(/^(the|a|an) /, '');
    let tier = Math.max(titleTier(t), bare === t ? -1 : titleTier(bare));
    // "Hobbit" finds "The Hobbit" and "Dune: Deluxe Edition" finds "Dune". A word typed in full is a whole-title match even though the box
    // cannot tell "finished" from "still typing" (no trailing space): the old `!partial` rule is why "threshing" ranked below longer titles.
    if (titleKey(b.title) === titleKey(qTitle)) tier = Math.max(tier, EXACT_TITLE_KEY);
    // A broad one-word search (no author): a title match counts for less when almost nobody has rated the book, so the widely read
    // books about the subject are not buried under a shelf of obscure titles that merely contain the word.
    // A topic / genre search ("fantasy", "psychology") asks what a book is ABOUT: a title that merely contains the word ("The Psychology of Fantasy") counts for much less
    const titleWeight = (popular ? 0.45 + 0.55 * established(b) : 1) * (topic ? 0.35 : 1);
    if (tier >= 0) score += tier * titleWeight;
    else {
      const hits = need.reduce((n, w) => n + tokenHits(w, tWords, partial && w === lastNeed), 0);
      score += need.length ? (42 * hits) / need.length : 0;
    }
    // Someone typing an author's name (e.g. "josh silver", or "stephen kin") wants that author's books. A full name (two or more words, every one
    // of them a whole word of the author) is worth more than a title that merely starts with those words, so "jane austen" lists Jane Austen's
    // books before "Jane Austen: A Life" by somebody else (that title alone scores as an exact match, so the author tier is set above it).
    const authorHits = need.map(w => tokenHits(w, aWords, partial && w === lastNeed));
    if (!titleOnly && need.length && authorHits.every(h => h > 0)) {
      const fullName = need.length >= 2 && authorHits.every(h => h === 1);
      // "Threshing": a machinery report with "Threshing" in its title AND in its author name must not beat the book called "Threshing"
      if (fullName) score += AUTHOR_FULL_NAME;
      else if (tier < 55) score += AUTHOR_PARTIAL;
    }
  }
  if (qAuthor) {
    const qa = normQ(qAuthor).split(' ').filter(Boolean);
    const hit = qa.reduce((n, w, i) => n + tokenHits(w, aWords, i === qa.length - 1), 0);
    score += qa.length ? (50 * hit) / qa.length : 0;
  }
  // Keywords: words of the query found in the genre / categories or the description (small: a title or author match always outranks it)
  if (need.length) {
    const about = normQ(`${isKnownGenre(b.genre) ? b.genre : ''} ${hasRealSummary(b.summary) ? b.summary : ''}`).split(' ');
    const k = need.filter(w => w.length > 2 && about.includes(w)).length;
    score += Math.min(12, k * 4);
  }
  const count = b.ratingCount || 0;
  score += Math.min(14, Math.log10(count + 1) * 3.2); // popularity: 100 ratings ~6, 10k ~13
  if (popular) {
    score += 40 * established(b); // a broad search: the books people actually read come first among the books that fit
    const published = Number(b.year);
    if (established(b) < 0.6 && SPECIALIST.test(`${b.title} ${isKnownGenre(b.genre) ? b.genre : ''} ${(b.summary || '').slice(0, 200)}`)) score -= 30;
    if (published && published < 1990 && count < 20) score -= 10; // an old book nobody rates
  }
  if (b.ratingAverage) score += Math.max(-3, Math.min(9, (shrunkRating(b.ratingAverage, count) - 3.5) * 6)); // quality, shrunk for small samples
  let meta = 0;
  if (b.pageCount) meta += 1.5;
  if (b.year) meta += 1;
  if (hasRealSummary(b.summary)) meta += 1.5;
  if (isKnownGenre(b.genre)) meta += 1;
  if (!isUnknownAuthor(b.author)) meta += 1;
  score += meta; // up to 6
  score += coverBonus(b); // having a cover, and a good flat front (Apple, Google) more than an old scan: a tiebreaker among books of the same relevance, never enough to lift a weaker title match over a better one
  const year = Number(b.year);
  const thisYear = new Date().getFullYear();
  if (year && year >= thisYear - 1) score += 2; // a small nudge for brand-new releases
  else if (year && year >= thisYear - 5) score += 1;
  if (NOT_THE_BOOK.test(b.title || '') && !NOT_THE_BOOK.test(qTitle)) score -= 40;
  return score;
}

/* ------------------------------ content filter ------------------------------ */

/**
 * Drop explicit / satanic / demonic books from search results. Each source's own signals (categories, description, publisher, maturity rating)
 * are judged BEFORE the sources are merged, and the verdict applies to the merged book: if one source flags a book, the copy from the other source
 * (which may carry no categories at all) is dropped too. Every blocked book is also remembered, so the Store shelves leave it out as well.
 */
function withoutBlocked(hits: Hit[], q?: ParsedQuery): Book[] {
  // A book asked for by its exact title is still shown when the only thing against it is a description / maturity / publisher signal (a thriller
  // whose blurb mentions sex, for example). A title or a category that is explicit or satanic is never exempt.
  const askedFor = (h: Hit) => {
    const k = titleKey(h.book.title);
    return !!q && !!k && (k === titleKey(q.text) || (!!q.full && k === titleKey(q.full))) && !isBlocked(h.book.title, { subjects: h.flags.subjects });
  };
  const blocked = hits.filter(h => isBlocked(h.book.title, h.flags) && !askedFor(h)).map(h => h.book);
  blocked.forEach(rememberExcluded);
  if (!blocked.length) return hits.map(h => h.book);
  return hits.map(h => h.book).filter(b => !blocked.some(x => x === b || sameWork(x, b)));
}

/* ------------------------------ ranking ------------------------------ */

/** A book the reader already has on a shelf, library or device comes ahead of an equally good match they do not have. */
const OWN_BONUS = 25;
/** A result whose title is not English ranks a little below an equally good English one (never out of the list). */
const FOREIGN_TITLE_PENALTY = 12;

/** In the Title / Author scopes only books whose title / author match what was typed are kept (the last word may be a beginning). */
function inScope(b: Book, q: ParsedQuery): boolean {
  if (q.scope === 'title') {
    const need = contentTokens(q.tokens);
    const words = normQ(b.title).split(' ').filter(Boolean);
    return need.every((w, i) => tokenHits(w, words, q.partial && i === need.length - 1) > 0);
  }
  if (q.scope === 'author') {
    const qa = q.author.split(' ').filter(Boolean);
    const words = normQ(b.author).split(' ').filter(Boolean);
    return qa.every((w, i) => tokenHits(w, words, i === qa.length - 1) > 0);
  }
  return true;
}

/**
 * In the Keywords scope (and for a box that holds only a mood): how many of the typed words (a topic, a theme, a mood) the book's genre, description or title
 * carries, worth up to 60. A word counts through its mapping too (keywords.ts: "cozy" also finds "heartwarming", "classics" also finds an old, widely
 * read book), and "classics" meets "classic". Ranking by this comes AFTER a strong title / author match and next to popularity, never before.
 */
function keywordFit(b: Book, q: ParsedQuery): number {
  const groups = keywordGroups(contentTokens(q.tokens));
  if (!groups.length) return 0;
  const about = new Set(normQ(`${isKnownGenre(b.genre) ? b.genre : ''} ${hasRealSummary(b.summary) ? b.summary : ''} ${b.title || ''}`).split(' ').map(stem));
  const lastGroup = groups[groups.length - 1];
  const hits = groups.reduce((n, g) => {
    if (g.words.some(w => about.has(w)) || (g.classic && classicish(b))) return n + 1;
    // the word still being typed matches the beginning of one
    return n + (q.partial && g === lastGroup && g.text.length >= 3 && [...about].some(w => w.startsWith(g.text)) ? 0.7 : 0);
  }, 0);
  return (60 * hits) / groups.length;
}

/** `skip`: books an earlier page already showed (a later page never repeats them). */
export function rank(books: Book[], q: ParsedQuery, limit: number, own: readonly Book[] = [], skip: readonly Book[] = []): Book[] {
  // A broad search (ONE word, no author, no ISBN: "chess") ranks the widely read books ahead of obscure ones that merely contain the word.
  // Two words are usually a title or an author's name ("jane austen"), where the title / author tiers must stay in charge.
  const byKeywords = q.scope === 'keywords' || q.mood;
  const popular = q.scope !== 'author' && !q.author && !q.isbn && !q.full && q.tokens.length > 0 && (q.tokens.length === 1 || byKeywords); // keyword / mood searches are broad by nature, whatever their length
  // A genre search (the Search tab's genres, and their sub-genres) knows what kind of book it wants: fiction or non-fiction
  const wantKind = byKeywords ? kindOfQuery(q.text) : undefined;
  const sorted = dedupeBooks(books)
    .filter(b => inScope(b, q) && !(skip.length && skip.some(x => x === b || sameWork(x, b))))
    .map((book, order) => ({
      book,
      order,
      // "Death by Water" was split into a title and an author: the better of the two readings counts
      score: Math.max(searchRelevance(book, q.text, q.author, q.partial, q.scope === 'title' || q.scope === 'keywords', popular, byKeywords), q.full ? searchRelevance(book, q.full, '', q.partial, q.scope === 'title') : -Infinity)
        + (byKeywords ? keywordFit(book, q) + thinRecord(book) + kindAdjust(book, wantKind) : 0)
        - (titleLooksForeign(book.title) && !titleLooksForeign(q.text) && !titleLooksForeign(q.full) ? FOREIGN_TITLE_PENALTY : 0) // English editions first, unless a foreign title was typed
        + (own.length && own.some(o => o === book || sameWork(o, book)) ? OWN_BONUS : 0),
    }))
    .sort((x, y) => y.score - x.score || x.order - y.order)
    .map(x => x.book);
  // A broad topic search: one author (a whole series) does not fill the first places
  return (byKeywords ? diversify(sorted) : sorted).slice(0, limit);
}

/* ------------------------------ what is asked of each source ------------------------------ */

type Task = { name: string; run: (candidates: number, signal?: AbortSignal) => Promise<Hit[]> };

/**
 * The requests for one query. Google Books' `intitle:"..."` is a PHRASE match: "harry pot" matches nothing, which is why typing never found a book
 * until the last word was complete. The plain query is used instead (title, author and keywords all count), and Open Library also gets the last
 * word as a wildcard ("harry pot*"). Two requests while typing; a submitted search adds one more (a titles-only Open Library search).
 */
function tasksFor(q: ParsedQuery, final: boolean, io: TaskIo): Task[] {
  // `report`: whether this request's own count is the number shown as "of N" (the main requests only, never the narrower extra ones)
  const ol = (params: Record<string, string>, n: number, signal?: AbortSignal, report = true) =>
    searchOpenLibrary(io.page > 1 ? { ...params, page: String(io.page) } : params, n, { signal, onTotal: report ? t => io.onTotal('ol', t) : undefined });
  const google = (query: string, n: number, signal?: AbortSignal, report = true) =>
    searchGoogle(query, n, { signal, start: io.page > 1 ? (io.page - 1) * Math.min(40, n) : 0, onTotal: report ? t => io.onTotal('google', t) : undefined });
  if (q.isbn) {
    return [
      { name: 'ol', run: (n, signal) => ol({ isbn: q.isbn }, n, signal) },
      { name: 'google', run: (n, signal) => google(`isbn:${q.isbn}`, n, signal) },
    ];
  }
  const text = q.tokens.join(' ');
  const wild = q.partial && q.tokens.length ? `${q.tokens.slice(0, -1).join(' ')} ${q.tokens[q.tokens.length - 1]}*`.trim() : text;
  if (q.scope === 'keywords' || q.mood) {
    // Topics, themes and moods ("cozy mystery", "dragons", "classics"): the catalogs' subject searches first, plus the plain query (descriptions count there).
    // Only the subject requests report the "of N" count, so the number stays about the subject. A mapped word (keywords.ts) adds ONE more phrase:
    // "cozy" is also asked as "cozy mystery", "classics mystery" as "classic mystery".
    const [, more] = keywordPhrases(q.tokens);
    const tasks: Task[] = [
      { name: 'ol', run: (n, signal) => ol({ subject: text }, n, signal) },
      { name: 'google', run: (n, signal) => google(`subject:${text.includes(' ') ? `"${text}"` : text}`, n, signal) },
      { name: 'ol-keyword', run: (n, signal) => ol({ q: wild }, n, signal, false) },
      { name: 'google-keyword', run: (n, signal) => google(text, n, signal, false) },
    ];
    if (more) {
      tasks.push({ name: 'ol-mapped', run: (n, signal) => ol({ subject: more }, n, signal, false) });
      tasks.push({ name: 'google-mapped', run: (n, signal) => google(more, n, signal, false) });
    }
    return tasks;
  }
  if (q.scope === 'title') {
    // Titles only: Open Library's title field; Google's plain query (its intitle: is a phrase match), narrowed to real title matches by rank()
    return [
      { name: 'ol', run: (n, signal) => ol({ title: wild }, n, signal) },
      { name: 'google', run: (n, signal) => google(text, n, signal) },
    ];
  }
  if (q.author && !text) {
    return [
      { name: 'ol', run: (n, signal) => ol({ author: q.author }, n, signal) },
      { name: 'google', run: (n, signal) => google(`inauthor:${q.author}`, n, signal) },
    ];
  }
  if (q.author) {
    const both: Task[] = [
      { name: 'ol', run: (n, signal) => ol({ title: wild, author: q.author }, n, signal) },
      { name: 'google', run: (n, signal) => google(`${text} inauthor:${q.author}`, n, signal) },
      // Open Library's title= + author= fields miss a book catalogued under another title ("The Stranger" by Camus is "L'étranger" there): the plain query finds it
      { name: 'ol-q', run: (n, signal) => ol({ q: `${text} ${q.author}` }, n, signal, false) },
    ];
    if (q.full) both.push({ name: 'google-full', run: (n, signal) => google(q.full, n, signal, false) }); // "x by y" read as one title too
    return both;
  }
  const tasks: Task[] = [
    { name: 'ol', run: (n, signal) => ol({ q: wild }, n, signal) }, // title, author or keyword
    { name: 'google', run: (n, signal) => google(text, n, signal) },
  ];
  if (q.full) tasks.push({ name: 'google-full', run: (n, signal) => google(q.full, n, signal, false) }); // "x by y" read as one title too
  if (final && q.tokens.length > 1) tasks.push({ name: 'ol-title', run: (n, signal) => ol({ title: wild }, n, signal, false) }); // titles only: far fewer unrelated hits
  return tasks;
}

/** Paging and the "N books match" count, shared by the requests of one search. */
interface TaskIo { page: number; onTotal: (source: 'ol' | 'google', n: number) => void }

/**
 * The author a query names, read from what the first sources returned: two to four words, every one of them a whole word of one result's author
 * (the word being typed may be only a beginning). '' when the query is not an author's name, or an author was already given.
 */
function authorNamed(q: ParsedQuery, hits: Hit[]): string {
  if (q.author || q.isbn || q.keywords || q.tokens.length < 2 || q.tokens.length > 4) return '';
  const last = q.tokens[q.tokens.length - 1];
  for (const h of hits) {
    if (isUnknownAuthor(h.book.author)) continue;
    const words = normQ(h.book.author).split(' ').filter(Boolean);
    if (q.tokens.every(t => tokenHits(t, words, q.partial && t === last) > 0) && q.tokens.filter(t => tokenHits(t, words, false) === 1).length >= q.tokens.length - 1) return h.book.author;
  }
  return '';
}

/**
 * A one-word search that turned out to be a TOPIC ("chess"): many titles contain the word and almost none of them is widely read, because the books people
 * know about it (a novel, a history) do not have it in the title. Then, and only then, the catalogs are also asked for books FILED under that subject.
 * Returns the subject, or '' (an ordinary title such as "hobbit" costs no extra request).
 */
function topicNamed(q: ParsedQuery, hits: Hit[]): string {
  if (q.author || q.isbn || q.scope !== 'all' || q.mood || q.tokens.length !== 1 || q.tokens[0].length < 4) return '';
  const word = q.tokens[0];
  const books = dedupeBooks(hits.map(h => h.book));
  const titled = books.filter(b => normQ(b.title).split(' ').includes(word)).length;
  const known = books.filter(b => (b.ratingCount || 0) >= 500).length;
  return titled >= 6 && known < 3 ? word : '';
}

/* ------------------------------ public API ------------------------------ */

export interface SearchProgress {
  /** Every source has answered (or failed): nothing more is coming */
  done: boolean;
  /** Where this update came from: 'local' (books already on this device), 'cache' (the same search a moment ago), or a source */
  from: string;
  /** How many books the catalog says match in all (Open Library's count, else Google's); 0 until a source has said */
  total: number;
}

export interface LiveSearchOptions {
  /** A separate author box */
  author?: string;
  limit?: number;
  signal?: AbortSignal;
  /** A submitted search (Enter / the button), not a keystroke: asks one more source and skips the short-lived memory of an identical search */
  final?: boolean;
  /** Books already on this device are shown first, and remembered (default true) */
  local?: boolean;
  /** Books the reader already has (library, device): matches are shown at once, ahead of the network, and are never remembered or filtered */
  known?: readonly Book[];
  /** Read "title by author" as a title and an author (default true; bulk import has a column for each, so it turns this off) */
  by?: boolean;
  /** Title / Author selector (default: everything) */
  scope?: SearchScope;
  /** 1-based page of results beyond the first (a later page asks each source for its next batch); the on-device matches and the memory of recent searches are for page 1 only */
  page?: number;
  /** Books an earlier page already showed: never repeated */
  exclude?: readonly Book[];
  /** The result list improved: called with the best books so far, as soon as there are any, and again as each source answers */
  onUpdate?: (books: Book[], progress: SearchProgress) => void;
}

/** The same search a moment ago: typing a letter and deleting it costs no network. */
const recent = new Map<string, { at: number; books: Book[]; total: number }>();
const RECENT_MS = 10 * 60 * 1000;
const RECENT_MAX = 40;

/** Books already on this device that match what is typed: synchronous, so a screen can show them in the same frame as the keystroke. */
export function searchLocal(title: string, author = '', limit = 10, known?: readonly Book[], scope: SearchScope = 'all'): Book[] {
  const q = parseQuery(title, author, true, scope);
  const mine = known?.length ? localMatches(q, limit, known) : [];
  return rank([...mine, ...localMatches(q, limit)], q, limit, mine);
}

/**
 * Search for books, answering as early as there is anything to show. `onUpdate` receives: (1) books already on this device, at once; (2) the same
 * search from a moment ago, if there is one; (3) the merged, ranked list again each time Open Library or Google Books answers. The returned promise
 * resolves with the final list. Explicit, satanic and demonic books are left out (quality.ts). Either source being down never hides the other.
 */
export async function searchBooksLive(title: string, o: LiveSearchOptions = {}): Promise<Book[]> {
  const limit = o.limit ?? 10;
  const scope = o.scope ?? 'all';
  const q = parseQuery(title, o.author ?? '', o.by !== false, scope);
  if (!q.text && !q.author && !q.isbn) return [];
  const page = Math.max(1, Math.floor(o.page ?? 1));
  const skip = o.exclude ?? [];
  const useLocal = o.local !== false && page === 1;
  let olTotal = 0;
  let googleTotal = 0;
  const totalNow = () => olTotal || googleTotal;
  const emit = (books: Book[], from: string, done: boolean, total = totalNow()) => { if (!o.signal?.aborted) o.onUpdate?.(books, { done, from, total }); };
  const io: TaskIo = { page, onTotal: (source, n) => { if (source === 'ol') olTotal = n; else googleTotal = n; } };

  const mine = useLocal && o.known?.length ? localMatches(q, limit, o.known) : [];
  const seenHere = useLocal ? localMatches(q, limit) : [];
  const local = [...mine, ...seenHere];
  if (local.length) emit(rank(local, q, limit, mine), 'local', false, 0);

  const memoKey = q.key;
  const memo = useLocal && !o.final ? recent.get(memoKey) : undefined;
  if (memo && Date.now() - memo.at < RECENT_MS) {
    emit(memo.books.slice(0, limit), 'cache', true, memo.total);
    return memo.books.slice(0, limit);
  }

  // A slightly larger candidate set than we show lets ranking pick the best (bulk import asks for 1 and stays small)
  // (capped at 40: Google Books never returns more than 40 per request, and a 100-row Open Library request is the slow half of the first answer)
  const candidates = limit <= 1 ? 10 : Math.min(40, Math.max(16, limit * 2));
  const gathered: Hit[] = [];
  let latest: Book[] = local.length ? rank(local, q, limit, mine) : [];
  const runTask = async (t: Task) => {
    let hits: Hit[] = [];
    try { hits = await t.run(candidates, o.signal); } catch { hits = []; } // a failed source is an empty answer, never an error
    if (o.signal?.aborted) return;
    gathered.push(...hits);
    if (!hits.length) return;
    latest = rank([...withoutBlocked(gathered, q), ...local], q, limit, mine, skip);
    emit(latest, t.name, false);
  };
  await Promise.all(tasksFor(q, !!o.final, io).map(runTask));

  // "jane austen": once a source has shown that the words are an author's name, ask for that author's own books too. Their works are what was
  // wanted, and a plain keyword search is crowded with books ABOUT the author. Only then, so an ordinary title costs no extra request.
  const name = !o.signal?.aborted && page === 1 && scope === 'all' ? authorNamed(q, gathered) : '';
  if (name) {
    await Promise.all([
      runTask({ name: 'ol-author', run: (n, signal) => searchOpenLibrary({ author: name }, n, { signal }) }),
      runTask({ name: 'google-author', run: (n, signal) => searchGoogle(`inauthor:"${name}"`, n, { signal }) }),
    ]);
  }
  const topic = !name && !o.signal?.aborted && page === 1 && scope === 'all' ? topicNamed(q, gathered) : '';
  if (topic) {
    await Promise.all([
      runTask({ name: 'ol-subject', run: (n, signal) => searchOpenLibrary({ subject: topic }, n, { signal }) }),
      runTask({ name: 'google-subject', run: (n, signal) => searchGoogle(`subject:${topic}`, n, { signal }) }),
    ]);
  }
  if (o.signal?.aborted) return [];

  const finalList = rank([...withoutBlocked(gathered, q), ...local], q, limit, mine, skip);
  if (useLocal && finalList.length) {
    rememberSeen(rank([...withoutBlocked(gathered, q), ...seenHere], q, 20)); // the best few of what the sources and earlier searches gave; never the reader's own books
    if (gathered.length) { // a search that every source failed (offline) is never remembered as "the answer"
      recent.delete(memoKey);
      recent.set(memoKey, { at: Date.now(), books: finalList, total: totalNow() });
      if (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value as string);
    }
  }
  emit(finalList, 'done', true);
  return finalList;
}

/**
 * Search for books and wait for the final list (bulk import and tests). Open Library and Google Books are asked AT THE SAME TIME and their answers
 * are merged, because each one misses things the other has: Open Library is slow to list brand-new releases, and a plain title search can be
 * crowded out by unrelated books. Results are de-duplicated by work / edition identity and ranked so the closest title match comes first.
 * Title-only searching is fully supported (author is optional). Never reads or writes the on-device matches or the memory of recent searches.
 */
export async function searchBooks(title: string, author = '', limit = 10, signal?: AbortSignal): Promise<Book[]> {
  return searchBooksLive(title, { author, limit, signal, final: true, local: false, by: false });
}

/** Tests only: forget the memory of recent searches. */
export const forgetRecentSearchesForTests = () => recent.clear();
