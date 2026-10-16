import { getJson } from '../http';
import { authorVariants, cleanIsbn, titleVariants, titlesMatch, authorListMatches, workIdFromKey } from '../identity';
import { genreFromSubjects, makeBook } from '../model';
import { looksEnglish, titleLooksForeign } from '../language';
import type { CallOpts, Hit } from './types';

const OL = 'https://openlibrary.org';
const FIELDS = 'key,title,author_name,author_key,first_publish_year,cover_i,cover_edition_key,ratings_average,ratings_count,number_of_pages_median,subject,language';

export interface OlDoc {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  cover_edition_key?: string;
  ratings_average?: number;
  ratings_count?: number;
  number_of_pages_median?: number;
  subject?: string[];
  language?: string[];
}

export type OlSize = 'S' | 'M' | 'L';
export const olCoverById = (id: number, size: OlSize = 'M') => `https://covers.openlibrary.org/b/id/${id}-${size}.jpg`;
/** Exact-edition cover. `default=false` makes a missing cover a 404 (so fallbacks kick in) instead of a blank 1x1 image. */
export const olCoverByIsbn = (isbn: string, size: OlSize = 'L') => `https://covers.openlibrary.org/b/isbn/${isbn}-${size}.jpg?default=false`;

/** Open Library search/trending doc -> Book. The id format ("ol_/works/OL1W" with non-word chars as "_") is saved in people's libraries: never change it. */
export function olDocToHit(doc: OlDoc, idx = 0, genreHint = ''): Hit {
  const author = doc.author_name?.[0] || 'Unknown Author';
  const pages = doc.number_of_pages_median || 0;
  const book = makeBook({
    id: `ol_${(doc.key || String(Date.now() + idx)).replace(/\W/g, '_')}`,
    title: doc.title,
    author,
    year: doc.first_publish_year ? String(doc.first_publish_year) : '',
    genre: genreHint || genreFromSubjects(doc.subject) || 'Book',
    pageCount: pages,
    coverId: doc.cover_i,
    ratingAverage: doc.ratings_average ? Number(doc.ratings_average.toFixed(1)) : undefined,
    ratingCount: doc.ratings_count,
    source: 'openlibrary',
    identity: { olWork: workIdFromKey(doc.key), olEdition: doc.cover_edition_key },
  });
  return { book, flags: { subjects: doc.subject, language: doc.language?.includes('eng') ? 'en' : doc.language?.[0] } };
}

/** Raw search. Never throws; returns [] on any failure. */
export async function searchOpenLibrary(params: Record<string, string>, limit: number, opts: CallOpts = {}): Promise<Hit[]> {
  const q = new URLSearchParams({ limit: String(limit), fields: FIELDS, ...params });
  const data = await getJson(`${OL}/search.json?${q}`, { signal: opts.signal, retries: opts.retries });
  if (typeof data?.numFound === 'number') opts.onTotal?.(data.numFound);
  return ((data?.docs || []) as OlDoc[]).filter(d => d?.title).map((d, i) => olDocToHit(d, i));
}

/** Open Library's own trending lists (what readers are doing right now). Rank 0 = most trending. */
export async function trendingOpenLibrary(period: 'daily' | 'weekly', limit: number, opts: CallOpts = {}): Promise<Array<Hit & { rank: number }> | null> {
  const data = await getJson(`${OL}/trending/${period}.json?limit=${limit}`, { timeout: 10000, retries: 1, signal: opts.signal });
  if (!data) return null;
  return ((data.works || data.docs || []) as OlDoc[]).filter(d => d?.title).map((d, i) => ({ ...olDocToHit(d, i), rank: i }));
}

/**
 * The best Open Library match for a title/author (or an ISBN, which pins the edition's work exactly).
 * Prefers a doc that has a cover, then the one with the most ratings.
 */
export async function findOpenLibrary(q: { title: string; author?: string; isbn?: string }, opts: CallOpts = {}): Promise<Hit | null> {
  const isbn = cleanIsbn(q.isbn);
  let hits = isbn ? await searchOpenLibrary({ isbn }, 3, opts) : [];
  if (!hits.length) {
    // The title as given, without its subtitle, then each half of an "English, Original" dual title; the author as given, then with a hyphen closed up. The first search that finds
    // the book wins, so a book that is listed under a shorter title or another spelling of the name still gets its cover.
    const named = !!q.author && !/^(Unknown|Featured) Author$/.test(q.author);
    const titles = titleVariants(q.title);
    for (const title of titles) {
      for (const author of named ? authorVariants(q.author) : [undefined]) {
        const params: Record<string, string> = { title };
        if (author) params.author = author;
        hits = (await searchOpenLibrary(params, 6, opts)).filter(h => titlesMatch(h.book.title, q.title) && authorListMatches(h.book.author, q.author || ''));
        if (hits.length || opts.signal?.aborted) break;
      }
      if (hits.length || opts.signal?.aborted) break;
    }
  }
  if (!hits.length) {
    // The title= + author= fields found nothing (a book catalogued under another title, e.g. "The Stranger" = "L'étranger"): ask the plain query, still judged by title and author
    const named = !!q.author && !/^(Unknown|Featured) Author$/.test(q.author);
    for (const title of titleVariants(q.title)) {
      hits = (await searchOpenLibrary({ q: named ? `${title} ${q.author}` : title }, 8, opts)).filter(h => titlesMatch(h.book.title, q.title) && authorListMatches(h.book.author, q.author || ''));
      if (hits.length || opts.signal?.aborted) break;
    }
  }
  if (!hits.length) return null;
  const withCover = hits.filter(h => h.book.coverId);
  const pool = withCover.length ? withCover : hits;
  return pool.reduce((p, c) => ((c.book.ratingCount || 0) > (p.book.ratingCount || 0) ? c : p), pool[0]);
}

