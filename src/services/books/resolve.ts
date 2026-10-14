import type { Book } from '../../types';
import { dedupeInflight, transientFailureCount } from './http';
import { bump } from './perf';
import { persistentCache } from './cache';
import { authorKey, cleanIsbn, isbnPair, mergeIdentity, titleKey } from './identity';
import { mergeBooks } from './merge';
import { chooseRating, externalRating, setRating, settleSiteRating, SUFFICIENT_RATINGS, type SourceRating } from './ratings';
import type { ContentFlags } from './quality';
import { lookupApple } from './sources/appleBooks';
import { findGoogle, findGoogleRating } from './sources/googleBooks';
import { findOpenLibrary, openLibraryRatings } from './sources/openLibrary';
import type { CallOpts } from './sources/types';

/**
 * Resolve a book we only know by name (and maybe ISBN) into one complete, normalised Book: Open Library supplies the work
 * identity, ratings and pages; Google Books supplies the exact edition for an ISBN, descriptions and covers; Apple Books
 * (optional) adds readers' ratings. Used by the Store shelves, the NYT list and Trending, so a book is only resolved once
 * and every shelf agrees on what it is.
 */

export interface ResolveQuery {
  title: string;
  author?: string;
  isbn?: string; // ISBN-13 or 10: pins the exact edition
  fallbackId?: string | number; // used as the record id when no Open Library work is found
  genreHint?: string;
  apple?: boolean; // also ask Apple Books (adds ratings; one more request)
  /**
   * Also look for Google's rating on the book's other editions when the first Google match is unrated, even though Apple or Open Library
   * already gave a solid rating. Costs up to 4 more Google requests for such a book, so only the offline prefetch script asks for it: that is
   * how a Store book's Google rating reaches the book info without the app asking Google again.
   */
  allSources?: boolean;
}
export interface Resolved {
  book: Book;
  flags: ContentFlags;
  /** Each source's OWN rating count (they are different audiences, so scoring normalises them separately). Absent on older cached results. */
  readers?: { ol?: number; google?: number; apple?: number };
  /** Category words from every source that answered (used to tell fiction from non-fiction). */
  words?: string[];
  /** Every site's OWN valid rating pair found while resolving (never combined; the book carries only the one the ladder chose). Absent on results saved by older versions. */
  ratings?: SourceRating[];
  /** The sites whose answer is final: they were asked and answered (a pair, or really none). A site not listed here was not asked or could not be reached, so the book info asks it itself. */
  checked?: SourceRating['source'][];
  /**
   * Set when a source that could have changed the answer could not be reached (an API error is not "that site has no rating"):
   * Google while the book is unrated, or Apple (asked for) while the rating shown came from a lower step of the ladder. The result is
   * saved with it and reused until `at`; after that the book is asked again, and each failure waits longer (RETRY_BACKOFF_MS).
   * Absent on a result that is final, and on results saved by older versions.
   */
  retry?: { at: number; tries: number };
}

const cache = persistentCache<Resolved | null>('readlife.resolved3', { ttl: 14 * 24 * 60 * 60 * 1000, keepStale: 90 * 24 * 60 * 60 * 1000, max: 250, validate: v => v === null || (!!v && typeof v === 'object' && !!v.book && typeof v.book.title === 'string') });
/**
 * Books no source could place. Remembered only briefly: "not found" is often a dropped connection or a rate limit, and a miss
 * that lasted two weeks (as saved results do) left covers blank long after the network was fine again.
 */
const misses = persistentCache<true>('readlife.resolvedmiss1', { ttl: 2 * 60 * 60 * 1000, max: 300 });
const inflight = new Map<string, Promise<Resolved | null>>();
/**
 * How long a result that is unrated only because Google failed is reused, by number of failures in a row. It is SAVED (with the result), so
 * closing and reopening the app does not repeat the requests; before, it was kept in memory for 2 minutes and every launch asked again.
 */
const RETRY_BACKOFF_MS = [10 * 60 * 1000, 60 * 60 * 1000, 6 * 60 * 60 * 1000];
const retryAfter = (tries: number) => Date.now() + RETRY_BACKOFF_MS[Math.min(tries, RETRY_BACKOFF_MS.length) - 1];

/**
 * One key per BOOK (same as bookKey in identity.ts: the ISBN-13 when there is one, else normalised title + first author), so the Store card, the
 * book info and the NYT list reach the same saved result however each spells the author. `apple` is part of the key: it is a different question.
 */
export const resolveKey = (q: Pick<ResolveQuery, 'title' | 'author' | 'isbn' | 'apple'>) => {
  const isbn = cleanIsbn(q.isbn);
  return `${isbn ? isbnPair(isbn).isbn13 : `${titleKey(q.title)}|${authorKey(q.author || '')}`}${q.apple ? '|a' : ''}`;
};
const keyOf = resolveKey;

