import { Book } from '../types';
import { sameBook } from './bookMatch';
import type { CuratedShelf } from '../data/storeCatalog';
import resolvedData from '../data/storeResolved.json';

/** Output of `npm run prefetch:store`: covers + combined ratings bundled with the app. */
const RESOLVED = resolvedData as unknown as Record<string, (Partial<Book> | null)[]>;

export interface SearchDoc {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  ratings_average?: number;
  ratings_count?: number;
  number_of_pages_median?: number;
  subject?: string[];
  author_key?: string[];
}

export function getCoverUrl(coverId?: number, size: 'S' | 'M' | 'L' = 'M', customUrl?: string): string {
  if (customUrl) return customUrl;
  if (!coverId || coverId <= 0) return '';
  return `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg`;
}

/**
 * Search books via OpenLibrary with Google Books API fallback
 */
export async function searchOnlineBooks(title: string, author: string = '', limit = 10, outerSignal?: AbortSignal): Promise<Book[]> {
  const qTitle = title.trim();
  const qAuthor = author.trim();
  if (!qTitle) return [];

  // Try Open Library first
  try {
    const params = new URLSearchParams({
      limit: String(limit),
      fields: 'key,title,author_name,author_key,first_publish_year,cover_i,ratings_average,ratings_count,number_of_pages_median,subject',
    });
    if (qAuthor) {
      params.append('title', qTitle);
      params.append('author', qAuthor);
    } else {
      params.append('q', qTitle); // title, author or keyword
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const onOuterAbort = () => controller.abort();
    outerSignal?.addEventListener('abort', onOuterAbort);
    let res: Response;
    try {
      res = await fetch(`https://openlibrary.org/search.json?${params.toString()}`, {
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      outerSignal?.removeEventListener('abort', onOuterAbort);
    }

    if (res.ok) {
      const data = await res.json();
      const docs: SearchDoc[] = data.docs || [];
      if (docs.length > 0) {
        return docs.map((doc, idx) => {
          const authorName = (doc.author_name && doc.author_name[0]) || 'Unknown Author';
          const year = doc.first_publish_year ? String(doc.first_publish_year) : '';
          const pages = doc.number_of_pages_median || 0;
          const genre = genreFromSubjects(doc.subject) || 'Book';

          const bookId = `ol_${(doc.key || String(Date.now() + idx)).replace(/\W/g, '_')}`;

          return {
            id: bookId,
            title: doc.title,
            author: authorName,
            shelf: 'mine',
            difficulty: !pages ? 0 : pages > 450 ? 3 : pages > 250 ? 2 : 1,
            isOnDevice: false,
            year,
            genre,
            summary: `A distinguished work by ${authorName}.`,
            authorBio: '',
            pageCount: pages,
            coverId: doc.cover_i,
            ratingAverage: doc.ratings_average ? Number(doc.ratings_average.toFixed(1)) : undefined,
            ratingCount: doc.ratings_count,
            spineColor: '#6b6f80',
            source: 'openlibrary',
            addedAt: Date.now(),
          };
        });
      }
    }
  } catch (err) {
    console.warn('Open Library search failed, attempting Google Books fallback...', err);
  }

  if (outerSignal?.aborted) return [];

  // Fallback: Google Books API
  try {
    const q = encodeURIComponent(`${qTitle} ${qAuthor}`.trim());
    const gController = new AbortController();
    const gTimeout = setTimeout(() => gController.abort(), 7000);
    const onOuterAbort = () => gController.abort();
    outerSignal?.addEventListener('abort', onOuterAbort);
    let res: Response;
    try {
      res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=8`, { signal: gController.signal });
    } finally {
      clearTimeout(gTimeout);
      outerSignal?.removeEventListener('abort', onOuterAbort);
    }
    if (res.ok) {
      const data = await res.json();
      const items = data.items || [];
      return items.map((item: any, idx: number) => {
        const info = item.volumeInfo || {};
        const authorName = (info.authors && info.authors[0]) || 'Unknown Author';
        const year = info.publishedDate ? info.publishedDate.slice(0, 4) : '';
        const pages = info.pageCount || 0;
        const categories = (info.categories || []).join(', ') || 'General';
        const thumb = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || '';
        // Ensure https
        const secureThumb = thumb.replace(/^http:\/\//i, 'https://');

        return {
          id: `gb_${item.id || Date.now() + idx}`,
          title: info.title || qTitle,
          author: authorName,
          shelf: 'mine',
          difficulty: !pages ? 0 : pages > 450 ? 3 : pages > 250 ? 2 : 1,
          isOnDevice: false,
          year,
          genre: categories,
          summary: info.description ? info.description.slice(0, 500) : `A book by ${authorName}.`,
          authorBio: '',
          pageCount: pages,
          coverUrl: secureThumb,
          ratingAverage: info.averageRating || undefined,
          ratingCount: info.ratingsCount || undefined,
          spineColor: '#8a5a3b',
          source: 'google',
          addedAt: Date.now(),
        };
      });
    }
  } catch (err) {
    console.warn('Google Books fallback failed:', err);
  }

  return [];
}

/**
 * Fill in a real synopsis and author bio. Works for any book: finds the Open Library work by id or by
 * title/author, then falls back to Google Books (synopsis) and Wikipedia (author).
 */
export async function enrichBookDetails(book: Book): Promise<Book> {
  const weak = (t?: string) => !t || t.length < 60 || t.startsWith('A distinguished work') || /^.+ by .+\.$/.test(t);
  let summary = book.summary;
  let authorBio = book.authorBio;
  const generic = /^(Unknown|Featured) Author$/.test(book.author);

  if (weak(summary)) {
    let key = typeof book.id === 'string' ? (book.id.match(/works_(OL\w+W)$/)?.[1] ? `/works/${book.id.match(/works_(OL\w+W)$/)![1]}` : '') : '';
    if (!key) {
      const d = await fetchJson(`${OL}/search.json?${new URLSearchParams({ title: book.title, author: generic ? '' : book.author, limit: '3', fields: 'key,ratings_count' })}`);
      const docs: SearchDoc[] = d?.docs || [];
      key = docs.sort((a, b) => (b.ratings_count || 0) - (a.ratings_count || 0))[0]?.key || '';
    }
    if (key) {
      const w = await fetchJson(`${OL}${key}.json`);
      const val = typeof w?.description === 'string' ? w.description : w?.description?.value;
      if (val) summary = val.split(/\n-{3,}|\n\n/)[0].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').slice(0, 600);
    }
    if (weak(summary)) {
      const q = encodeURIComponent(`intitle:${book.title}${generic ? '' : ` inauthor:${book.author}`}`);
      const g = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=3&printType=books&fields=items(volumeInfo(description))`);
      const desc: string = (g?.items || []).map((i: any) => i.volumeInfo?.description).find((t: string) => t && t.length > 60) || '';
      if (desc) summary = desc.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
    }
  }

  if ((!authorBio || authorBio.length < 40 || /is an author published worldwide|is the author of this work/.test(authorBio)) && !generic) {
    const w = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(book.author.replace(/ /g, '_'))}`);
    if (w && w.type !== 'disambiguation' && w.extract) authorBio = String(w.extract).split(/(?<=\.)\s/).slice(0, 3).join(' ');
  }
  return { ...book, summary: summary || book.summary, authorBio: authorBio || book.authorBio };
}

/* ------------------------------------------------------------------ */
/* Store shelves (Open Library)                                        */
/* ------------------------------------------------------------------ */

const OL = 'https://openlibrary.org';
const SHELF_FIELDS = 'key,title,author_name,author_key,cover_i,first_publish_year,ratings_average,ratings_count,number_of_pages_median';

/** Turn an Open Library search/trending doc into a Book the detail sheet can show. */
export function docToBook(doc: SearchDoc & { subject?: string[] }, idx = 0, genreHint = ''): Book {
  const authorName = (doc.author_name && doc.author_name[0]) || 'Unknown Author';
  const pages = doc.number_of_pages_median || 0;
  return {
    id: `ol_${(doc.key || String(Date.now() + idx)).replace(/\W/g, '_')}`,
    title: doc.title,
    author: authorName,
    shelf: 'mine',
    difficulty: pages > 450 ? 3 : pages > 250 ? 2 : pages > 0 ? 1 : 0,
    notes: '',
    isOnDevice: false,
    year: doc.first_publish_year ? String(doc.first_publish_year) : '',
    genre: genreHint || genreFromSubjects(doc.subject) || 'Book',
    summary: `A distinguished work by ${authorName}.`,
    authorBio: '',
    pageCount: pages,
    coverId: doc.cover_i,
    ratingAverage: doc.ratings_average ? Number(doc.ratings_average.toFixed(1)) : undefined,
    ratingCount: doc.ratings_count,
    spineColor: '#6b6f80',
    source: 'openlibrary',
    addedAt: Date.now(),
  };
}

const SHELF_CACHE_KEY = 'readlife.store1';
const SHELF_TTL = 6 * 60 * 60 * 1000;
const memCache: Record<string, Book[]> = {};

function readShelfCache(id: string): Book[] | null {
  if (memCache[id]) return memCache[id];
  try {
    const all = JSON.parse(localStorage.getItem(SHELF_CACHE_KEY) || '{}');
    const hit = all[id];
    if (hit && Date.now() - hit.t < SHELF_TTL && Array.isArray(hit.books) && hit.books.length) {
      memCache[id] = hit.books;
      return hit.books;
    }
  } catch {}
  return null;
}

/** Instant (synchronous) read of a shelf already loaded this session or within the last few hours. */
export function getCachedShelf(id: string): Book[] | null {
  return readShelfCache(id);
}

function writeShelfCache(id: string, books: Book[]) {
  memCache[id] = books;
  try {
    const all = JSON.parse(localStorage.getItem(SHELF_CACHE_KEY) || '{}');
    all[id] = { t: Date.now(), books };
    localStorage.setItem(SHELF_CACHE_KEY, JSON.stringify(all));
  } catch {}
}

export const SHELF_URLS = {
  top: `${OL}/trending/weekly.json?limit=15`,
  daily: `${OL}/trending/daily.json?limit=15`,
  subject: (s: string) => `${OL}/search.json?sort=rating&limit=40&fields=${SHELF_FIELDS}&q=${encodeURIComponent(`subject:"${s}"`)}`,
};

/**
 * Load one store shelf. Keeps only books with covers, prefers well-rated ones, caches for a few hours,
 * and fills in missing star ratings from each work's ratings.json in the background.
 */
export async function loadShelf(
  id: string,
  url: string,
  opts: { limit?: number; minRatings?: number; onUpdate?: (books: Book[]) => void } = {},
): Promise<Book[]> {
  const cached = readShelfCache(id);
  if (cached) return cached;
  const { limit = 12, minRatings = 0, onUpdate } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timer);
  if (!res.ok) throw new Error(`shelf ${id}: ${res.status}`);
  const data = await res.json();
  let docs: SearchDoc[] = (data.docs || data.works || []).filter((d: SearchDoc) => d.cover_i);
  if (minRatings) {
    const good = docs.filter(d => (d.ratings_count || 0) >= minRatings);
    if (good.length >= 6) docs = good;
  }
  docs = docs.slice(0, limit);
  if (!docs.length) throw new Error(`shelf ${id}: empty`);
  const books = docs.map((d, i) => docToBook(d, i));
  writeShelfCache(id, books);

  if (onUpdate) {
    // Ask for missing star ratings 3 at a time (Open Library blocks bursts of requests)
    const todo = docs.map((d, i) => ({ d, i })).filter(x => !x.d.ratings_average);
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const { d, i } = todo[next++];
        const j = await fetchJson(`${OL}${d.key}/ratings.json`, 8000, 0);
        const sm = (j && j.summary) || {};
        if (sm.average) {
          books[i] = { ...books[i], ratingAverage: Number(sm.average.toFixed(1)), ratingCount: sm.count || books[i].ratingCount };
          writeShelfCache(id, [...books]);
          onUpdate([...books]);
        }
      }
    };
    void Promise.all([worker(), worker(), worker()]);
  }
  return books;
}

/**
 * Best-guess genre label from Open Library subject strings. Returns '' when nothing matches.
 * Matches whole words only (so "software" is not "war" and "magic realism" is not fantasy).
 */
export function genreFromSubjects(subjects: string[] = []): string {
  const t = subjects.join(' | ').toLowerCase();
  if (!t) return '';
  const fiction = t.replace(/non-?fiction/g, '');
  const any = (re: RegExp, text = t) => re.test(text);
  if (any(/\b(memoirs?|autobiograph\w*|biograph(y|ies))\b/)) return 'Memoir';
  if (any(/\b(self[- ]help|self[- ]improvement|personal (development|growth)|habits?|motivational?)\b/)) return 'Self-help';
  if (any(/\b(romance|love stor(y|ies))\b/, fiction)) return 'Romance';
  if (any(/\b(fantasy|dragons?|wizards?)\b/, fiction)) return 'Fantasy';
  if (any(/\b(science fiction|sci-?fi)\b/, fiction)) return 'Science fiction';
  if (any(/\b(mystery|mysteries|thrillers?|detectives?|suspense)\b/, fiction)) return 'Mystery';
  if (any(/\bhistorical fiction\b/, fiction)) return 'Historical fiction';
  if (any(/\b(fiction|novels?)\b/, fiction)) return 'Fiction';
  if (any(/\b(business|economics?|entrepreneur\w*|finance)\b/)) return 'Business';
  if (any(/\b(history|wars?|politic\w*)\b/)) return 'History';
  if (any(/\b(philosoph\w*|religion|spiritual\w*)\b/)) return 'Philosophy';
  if (any(/\b(science|nature|technology|mathematic\w*)\b/)) return 'Science';
  return '';
}

async function fetchJson(url: string, ms = 8000, retries = 1): Promise<any | null> {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ms);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return await res.json();
      if (res.status < 500 && res.status !== 429) return null;
    } catch {}
    if (i < retries) await new Promise(r => setTimeout(r, 700));
  }
  return null;
}

const COVER_KEY = 'readlife.covers2';
const coverInFlight = new Map<string, Promise<string>>();
let coverActive = 0;
const coverWaiting: Array<() => void> = [];
const coverSlot = async () => {
  if (coverActive >= 2) await new Promise<void>(r => coverWaiting.push(r));
  coverActive++;
};
const coverRelease = () => {
  coverActive--;
  coverWaiting.shift()?.();
};

const rememberCover = (key: string, url: string) => {
  try {
    const c = JSON.parse(localStorage.getItem(COVER_KEY) || '{}');
    c[key] = url;
    const ks = Object.keys(c);
    if (ks.length > 400) ks.slice(0, ks.length - 400).forEach(k => delete c[k]);
    localStorage.setItem(COVER_KEY, JSON.stringify(c));
  } catch {}
};

/**
 * Fallback cover: Apple Books first (fast CDN, 600x900 art), then Google Books. Remembered on the device.
 * Many covers can ask at once, so the same book is only looked up once and at most 2 lookups run at a time.
 */
export function findFallbackCover(title: string, author = ''): Promise<string> {
  const key = `${title}|${author}`.toLowerCase();
  try {
    const c = JSON.parse(localStorage.getItem(COVER_KEY) || '{}');
    if (key in c) return Promise.resolve(c[key]);
  } catch {}
  const running = coverInFlight.get(key);
  if (running) return running;

  const job = (async () => {
    await coverSlot();
    try {
      // 1. Apple Books (iTunes): only accept a result whose title really matches
      try {
        const q = encodeURIComponent(`${title} ${author}`.trim());
        const data = await fetchJson(`https://itunes.apple.com/search?media=ebook&entity=ebook&limit=4&term=${q}`, 4500, 0);
        const match = (data?.results || []).find((it: any) => sameBook(title, author, String(it.trackName || ''), it.artistName));
        const art = match?.artworkUrl100 ? String(match.artworkUrl100).replace(/100x100bb\.(jpg|png)/, '600x900bb.$1') : '';
        if (art) {
          rememberCover(key, art);
          return art;
        }
      } catch {}

      // 2. Google Books
      const q = encodeURIComponent(`intitle:${title}${author ? ` inauthor:${author}` : ''}`);
      const data = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=4&printType=books&fields=items(volumeInfo(title,authors,imageLinks))`);
      if (data === null) return ''; // network trouble: don't remember a miss
      const raw: string = (data.items || [])
        .filter((i: any) => sameBook(title, author, String(i.volumeInfo?.title || ''), i.volumeInfo?.authors))
        .map((i: any) => i.volumeInfo?.imageLinks?.thumbnail || i.volumeInfo?.imageLinks?.smallThumbnail).find(Boolean) || '';
      const url = raw.replace(/^http:/, 'https:').replace('&edge=curl', '');
      rememberCover(key, url);
      return url;
    } finally {
      coverRelease();
      coverInFlight.delete(key);
    }
  })();
  coverInFlight.set(key, job);
  return job;
}

/** Median page count across a work's editions (used when the search index has no page count). */
async function pagesFromEditions(workKey: string): Promise<number | undefined> {
  const data = await fetchJson(`${OL}${workKey}/editions.json?limit=40`);
  const pages: number[] = ((data && data.entries) || [])
    .map((e: any) => Number(e.number_of_pages))
    .filter((n: number) => Number.isFinite(n) && n >= 30 && n <= 2500)
    .sort((a: number, b: number) => a - b);
  return pages.length ? pages[Math.floor(pages.length / 2)] : undefined;
}

/**
 * Refresh pages / genre / year / ratings for a book from Open Library (real numbers).
 * Works for curated catalog books AND store-shelf books (ids like "ol_/works/OL123W").
 * Cached per book so it only runs once.
 */
const META_KEY = 'readlife.meta3';
try { localStorage.removeItem('readlife.meta2'); } catch {} // replaced by meta3 (entries now expire)
const META_TTL = 30 * 24 * 60 * 60 * 1000; // ratings and page counts are refreshed monthly
export async function fetchBookMeta(book: Book): Promise<Partial<Book> | null> {
  const key = String(book.id);
  try {
    const cache = JSON.parse(localStorage.getItem(META_KEY) || '{}');
    const hit = cache[key];
    if (hit && hit.m && Date.now() - hit.t < META_TTL) return hit.m;
  } catch {}

  const FIELDS = 'key,title,author_name,cover_i,first_publish_year,ratings_average,ratings_count,number_of_pages_median,subject';
  const workKey = typeof book.id === 'string' && book.id.startsWith('ol_')
    ? book.id.slice(3).replace(/_/g, '/')
    : '';
  const validWorkKey = /^\/works\/OL\d+W$/.test(workKey) ? workKey : '';

  let d: SearchDoc | undefined;
  if (validWorkKey) {
    const data = await fetchJson(`${OL}/search.json?${new URLSearchParams({ q: `key:${validWorkKey}`, limit: '1', fields: FIELDS })}`);
    d = data?.docs?.[0];
  }
  if (!d) {
    const data = await fetchJson(`${OL}/search.json?${new URLSearchParams({
      limit: '5', fields: FIELDS, title: book.title, author: (book.author || '').split(' & ')[0],
    })}`);
    const docs: SearchDoc[] = data?.docs || [];
    d = docs.find(x => x.ratings_average) || docs[0];
  }
  if (!d) return null;

  const meta: Partial<Book> = {};
  if (d.ratings_average) { meta.ratingAverage = Number(d.ratings_average.toFixed(1)); meta.ratingCount = d.ratings_count; }
  let pages = d.number_of_pages_median;
  if (!pages && (validWorkKey || d.key)) pages = await pagesFromEditions(validWorkKey || d.key);
  if (pages) {
    meta.pageCount = pages;
    meta.difficulty = pages > 450 ? 3 : pages > 250 ? 2 : 1;
  }
  const genre = genreFromSubjects(d.subject);
  if (genre) meta.genre = genre;
  if (d.first_publish_year) meta.year = String(d.first_publish_year);

  if (Object.keys(meta).length) {
    try {
      const cache = JSON.parse(localStorage.getItem(META_KEY) || '{}');
      cache[key] = { t: Date.now(), m: meta };
      // Keep the cache bounded (oldest entries drop first) so it never eats into the 5 MB storage budget.
      const keys = Object.keys(cache);
      if (keys.length > 400) keys.slice(0, keys.length - 400).forEach(k => delete cache[k]);
      localStorage.setItem(META_KEY, JSON.stringify(cache));
    } catch {}
  }
  return Object.keys(meta).length ? meta : null;
}

/* ------------------------------------------------------------------ */
/* Hand-picked store shelves: show instantly, fill in covers/ratings   */
/* ------------------------------------------------------------------ */

const CURATED_KEY = 'readlife.store3';
const CURATED_TTL = 7 * 24 * 60 * 60 * 1000;
const SEED_COLORS = ['#6b6f80', '#8a5a3b', '#2e5934', '#925838', '#3a7d80', '#7a4a6a'];

/** Title-only books so a shelf can draw right away, before any network call. */
export function seedPlaceholders(shelf: CuratedShelf): Book[] {
  return shelf.seeds.map(([t, a], i) => {
    const rec = (RESOLVED[shelf.id]?.[i] || {}) as Partial<Book> & { olKey?: string; title?: string };
    const r = rec.title === t ? rec : {};
    const pages = r.pageCount || 0;
    return {
    id: r.olKey ? `ol_${r.olKey.replace(/\W/g, '_')}` : `seed_${shelf.id}_${i}`,
    awardLabel: shelf.seeds[i][2],
    title: t,
    author: a,
    shelf: 'mine',
    isOnDevice: false,
    genre: shelf.genre,
    summary: `${t} by ${a}.`,
    authorBio: '',
    spineColor: SEED_COLORS[i % SEED_COLORS.length],
    source: 'openlibrary',
    addedAt: Date.now(),
    coverId: r.coverId,
    coverUrl: r.coverUrl,
    ratingAverage: r.ratingAverage,
    ratingCount: r.ratingCount,
    year: r.year || '',
    pageCount: pages,
    difficulty: pages > 450 ? 3 : pages > 250 ? 2 : pages > 0 ? 1 : 0,
  } as Book;
  });
}

/** Changes whenever the shelf's books or pick labels change, so an edited shelf never shows an old cached one. */
const shelfSig = (shelf: CuratedShelf) => shelf.seeds.map(s => `${s[0]}|${s[1]}|${s[2] || ''}`).join('~');

export function getCachedCurated(shelf: CuratedShelf): Book[] | null {
  try {
    const hit = JSON.parse(localStorage.getItem(CURATED_KEY) || '{}')[shelf.id];
    if (hit && hit.sig === shelfSig(shelf) && Date.now() - hit.t < CURATED_TTL && Array.isArray(hit.books) && hit.books.length === shelf.seeds.length) return hit.books;
  } catch {}
  return null;
}

async function resolveSeed(t: string, a: string, genre: string): Promise<Book | null> {
  const data = await fetchJson(`${OL}/search.json?${new URLSearchParams({ title: t, author: a, limit: '5', fields: `${SHELF_FIELDS},subject` })}`);
  const docs: SearchDoc[] = ((data && data.docs) || []).filter((d: SearchDoc) => d.cover_i && sameBook(t, a, d.title || '', d.author_name));
  if (!docs.length) {
    // New releases often have no Open Library cover yet: borrow one from Google Books
    const alt = await findFallbackCover(t, a);
    return alt ? ({ ...docToBook({ key: '', title: t, author_name: [a] } as SearchDoc, 0, genre), id: '', title: t, author: a, coverUrl: alt } as Book) : null;
  }
  const best = docs.reduce((p, c) => ((c.ratings_count || 0) > (p.ratings_count || 0) ? c : p), docs[0]);
  let book: Book = { ...docToBook(best, 0, genre), title: t, author: a };
  if (!book.ratingAverage && best.key) {
    const r = await fetchJson(`${OL}${best.key}/ratings.json`);
    const sm = (r && r.summary) || {};
    if (sm.average) book = { ...book, ratingAverage: Number(sm.average.toFixed(1)), ratingCount: sm.count };
  }
  return book;
}

/** Looks up covers + ratings 4 at a time, pushing each result to the shelf as it arrives. */
export async function resolveCuratedShelf(shelf: CuratedShelf, current: Book[], onUpdate: (b: Book[]) => void): Promise<void> {
  const out = [...current];
  let next = 0;
  const worker = async () => {
    while (next < shelf.seeds.length) {
      const i = next++;
      if (out[i].coverId || out[i].coverUrl) continue;
      const b = await resolveSeed(shelf.seeds[i][0], shelf.seeds[i][1], shelf.genre);
      if (b) {
        out[i] = { ...b, id: b.id || out[i].id, awardLabel: shelf.seeds[i][2], year: b.year || out[i].year };
        try { const img = new Image(); img.src = getCoverUrl(b.coverId, 'M'); } catch {} // warm the cache
        onUpdate([...out]);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (out.filter(b => b.coverId).length >= Math.ceil(out.length / 2)) {
    try {
      const all = JSON.parse(localStorage.getItem(CURATED_KEY) || '{}');
      all[shelf.id] = { t: Date.now(), sig: shelfSig(shelf), books: out };
      localStorage.setItem(CURATED_KEY, JSON.stringify(all));
    } catch {}
  }
}
