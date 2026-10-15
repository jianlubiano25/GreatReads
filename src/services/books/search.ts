import type { Book } from '../../types';
import { dedupeBooks } from './merge';
import { hasRealSummary, isKnownGenre, shrunkRating } from './model';
import { searchGoogle } from './sources/googleBooks';
import { searchOpenLibrary } from './sources/openLibrary';
import type { Hit } from './sources/types';
import { isUnknownAuthor, sameWork, titleKey } from './identity';
import { isBlocked } from './quality';
import { rememberExcluded } from './eligibility';
import { localMatches, rememberSeen } from './localIndex';
import { contentTokens, normQ, parseQuery, tokenHits, type ParsedQuery } from './query';

/** Editions that are about a book, not the book ("Study Guide", "Summary of ...", boxed sets): ranked far down unless that is what was asked for. */
const NOT_THE_BOOK = /\b(study guide|summary of|summary and analysis|sparknotes|cliffsnotes|workbook|analysis of|box(?:ed)? set|trivia|conversation starters|lesson plans?|teacher'?s? guide|readers? guide)\b/i;

/**
 * How well a result fits what was typed, in this order of importance:
 * exact / strong title match -> author match -> keyword match -> popularity (rating count) -> rating quality -> metadata completeness -> cover -> a small recency nudge.
 * The title tier is worth up to 100; everything after it adds only a few points each, so a better title match nearly always
 * wins, and among similar title matches the established, well-documented book comes first.
 *
 * `partial` says the last word typed may be only a beginning ("harry pot"): it then matches the start of a word, a little below a whole word.
 */
export function searchRelevance(b: Book, qTitle: string, qAuthor = '', partial = false): number {
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
    const same = titleKey(b.title) === titleKey(qTitle);
    if (t === q || (same && !partial)) score += t === q ? 100 : 95; // "Hobbit" finds "The Hobbit" and "Dune: Deluxe Edition" finds "Dune"
    else if (t.startsWith(`${q} `)) score += 70;
    else if (partial && t.startsWith(q)) score += 66; // "harry pot" -> "Harry Potter and the ..."
    else if (` ${t} `.includes(` ${q} `)) score += 55;
    else if (partial && ` ${t}`.includes(` ${q}`)) score += 50; // a beginning inside the title
    else {
      const hits = need.reduce((n, w) => n + tokenHits(w, tWords, partial && w === lastNeed), 0);
      score += need.length ? (42 * hits) / need.length : 0;
    }
    // Someone typing an author's name (e.g. "josh silver", or "stephen kin") wants that author's books
    if (need.length && need.every(w => tokenHits(w, aWords, partial && w === lastNeed) > 0)) score += 60;
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
  if (b.ratingAverage) score += Math.max(-3, Math.min(9, (shrunkRating(b.ratingAverage, count) - 3.5) * 6)); // quality, shrunk for small samples
  let meta = 0;
  if (b.pageCount) meta += 1.5;
  if (b.year) meta += 1;
  if (hasRealSummary(b.summary)) meta += 1.5;
  if (isKnownGenre(b.genre)) meta += 1;
  if (!isUnknownAuthor(b.author)) meta += 1;
  score += meta; // up to 6
  if (b.coverId || b.coverUrl) score += 4;
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
function withoutBlocked(hits: Hit[]): Book[] {
  const blocked = hits.filter(h => isBlocked(h.book.title, h.flags)).map(h => h.book);
  blocked.forEach(rememberExcluded);
  if (!blocked.length) return hits.map(h => h.book);
  return hits.map(h => h.book).filter(b => !blocked.some(x => x === b || sameWork(x, b)));
}

/* ------------------------------ ranking ------------------------------ */

function rank(books: Book[], q: ParsedQuery, limit: number): Book[] {
  return dedupeBooks(books)
    .map((book, order) => ({
      book,
      order,
      // "Death by Water" was split into a title and an author: the better of the two readings counts
      score: Math.max(searchRelevance(book, q.text, q.author, q.partial), q.full ? searchRelevance(book, q.full, '', q.partial) : -Infinity),
    }))
    .sort((x, y) => y.score - x.score || x.order - y.order)
    .slice(0, limit)
    .map(x => x.book);
}

/* ------------------------------ what is asked of each source ------------------------------ */

type Task = { name: string; run: (candidates: number, signal?: AbortSignal) => Promise<Hit[]> };

/**
 * The requests for one query. Google Books' `intitle:"..."` is a PHRASE match: "harry pot" matches nothing, which is why typing never found a book
 * until the last word was complete. The plain query is used instead (title, author and keywords all count), and Open Library also gets the last
 * word as a wildcard ("harry pot*"). Two requests while typing; a submitted search adds one more (a titles-only Open Library search).
 */
function tasksFor(q: ParsedQuery, final: boolean): Task[] {
  if (q.isbn) {
    return [
      { name: 'ol', run: (n, signal) => searchOpenLibrary({ isbn: q.isbn }, n, { signal }) },
      { name: 'google', run: (n, signal) => searchGoogle(`isbn:${q.isbn}`, n, { signal }) },
    ];
  }
  const text = q.tokens.join(' ');
  const wild = q.partial && q.tokens.length ? `${q.tokens.slice(0, -1).join(' ')} ${q.tokens[q.tokens.length - 1]}*`.trim() : text;
  if (q.author && !text) {
    return [
      { name: 'ol', run: (n, signal) => searchOpenLibrary({ author: q.author }, n, { signal }) },
      { name: 'google', run: (n, signal) => searchGoogle(`inauthor:${q.author}`, n, { signal }) },
    ];
  }
  if (q.author) {
    const both: Task[] = [
      { name: 'ol', run: (n, signal) => searchOpenLibrary({ title: wild, author: q.author }, n, { signal }) },
      { name: 'google', run: (n, signal) => searchGoogle(`${text} inauthor:${q.author}`, n, { signal }) },
    ];
    if (q.full) both.push({ name: 'google-full', run: (n, signal) => searchGoogle(q.full, n, { signal }) }); // "x by y" read as one title too
    return both;
  }
  const tasks: Task[] = [
    { name: 'ol', run: (n, signal) => searchOpenLibrary({ q: wild }, n, { signal }) }, // title, author or keyword
    { name: 'google', run: (n, signal) => searchGoogle(text, n, { signal }) },
  ];
  if (q.full) tasks.push({ name: 'google-full', run: (n, signal) => searchGoogle(q.full, n, { signal }) }); // "x by y" read as one title too
  if (final && q.tokens.length > 1) tasks.push({ name: 'ol-title', run: (n, signal) => searchOpenLibrary({ title: wild }, n, { signal }) }); // titles only: far fewer unrelated hits
  return tasks;
}

/* ------------------------------ public API ------------------------------ */

export interface SearchProgress {
  /** Every source has answered (or failed): nothing more is coming */
  done: boolean;
  /** Where this update came from: 'local' (books already on this device), 'cache' (the same search a moment ago), or a source */
  from: string;
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
  /** The result list improved: called with the best books so far, as soon as there are any, and again as each source answers */
  onUpdate?: (books: Book[], progress: SearchProgress) => void;
}

/** The same search a moment ago: typing a letter and deleting it costs no network. */
const recent = new Map<string, { at: number; books: Book[] }>();
const RECENT_MS = 10 * 60 * 1000;
const RECENT_MAX = 40;

/** Books already on this device that match what is typed: synchronous, so a screen can show them in the same frame as the keystroke. */
export function searchLocal(title: string, author = '', limit = 10, known?: readonly Book[]): Book[] {
  const q = parseQuery(title, author);
  return rank([...(known?.length ? localMatches(q, limit, known) : []), ...localMatches(q, limit)], q, limit);
}

/**
 * Search for books, answering as early as there is anything to show. `onUpdate` receives: (1) books already on this device, at once; (2) the same
 * search from a moment ago, if there is one; (3) the merged, ranked list again each time Open Library or Google Books answers. The returned promise
 * resolves with the final list. Explicit, satanic and demonic books are left out (quality.ts). Either source being down never hides the other.
 */
export async function searchBooksLive(title: string, o: LiveSearchOptions = {}): Promise<Book[]> {
  const limit = o.limit ?? 10;
  const q = parseQuery(title, o.author ?? '', o.by !== false);
  if (!q.text && !q.author && !q.isbn) return [];
  const useLocal = o.local !== false;
  const emit = (books: Book[], from: string, done: boolean) => { if (!o.signal?.aborted) o.onUpdate?.(books, { done, from }); };

  const mine = useLocal && o.known?.length ? localMatches(q, limit, o.known) : [];
  const seenHere = useLocal ? localMatches(q, limit) : [];
  const local = [...mine, ...seenHere];
  if (local.length) emit(rank(local, q, limit), 'local', false);

  const memo = useLocal && !o.final ? recent.get(q.key) : undefined;
  if (memo && Date.now() - memo.at < RECENT_MS) {
    emit(memo.books.slice(0, limit), 'cache', true);
    return memo.books.slice(0, limit);
  }

  // A slightly larger candidate set than we show lets ranking pick the best (bulk import asks for 1 and stays small)
  const candidates = limit <= 1 ? 10 : Math.min(24, Math.max(16, limit * 2));
  const gathered: Hit[] = [];
  let latest: Book[] = local.length ? rank(local, q, limit) : [];
  await Promise.all(tasksFor(q, !!o.final).map(async t => {
    let hits: Hit[] = [];
    try { hits = await t.run(candidates, o.signal); } catch { hits = []; } // a failed source is an empty answer, never an error
    if (o.signal?.aborted) return;
    gathered.push(...hits);
    if (!hits.length) return;
    latest = rank([...withoutBlocked(gathered), ...local], q, limit);
    emit(latest, t.name, false);
  }));
  if (o.signal?.aborted) return [];

  const finalList = rank([...withoutBlocked(gathered), ...local], q, limit);
  if (useLocal && finalList.length) {
    rememberSeen(rank([...withoutBlocked(gathered), ...seenHere], q, limit)); // what the sources and earlier searches gave; never the reader's own books
    if (gathered.length) { // a search that every source failed (offline) is never remembered as "the answer"
      recent.delete(q.key);
      recent.set(q.key, { at: Date.now(), books: finalList });
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
