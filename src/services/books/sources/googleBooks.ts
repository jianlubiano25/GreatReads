import { getJson, getJsonDetailed } from '../http';
import { authorVariants, cleanIsbn, isbnPair, titleVariants, titlesMatch, authorListMatches } from '../identity';
import { makeBook } from '../model';
import { externalRating } from '../ratings';
import type { CallOpts, Hit } from './types';

const GB = 'https://www.googleapis.com/books/v1';
const FIELDS = 'id,volumeInfo(title,authors,description,categories,pageCount,publishedDate,averageRating,ratingsCount,maturityRating,imageLinks,industryIdentifiers)';

/**
 * Optional API key (higher quota). It ships inside the app, so restrict it to this site's address in the Google Cloud console.
 * Set VITE_GOOGLE_BOOKS_API_KEY in .env.local (local) or in the Cloudflare Pages build variables (deployed).
 */
const apiKey = (): string => {
  try { return String((import.meta as any).env?.VITE_GOOGLE_BOOKS_API_KEY || ''); } catch { return ''; }
};
const withKey = (url: string) => (apiKey() ? `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey())}` : url);

const cleanThumb = (raw: string) => raw.replace(/^http:\/\//i, 'https://').replace('&edge=curl', '');

/** A Google Books volume -> Book. The id format ("gb_<volume id>") is saved in people's libraries: never change it. */
export function gbItemToHit(item: any, fallbackTitle = ''): Hit {
  const v = item?.volumeInfo || {};
  const author = v.authors?.[0] || 'Unknown Author';
  const pages = v.pageCount || 0;
  const ids: { type: string; identifier: string }[] = v.industryIdentifiers || [];
  const isbn = isbnPair(ids.find(i => i.type === 'ISBN_13')?.identifier || ids.find(i => i.type === 'ISBN_10')?.identifier);
  const thumb = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || '';
  const book = makeBook({
    id: `gb_${item?.id || Date.now()}`,
    title: v.title || fallbackTitle,
    author,
    year: v.publishedDate ? String(v.publishedDate).slice(0, 4) : '',
    genre: (v.categories || []).join(', ') || 'General',
    summary: v.description ? String(v.description).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) : `A book by ${author}.`,
    pageCount: pages,
    coverUrl: thumb ? cleanThumb(thumb) : undefined,
    ratingAverage: v.averageRating || undefined,
    ratingCount: v.ratingsCount || undefined,
    spineColor: '#8a5a3b',
    source: 'google',
    identity: { gbVolume: item?.id, ...isbn },
  });
  return { book, flags: { subjects: v.categories, description: v.description ? String(v.description) : undefined, googleMaturity: v.maturityRating } };
}

const searchUrl = (q: string, max: number) => `${GB}/volumes?q=${encodeURIComponent(q)}&maxResults=${Math.min(40, max)}&printType=books&fields=${encodeURIComponent(`items(${FIELDS})`)}`;

export async function searchGoogle(q: string, max: number, opts: CallOpts = {}): Promise<Hit[]> {
  const data = await getJson(withKey(searchUrl(q, max)), { signal: opts.signal });
  return (data?.items || []).map((i: any) => gbItemToHit(i));
}

/** The exact edition for an ISBN. */
export async function googleByIsbn(isbn: string, opts: CallOpts = {}): Promise<Hit | null> {
  const clean = cleanIsbn(isbn);
  if (!clean) return null;
  return (await searchGoogle(`isbn:${clean}`, 3, opts))[0] ?? null;
}

export async function googleVolume(id: string, opts: CallOpts = {}): Promise<Hit | null> {
  const item = await getJson(withKey(`${GB}/volumes/${encodeURIComponent(id)}?fields=${encodeURIComponent(FIELDS)}`), { signal: opts.signal });
  return item ? gbItemToHit(item) : null;
}

/** Best title/author match for a book we only know by name (an ISBN lookup is preferred when there is one). */
export async function findGoogle(q: { title: string; author?: string; isbn?: string }, opts: CallOpts = {}): Promise<Hit | null> {
  if (cleanIsbn(q.isbn)) {
    const exact = await googleByIsbn(q.isbn!, opts);
    if (exact) return exact;
  }
  const generic = !q.author || /^(Unknown|Featured) Author$/.test(q.author);
  // The title as given, without its subtitle, then each half of a dual title; the author as given, then with a hyphen closed up (see openLibrary.ts). The first
  // search that finds the book wins.
  const ok = (h: Hit) => titlesMatch(h.book.title, q.title) && authorListMatches(h.book.author, q.author || '');
  for (const title of titleVariants(q.title)) {
    for (const author of generic ? [undefined] : authorVariants(q.author)) {
      const matches = (await searchGoogle(`intitle:"${title}"${author ? ` inauthor:"${author}"` : ''}`, 6, opts)).filter(ok);
      // Editions of one book differ in whether Google has ratings for them: take the best-rated match, else the first
      const found = matches.reduce<Hit | undefined>((best, h) => (!best || (h.book.ratingCount || 0) > (best.book.ratingCount || 0) ? h : best), undefined);
      if (found || opts.signal?.aborted) return found ?? null;
    }
  }
  return null;
}

/** Most searches spent looking for one book's Google rating (the ISBN edition, then title / author variants). */
const RATING_SEARCHES = 4;

/**
 * The Google Books rating of a book: a hit whose averageRating (1-5) and ratingsCount (above 0) come as a pair. Editions of one book differ in
 * whether Google rates them, so an unrated edition is not the end: the other matching editions of each title / author variant are tried
 * (at most RATING_SEARCHES requests). `failed` tells an API / network error (5xx and 429 retried once) from a successful answer with no
 * rated edition, so an error is never remembered as "Google has no rating".
 */
export async function findGoogleRating(q: { title: string; author?: string; isbn?: string }, opts: CallOpts = {}): Promise<{ hit: Hit | null; failed: boolean }> {
  let failed = false;
  let unavailable = false; // rate limited, down or unreachable (a 400 for one odd query says nothing about the next)
  let searches = 0;
  const bestRated = (hits: Hit[]) => hits.filter(h => externalRating(h.book)).reduce<Hit | null>((b, h) => (!b || (h.book.ratingCount || 0) > (b.book.ratingCount || 0) ? h : b), null);
  const search = async (query: string): Promise<Hit[]> => {
    searches++;
    const r = await getJsonDetailed(withKey(searchUrl(query, 20)), { signal: opts.signal, retries: 1 });
    if (!r.data) {
      failed = true;
      if (r.status === 0 || r.status === 429 || r.status >= 500) unavailable = true;
    }
    return (r.data?.items || []).map((i: any) => gbItemToHit(i));
  };
  const isbn = cleanIsbn(q.isbn);
  if (isbn) {
    const exact = bestRated(await search(`isbn:${isbn}`));
    if (exact) return { hit: exact, failed: false };
  }
  const generic = !q.author || /^(Unknown|Featured) Author$/.test(q.author);
  const ok = (h: Hit) => titlesMatch(h.book.title, q.title) && authorListMatches(h.book.author, q.author || '');
  for (const title of titleVariants(q.title)) {
    for (const author of generic ? [undefined] : authorVariants(q.author)) {
      // After an API error (rate limit, outage) the next searches would fail the same way: stop instead of spending up to 4 x 2 requests per book
      if (searches >= RATING_SEARCHES || unavailable || opts.signal?.aborted) return { hit: null, failed };
      const found = bestRated((await search(`intitle:"${title}"${author ? ` inauthor:"${author}"` : ''}`)).filter(ok));
      if (found) return { hit: found, failed: false };
    }
  }
  return { hit: null, failed };
}
