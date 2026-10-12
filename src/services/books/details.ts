import type { Book } from '../../types';
import { getJson } from './http';
import { persistentCache } from './cache';
import { bookKey, identityOf, isUnknownAuthor, primaryAuthor } from './identity';
import { externalRating, type SourceRating } from './ratings';
import { difficultyFor, genreFromSubjects, isKnownGenre, plainText } from './model';
import { prefetchedSourceRatings } from './prefetchIndex';
import { resolveBook } from './resolve';
import { lookupApple } from './sources/appleBooks';
import { findGoogle, findGoogleRating } from './sources/googleBooks';
import type { CallOpts } from './sources/types';
import { findOpenLibrary, openLibraryDescription, openLibraryEditionPages, openLibraryRatings, openLibraryWorkRecord } from './sources/openLibrary';

/** Book detail sheet helpers: a real synopsis and author bio, and refreshed pages / genre / year / ratings. */

const weak = (t?: string) => !t || t.length < 60 || t.startsWith('A distinguished work') || /^.+ by .+\.$/.test(t);

/** Fill in a real synopsis and author bio (Open Library -> Google Books for the synopsis, Wikipedia for the author). */
export async function enrichBookDetails(book: Book): Promise<Book> {
  let summary = book.summary;
  let authorBio = book.authorBio;
  const generic = isUnknownAuthor(book.author);
  const id = identityOf(book);

  if (weak(summary)) {
    let workId = id.olWork;
    if (!workId) workId = (await findOpenLibrary({ title: book.title, author: generic ? '' : book.author, isbn: id.isbn13 }))?.book.identity?.olWork;
    if (workId) summary = (await openLibraryDescription(workId)) || summary;
    if (weak(summary)) {
      const gb = await findGoogle({ title: book.title, author: generic ? '' : book.author, isbn: id.isbn13 || id.isbn10 });
      const desc = gb?.flags.description ? plainText(gb.flags.description) : '';
      if (desc.length > 60) summary = desc.slice(0, 600);
    }
  }

  if ((!authorBio || authorBio.length < 40 || /is an author published worldwide|is the author of this work/.test(authorBio)) && !generic) {
    const w = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(primaryAuthor(book.author).replace(/ /g, '_'))}`, { timeout: 8000 });
    if (w && w.type !== 'disambiguation' && w.extract) authorBio = String(w.extract).split(/(?<=\.)\s/).slice(0, 3).join(' ');
  }
  return { ...book, summary: summary || book.summary, authorBio: authorBio || book.authorBio };
}

const metaCache = persistentCache<Partial<Book>>('readlife.meta6', { ttl: 30 * 24 * 60 * 60 * 1000, max: 400, validate: v => !!v && typeof v === 'object' && !Array.isArray(v) }); // ratings and page counts refresh monthly

/** Meta that found no rating (or was rated without Apple, which could not be reached) is not saved for a month: it is reused briefly, then asked again. */
const META_RETRY_MS = 10 * 60 * 1000;
const metaRetry = new Map<string, { until: number; meta: Partial<Book> }>();

/**
 * Real pages / genre / year / ratings for a book (curated, store, searched or saved). Cached per book (bookKey: the same key the
 * resolver uses, so a book opened from a Store card is already resolved: no second lookup, and the same answer).
 * The shared resolver answers first (Open Library + Google Books + Apple Books); the rating it carries follows ratings.ts: ONE source's
 * average + count, Apple, then Open Library, then Google. Open Library's own work record only fills what the resolver could not find.
 */
export async function fetchBookMeta(book: Book): Promise<Partial<Book> | null> {
  const key = bookKey(book);
  const hit = metaCache.get(key);
  if (hit) return hit;
  const pending = metaRetry.get(key);
  if (pending && pending.until > Date.now()) return pending.meta;

  const id = identityOf(book);
  const r = await resolveBook({ title: book.title, author: isUnknownAuthor(book.author) ? '' : primaryAuthor(book.author), isbn: id.isbn13 || id.isbn10, fallbackId: book.id, apple: true });
  const rb = r?.book;

  const meta: Partial<Book> = {};
  const pair = externalRating(rb);
  if (pair) { meta.ratingAverage = pair.average; meta.ratingCount = pair.count; meta.ratingSource = rb!.ratingSource; } // a pair, from one source
  if (rb?.year) meta.year = rb.year;
  const genre = r ? genreFromSubjects(r.flags.subjects) : '';
  if (genre) meta.genre = genre;
  if (rb?.pageCount) meta.pageCount = rb.pageCount;

  // Whatever the resolver did not find: the book's own Open Library work (an id saved on the book is exact, and is only asked when the resolver
  // found a different book or none: otherwise it already holds that record), then its editions' median page count
  const workId = id.olWork || rb?.identity?.olWork;
  if (id.olWork && rb?.identity?.olWork !== id.olWork && (!meta.ratingAverage || !meta.pageCount || !meta.year || !meta.genre)) {
    const d = (await openLibraryWorkRecord(id.olWork))?.book;
    const olPair = externalRating(d);
    if (!meta.ratingAverage && olPair) { meta.ratingAverage = olPair.average; meta.ratingCount = olPair.count; meta.ratingSource = 'openlibrary'; }
    if (!meta.year && d?.year) meta.year = d.year;
    if (!meta.pageCount && d?.pageCount) meta.pageCount = d.pageCount;
    if (!meta.genre && isKnownGenre(d?.genre)) meta.genre = d!.genre;
  }
  if (!meta.pageCount && workId) {
    const pages = await openLibraryEditionPages(workId);
    if (pages) meta.pageCount = pages;
  }
  if (meta.pageCount) meta.difficulty = difficultyFor(meta.pageCount);

  if (!Object.keys(meta).length) return null;
  if (meta.ratingAverage && !r?.retry) metaCache.set(key, meta);
  else metaRetry.set(key, { until: Date.now() + META_RETRY_MS, meta });
  return meta;
}

const sourcesCache = persistentCache<SourceRating[]>('readlife.ratingsrc3', { ttl: 7 * 24 * 60 * 60 * 1000, max: 300, validate: v => Array.isArray(v) && v.every(r => !!r && typeof r.average === 'number' && typeof r.source === 'string') });
/** When Google or Apple could not be reached, the partial answer is reused for a couple of minutes (not saved), so reopening a sheet does not repeat the requests. */
const PARTIAL_RETRY_MS = 2 * 60 * 1000;
const partialRetry = new Map<string, { until: number; out: SourceRating[] }>();

/**
 * What each site says about this book, for the book info: Open Library, Google Books and Apple Books, each its own average + count
 * (never combined). Only sites with a valid pair (average 1-5 and a count) are returned. Cached per book for a week, except while Google
 * or Apple could not be reached: that is not "that site has no rating", so a partial answer is never saved (a week of "Open Library only")
 * and is asked again after PARTIAL_RETRY_MS.
 */
export async function fetchRatingSources(book: Book, opts: CallOpts = {}): Promise<SourceRating[]> {
  const key = bookKey(book);
  const hit = sourcesCache.get(key);
  if (hit) return hit;
  const pending = partialRetry.get(key);
  if (pending && pending.until > Date.now()) return pending.out;

  const id = identityOf(book);
  const author = isUnknownAuthor(book.author) ? '' : primaryAuthor(book.author);
  const q = { title: book.title, author, isbn: id.isbn13 || id.isbn10 };
  const pair = async (source: SourceRating['source'], run: () => Promise<Pick<Book, 'ratingAverage' | 'ratingCount'> | null | undefined>): Promise<SourceRating | null> => {
    try {
      const r = externalRating(await run());
      return r ? { average: r.average, count: r.count, source } : null;
    } catch {
      return null;
    }
  };
  // 1. What is already known: the Store's prefetched record, then the shared resolver (its saved result when the Store or the NYT list already
  //    resolved this book; otherwise the same lookup fetchBookMeta is making right now, shared with it). Each site that was asked and answered
  //    there is not asked again; only a site that was not asked, or could not be reached, is looked up below.
  const known = new Map<SourceRating['source'], SourceRating>();
  const checked = new Set<SourceRating['source']>();
  const learn = (from?: { ratings?: SourceRating[]; checked?: SourceRating['source'][] } | null) => {
    from?.ratings?.forEach(r => { if (!known.has(r.source)) known.set(r.source, r); });
    from?.checked?.forEach(c => checked.add(c));
  };
  learn(prefetchedSourceRatings(book));
  if (checked.size < 3) learn(await resolveBook({ title: book.title, author, isbn: q.isbn, fallbackId: book.id, apple: true }, opts).catch(() => null));

  let googleFailed = false;
  let appleFailed = false;
  const [ol, google, apple] = await Promise.all([
    checked.has('openlibrary') ? known.get('openlibrary') ?? null : pair('openlibrary', async () => {
      const found = (id.olWork ? await openLibraryWorkRecord(id.olWork, opts) : null) ?? (await findOpenLibrary(q, opts));
      const direct = externalRating(found?.book);
      if (direct) return found!.book;
      const wid = id.olWork || found?.book.identity?.olWork;
      const r = wid ? await openLibraryRatings(wid, opts) : null;
      return r ? { ratingAverage: r.average, ratingCount: r.count } : null;
    }),
    checked.has('google') ? known.get('google') ?? null : pair('google', async () => {
      const r = await findGoogleRating(q, opts);
      googleFailed = r.failed && !r.hit;
      return r.hit?.book;
    }),
    checked.has('apple') ? known.get('apple') ?? null : pair('apple', async () => {
      const r = await lookupApple({ title: book.title, author }, opts);
      appleFailed = r.failed && !r.hit;
      return r.hit?.book;
    }),
  ]);
  const out = [ol, google, apple].filter((r): r is SourceRating => !!r);
  if (!opts.signal?.aborted) {
    if (googleFailed || appleFailed) partialRetry.set(key, { until: Date.now() + PARTIAL_RETRY_MS, out });
    else if (out.length) sourcesCache.set(key, out);
  }
  return out;
}