export function resolveBook(q: ResolveQuery, opts: CallOpts = {}): Promise<Resolved | null> {
  bump('resolve.calls');
  const key = keyOf(q);
  const hit = cache.get(key);
  const waiting = !!hit?.retry && hit.retry.at > Date.now(); // unrated because Google failed: not asked again yet
  // Only a real result is reused for long. (Older versions also saved "not found" here for 14 days: those are looked up again.)
  if (hit && (!hit.retry || waiting)) {
    bump(waiting ? 'resolve.retryWait' : 'resolve.cacheHit');
    return Promise.resolve({ ...hit, book: { ...hit.book, id: pickId(hit.book, q) } });
  }
  if (misses.get(key)) { bump('resolve.missHit'); return Promise.resolve(null); }
  if (inflight.has(key)) bump('resolve.inflightShared');
  const failedBefore = hit?.retry?.tries || 0;
  // What this book's sites gave last time (also a result past its two weeks, kept for this): a lookup that fails or finds nothing must not erase it
  const had = (hit ?? cache.peek(key)?.value)?.ratings;
  return dedupeInflight(inflight, key, async () => {
    bump('resolve.network');
    const troubleBefore = transientFailureCount();
    const [ol, gb, apLookup] = await Promise.all([
      findOpenLibrary(q, opts),
      findGoogle(q, opts),
      q.apple ? lookupApple(q, opts) : Promise.resolve({ hit: null, failed: false }),
    ]);
    const ap = apLookup.hit;
    const appleFailed = apLookup.failed && !ap;
    const hits = [ol, gb, ap].filter((h): h is NonNullable<typeof h> => !!h);
    if (!hits.length) {
      // An unreachable Apple, or ANY site failing meanwhile (offline, timeout, rate limit, malformed answer), is not "no such book"
      if (!opts.signal?.aborted && !appleFailed && transientFailureCount() === troubleBefore) misses.set(key, true);
      return null;
    }
    let book: Book = hits.map(h => h.book).reduce((a, b) => mergeBooks(a, b));
    book.identity = mergeIdentity(book.identity, isbnPair(q.isbn));
    // Apple's 600x900 art, when Apple (asked for, and matched on title AND author) has the book, is the cover. Every caller that asks Apple
    // (Store cards, the book info, the prefetch script) therefore gets the same cover, instead of each picking the first source that had one.
    if (ap?.book.coverUrl) book = { ...book, coverUrl: ap.book.coverUrl, coverId: undefined };
    // Ratings follow the ladder in ratings.ts: ONE source's average + count, never a mix and never a sum. Apple (when asked for) first,
    // then Open Library (its work-level ratings when the search record has none), then Google. A site with no count has no rating.
    const pairOf = (h: typeof ol, source: 'apple' | 'openlibrary' | 'google') => { const r = externalRating(h?.book); return r && { ...r, source }; };
    let olRating = pairOf(ol, 'openlibrary');
    const workId = book.identity?.olWork;
    if (!olRating && workId) {
      const r = await openLibraryRatings(workId, opts);
      if (r && r.count > 0 && r.average >= 1) olRating = { average: r.average, count: r.count, source: 'openlibrary' };
    }
    const apple = pairOf(ap, 'apple');
    let google = pairOf(gb, 'google');
    let googleFailed = false;
    // Editions of one book differ in whether Google rates them: when the edition found is unrated and nothing above Google is solid,
    // the other matching editions are tried (findGoogleRating), so Google's rating reaches the Store cards the way it reaches the book info.
    const solid = (r?: { count?: number }) => (r?.count || 0) >= SUFFICIENT_RATINGS;
    let googleChecked = !!google;
    if (!google && (q.allSources || (!solid(apple) && !solid(olRating))) && !opts.signal?.aborted) {
      const found = await findGoogleRating({ title: q.title, author: q.author, isbn: q.isbn }, opts);
      google = pairOf(found.hit, 'google');
      googleFailed = found.failed && !found.hit;
      googleChecked = !!google || !googleFailed; // an error is not "Google has no rating"
    }
    // A site that answered nothing usable this time (an error, a timeout, or no rating) keeps the valid pair it gave before; a valid fresh pair replaces it
    const prior = (site: SourceRating['source']) => had?.find(r => r.source === site);
    olRating = settleSiteRating(olRating, prior('openlibrary'));
    google = settleSiteRating(google, prior('google'));
    const appleRating = settleSiteRating(apple, prior('apple'));
    if (google) googleChecked = true;
    book = setRating(book, chooseRating({ apple: appleRating, ol: olRating, google }));
    if (q.genreHint && !book.genre) book.genre = q.genreHint;
    const flags: ContentFlags = {
      subjects: hits.flatMap(h => h.flags.subjects || []),
      description: hits.map(h => h.flags.description).find(Boolean),
      googleMaturity: hits.map(h => h.flags.googleMaturity).find(Boolean),
      appleAdvisory: hits.map(h => h.flags.appleAdvisory).find(Boolean),
      publisher: hits.map(h => h.flags.publisher).find(Boolean),
    };
    const out: Resolved = {
      book,
      flags,
      readers: { ol: ol?.book.ratingCount, google: gb?.book.ratingCount, apple: ap?.book.ratingCount },
      words: hits.flatMap(h => [...(h.flags.subjects || []), h.book.genre]),
      ratings: [olRating, google, appleRating].filter((r): r is SourceRating => !!r),
      checked: [...(olRating ? ['openlibrary' as const] : []), ...(googleChecked ? ['google' as const] : []), ...(q.apple && !appleFailed ? ['apple' as const] : [])],
    };
    if (!opts.signal?.aborted) {
      // Apple (asked for) could not be reached and the stars came from a lower step (or there are none): Apple would have been first, so this is asked again soon
      const appleMissed = appleFailed && book.ratingSource !== 'apple';
      // Google that could not be reached is worth asking again when the book has no rating, and ALWAYS when every site was asked for the offline prefetch:
      // that run saves what Google says as final, and a failure saved as final is never asked again (see isCurrentRecord)
      if ((googleFailed && (q.allSources || !book.ratingAverage)) || appleMissed) out.retry = { at: retryAfter(failedBefore + 1), tries: failedBefore + 1 };
      cache.set(key, out);
    }
    return { ...out, book: { ...out.book, id: pickId(out.book, q) } };
  });
}

/** Open Library work -> its "ol_…" id (the same id search gives); otherwise the caller's own record id. */
function pickId(book: Book, q: ResolveQuery): string | number {
  return String(book.id).startsWith('ol_') ? book.id : (q.fallbackId ?? book.id);
}
