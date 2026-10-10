import { getJson } from '../http';
import { authorVariants, cleanIsbn, isbnPair, titleVariants, titlesMatch, authorListMatches } from '../identity';
import { makeBook } from '../model';
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

export async function searchGoogle(q: string, max: number, opts: CallOpts = {}): Promise<Hit[]> {
  const url = `${GB}/volumes?q=${encodeURIComponent(q)}&maxResults=${Math.min(40, max)}&printType=books&fields=${encodeURIComponent(`items(${FIELDS})`)}`;
  const data = await getJson(withKey(url), { signal: opts.signal });
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
