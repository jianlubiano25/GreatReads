import type { Book } from '../../types';
import { getJson } from './http';
import { persistentCache } from './cache';
import { bookKey, identityOf, isUnknownAuthor, primaryAuthor } from './identity';
import { ratingOf, type SourceRating } from './ratings';
import { difficultyFor, genreFromSubjects, plainText } from './model';
import { resolveBook } from './resolve';
import { findApple } from './sources/appleBooks';
import { findGoogle } from './sources/googleBooks';
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

const metaCache = persistentCache<Partial<Book>>('readlife.meta4', { ttl: 30 * 24 * 60 * 60 * 1000, max: 400 }); // ratings and page counts refresh monthly

/**
 * Real pages / genre / year / ratings for a book (curated, store, searched or saved). Cached per book.
 * Open Library answers first. When it has nothing, or has no rating / pages / year, the shared resolver (Open Library + Google Books)
 * fills the gaps. Ratings follow ratings.ts: one source's average + count together, Open Library before Google.
 */
export async function fetchBookMeta(book: Book): Promise<Partial<Book> | null> {
  const key = String(book.id);
  const hit = metaCache.get(key);
  if (hit) return hit;

  const id = identityOf(book);
  const workId = id.olWork;
  const found = (workId ? await openLibraryWorkRecord(workId) : null) ?? (await findOpenLibrary({ title: book.title, author: primaryAuthor(book.author), isbn: id.isbn13 }));
  const d = found?.book;

  const meta: Partial<Book> = {};
  let pages = d?.pageCount;
  const wid = workId || d?.identity?.olWork;
  if (!pages && wid) pages = (await openLibraryEditionPages(wid)) ?? 0;
  if (d?.ratingAverage) { meta.ratingAverage = d.ratingAverage; meta.ratingCount = d.ratingCount; meta.ratingSource = 'openlibrary'; }
  if (d?.year) meta.year = d.year;
  const genre = found ? genreFromSubjects(found.flags.subjects) : '';
  if (genre) meta.genre = genre;
  if (pages) meta.pageCount = pages;

  // Fall back to the resolver for whatever Open Library did not have (a book it does not list, or lists without ratings)
  if (!meta.ratingAverage || !meta.pageCount || !meta.year) {
    const r = await resolveBook({ title: book.title, author: isUnknownAuthor(book.author) ? '' : primaryAuthor(book.author), isbn: id.isbn13 || id.isbn10, fallbackId: book.id });
    const rb = r?.book;
    if (rb) {
      if (!meta.ratingAverage && rb.ratingAverage) { meta.ratingAverage = rb.ratingAverage; meta.ratingCount = rb.ratingCount; meta.ratingSource = rb.ratingSource; } // a pair, from one source
      if (!meta.pageCount && rb.pageCount) meta.pageCount = rb.pageCount;
      if (!meta.year && rb.year) meta.year = rb.year;
      if (!meta.genre) { const g = genreFromSubjects(r!.flags.subjects); if (g) meta.genre = g; }
    }
  }
  if (meta.pageCount) meta.difficulty = difficultyFor(meta.pageCount);

  if (Object.keys(meta).length) metaCache.set(key, meta);
  return Object.keys(meta).length ? meta : null;
}

const sourcesCache = persistentCache<SourceRating[]>('readlife.ratingsrc1', { ttl: 7 * 24 * 60 * 60 * 1000, max: 300 });

/**
 * What each site says about this book, for the book info: Open Library, Google Books and Apple Books, each its own average + count
 * (never combined). Only sites that have a rating are returned. Cached per book; a site that cannot be reached is simply left out.
 */
export async function fetchRatingSources(book: Book, opts: CallOpts = {}): Promise<SourceRating[]> {
  const key = bookKey(book);
  const hit = sourcesCache.get(key);
  if (hit) return hit;

  const id = identityOf(book);
  const author = isUnknownAuthor(book.author) ? '' : primaryAuthor(book.author);
  const q = { title: book.title, author, isbn: id.isbn13 || id.isbn10 };
  const pair = async (source: SourceRating['source'], run: () => Promise<Pick<Book, 'ratingAverage' | 'ratingCount'> | null | undefined>): Promise<SourceRating | null> => {
    try {
      const r = ratingOf(await run());
      return r ? { average: r.average, count: r.count, source } : null;
    } catch {
      return null;
    }
  };
  const [ol, google, apple] = await Promise.all([
    pair('openlibrary', async () => {
      const found = (id.olWork ? await openLibraryWorkRecord(id.olWork, opts) : null) ?? (await findOpenLibrary(q, opts));
      const direct = ratingOf(found?.book);
      if (direct) return found!.book;
      const wid = id.olWork || found?.book.identity?.olWork;
      const r = wid ? await openLibraryRatings(wid, opts) : null;
      return r ? { ratingAverage: r.average, ratingCount: r.count } : null;
    }),
    pair('google', async () => {
      const exact = (await findGoogle(q, opts))?.book;
      if (ratingOf(exact) || !q.isbn) return exact;
      return (await findGoogle({ title: q.title, author: q.author }, opts))?.book ?? exact; // that edition has no ratings: another edition of the book may
    }),
    pair('apple', async () => (await findApple({ title: book.title, author }, opts))?.book),
  ]);
  const out = [ol, google, apple].filter((r): r is SourceRating => !!r);
  if (!opts.signal?.aborted && out.length) sourcesCache.set(key, out);
  return out;
}