export async function openLibraryRatings(workId: string, opts: CallOpts = {}): Promise<{ average: number; count: number } | null> {
  const j = await getJson(`${OL}/works/${workId}/ratings.json`, { timeout: 8000, signal: opts.signal });
  const sm = j?.summary;
  return sm?.average ? { average: Number(Number(sm.average).toFixed(1)), count: Number(sm.count) || 0 } : null;
}

export async function openLibraryDescription(workId: string, opts: CallOpts = {}): Promise<string> {
  const w = await getJson(`${OL}/works/${workId}.json`, { timeout: 8000, signal: opts.signal });
  const val = typeof w?.description === 'string' ? w.description : w?.description?.value;
  const text = val ? String(val).split(/\n-{3,}|\n\n/)[0].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').slice(0, 600) : '';
  return looksEnglish(text) ? text : ''; // a blurb in another language is no blurb: Google's English one is used instead
}

/** A work's editions (first 40), read once per session and shared by the page count, the cover list and the English title below: one request, not three. */
const editionsMemo = new Map<string, Promise<any[] | null>>();
function workEditions(workId: string, opts: CallOpts = {}): Promise<any[] | null> {
  const memo = editionsMemo.get(workId);
  if (memo) return memo;
  const p = getJson(`${OL}/works/${workId}/editions.json?limit=40`, { signal: opts.signal }).then(d => (d ? ((d.entries || []) as any[]) : null));
  editionsMemo.set(workId, p);
  p.then(v => { if (v === null || opts.signal?.aborted) editionsMemo.delete(workId); }); // a failure (or a cancelled read) is asked again next time
  if (editionsMemo.size > 200) editionsMemo.delete(editionsMemo.keys().next().value as string);
  return p;
}
/** Tests only. */
export const forgetEditionsForTests = () => editionsMemo.clear();

const isEnglishEdition = (e: any): boolean => {
  const langs: string[] = Array.isArray(e?.languages) ? e.languages.map((l: any) => String(l?.key || '')) : [];
  return !langs.length || langs.includes('/languages/eng');
};

/** Median page count across a work's editions (used when the search index has no page count). */
export async function openLibraryEditionPages(workId: string, opts: CallOpts = {}): Promise<number | undefined> {
  const pages: number[] = ((await workEditions(workId, opts)) || [])
    .map((e: any) => Number(e.number_of_pages))
    .filter((n: number) => Number.isFinite(n) && n >= 30 && n <= 2500)
    .sort((a: number, b: number) => a - b);
  return pages.length ? pages[Math.floor(pages.length / 2)] : undefined;
}

/**
 * Cover ids of a work's editions: the first cover of each English (or language-less) edition, de-duplicated, in the order Open Library lists them.
 * One request; the ids need no image check because Open Library only lists covers it has.
 */
export async function openLibraryEditionCovers(workId: string, max = 8, opts: CallOpts = {}): Promise<number[]> {
  const ids: number[] = [];
  for (const e of ((await workEditions(workId, opts)) || [])) {
    if (!isEnglishEdition(e)) continue; // a translation's jacket is a different book to look at
    const id = (Array.isArray(e?.covers) ? e.covers : []).find((c: unknown) => Number.isInteger(c) && (c as number) > 0);
    if (id && !ids.includes(id)) ids.push(id);
    if (ids.length >= max) break;
  }
  return ids;
}

/**
 * The English title of a work Open Library files under another language's title ("L’étranger" -> "The Stranger"): the title most of its tagged-English
 * editions use (ties: the one listed first). Editions with no language tag are not trusted for this. '' when no edition is tagged English or the work has none.
 */
export async function openLibraryEnglishTitle(workId: string, opts: CallOpts = {}): Promise<string> {
  const counts = new Map<string, { title: string; n: number }>();
  for (const e of ((await workEditions(workId, opts)) || [])) {
    const langs: string[] = Array.isArray(e?.languages) ? e.languages.map((l: any) => String(l?.key || '')) : [];
    const title = typeof e?.title === 'string' ? e.title.trim() : '';
    if (!title || !langs.includes('/languages/eng') || titleLooksForeign(title)) continue;
    const k = title.toLowerCase();
    counts.set(k, { title, n: (counts.get(k)?.n || 0) + 1 });
  }
  return [...counts.values()].reduce<{ title: string; n: number } | undefined>((best, c) => (!best || c.n > best.n ? c : best), undefined)?.title ?? '';
}

/** Re-read one work's search record (ratings, pages, genre, year). */
export async function openLibraryWorkRecord(workId: string, opts: CallOpts = {}): Promise<Hit | null> {
  const hits = await searchOpenLibrary({ q: `key:/works/${workId}` }, 1, opts);
  return hits[0] ?? null;
}
