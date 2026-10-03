import type { Book } from '../types';

/**
 * Missing-cover repair.
 *
 * - Covers that fail every normal attempt report themselves here (see CoverFace in BookMeta.tsx).
 * - "Reload missing covers" re-fetches ONLY those, trying several sources in turn:
 *     1. the same Open Library cover again (fresh request, other sizes)
 *     2. other Open Library editions of the same book
 *     3. Google Books
 *     4. Apple Books (iTunes Search)
 * - Every candidate is test-loaded in an <img> before it is accepted, and the winner is remembered on
 *   this device (localStorage) so it keeps working after a reload.
 */

const FIX_KEY = 'readlife.coverFix1';   // key -> { url, t }  (covers we repaired)
const NONE_KEY = 'readlife.coverNone1'; // key -> time        (searched everywhere, nothing found)
const NONE_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_FIXES = 400;

export type MissingBook = Pick<Book, 'id' | 'title' | 'author' | 'coverId' | 'coverUrl'>;
export type RepairResult = { fixed: number; notFound: number; failed: number; total: number };

const read = <T,>(key: string): Record<string, T> => {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};
const write = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
};

export const coverKey = (b: { title?: string; author?: string }) =>
  `${(b.title || '').trim()}|${(b.author || '').trim()}`.toLowerCase();

/* ---------- two tiny stores: repaired covers (cheap, rare) and the missing list (for the button) ---------- */

let fixes: Record<string, { url: string; t: number }> = read(FIX_KEY);
let fixVersion = 0;
const fixListeners = new Set<() => void>();
export const subscribeCovers = (l: () => void) => { fixListeners.add(l); return () => { fixListeners.delete(l); }; };
export const getCoversVersion = () => fixVersion;
const emitFixes = () => { fixVersion++; fixListeners.forEach(l => l()); };

const missing = new Map<string, MissingBook>();
let lastNotFound: MissingBook[] = [];
let missingVersion = 0;
const missingListeners = new Set<() => void>();
let emitTimer: ReturnType<typeof setTimeout> | undefined;
export const subscribeMissing = (l: () => void) => { missingListeners.add(l); return () => { missingListeners.delete(l); }; };
export const getMissingVersion = () => missingVersion;
export const getMissingCount = () => missing.size;
// Many covers can fail at once; tell the button once, not once per cover.
const emitMissing = () => {
  clearTimeout(emitTimer);
  emitTimer = setTimeout(() => { missingVersion++; missingListeners.forEach(l => l()); }, 250);
};

/** A repaired cover URL for this book, or '' */
export function getCoverFix(book: { title?: string; author?: string }): string {
  return fixes[coverKey(book)]?.url || '';
}

/** A repaired cover that later stopped working: forget it so it can be repaired again. */
export function dropCoverFix(book: { title?: string; author?: string }) {
  const key = coverKey(book);
  if (!fixes[key]) return;
  delete fixes[key];
  write(FIX_KEY, fixes);
  emitFixes();
}

export function reportMissingCover(book: MissingBook) {
  const key = coverKey(book);
  if (!book.title || fixes[key] || missing.has(key)) return;
  const none = read<number>(NONE_KEY)[key];
  if (none && Date.now() - none < NONE_TTL) return;
  missing.set(key, { id: book.id, title: book.title, author: book.author, coverId: book.coverId, coverUrl: book.coverUrl });
  emitMissing();
}

/** The image did load after all (slow network etc.) */
export function clearMissingCover(book: { title?: string; author?: string }) {
  if (missing.size && missing.delete(coverKey(book))) emitMissing();
}

/* ---------- finding a cover ---------- */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Is `got` plausibly the same book as `want`? (avoids pinning the wrong cover on a book) */
function sameBook(want: string, got: string): boolean {
  const a = norm(want), b = norm(got);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const ta = new Set(a.split(' ').filter(w => w.length > 2));
  const tb = b.split(' ').filter(w => w.length > 2);
  if (!ta.size || !tb.length) return false;
  return tb.filter(w => ta.has(w)).length / Math.min(ta.size, tb.length) >= 0.7;
}

/** Does this image actually load (and isn't a 1×1 placeholder)? */
export function probeImage(url: string, ms = 9000): Promise<boolean> {
  return new Promise(resolve => {
    const img = new Image();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      img.onload = img.onerror = null;
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), ms);
    img.referrerPolicy = 'no-referrer';
    img.onload = () => finish(img.naturalWidth > 8 && img.naturalHeight > 8);
    img.onerror = () => finish(false);
    img.src = url;
  });
}

async function getJson(url: string, ms = 8000): Promise<{ ok: boolean; data: any }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, data: null };
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, data: null };
  }
}

const bust = () => String(Date.now() % 1_000_000);
const https = (u: string) => u.replace(/^http:\/\//i, 'https://').replace('&edge=curl', '');

/** Returns a working cover URL, '' if none exists, or null if the network got in the way. */
async function findWorkingCover(b: MissingBook): Promise<string | null> {
  let netTrouble = false;
  const firstAuthor = (b.author || '').split(/ & |, | and /)[0];

  // 1. The same cover again, with a fresh request, then other sizes
  if (b.coverUrl && (await probeImage(`${b.coverUrl}${b.coverUrl.includes('?') ? '&' : '?'}rl=${bust()}`))) {
    return `${b.coverUrl}${b.coverUrl.includes('?') ? '&' : '?'}rl=${bust()}`;
  }
  if (b.coverId && b.coverId > 0) {
    for (const size of ['M', 'L', 'S']) {
      const u = `https://covers.openlibrary.org/b/id/${b.coverId}-${size}.jpg?rl=${bust()}`;
      if (await probeImage(u)) return u;
    }
  }

  // 2. Apple Books (fast CDN, high-res Retina covers)
  {
    const q = new URLSearchParams({ term: `${b.title} ${firstAuthor}`.trim(), media: 'ebook', entity: 'ebook', limit: '6' });
    const r = await getJson(`https://itunes.apple.com/search?${q}`);
    if (!r.ok) netTrouble = true;
    for (const it of (r.data?.results || []).slice(0, 6)) {
      const small: string | undefined = it.artworkUrl100 || it.artworkUrl60;
      if (!small || !sameBook(b.title, it.trackName || '')) continue;
      const big = small.replace(/\/\d+x\d+bb\.(jpg|png)/, '/600x900bb.$1');
      if (await probeImage(big)) return big;
      if (await probeImage(small)) return small;
    }
  }

  // 3. Other Open Library editions of this book
  {
    const q = new URLSearchParams({ title: b.title, limit: '8', fields: 'title,author_name,cover_i' });
    if (firstAuthor) q.set('author', firstAuthor);
    const r = await getJson(`https://openlibrary.org/search.json?${q}`);
    if (!r.ok) netTrouble = true;
    const docs: any[] = (r.data?.docs || []).filter((d: any) => d.cover_i && d.cover_i !== b.coverId && sameBook(b.title, d.title || ''));
    for (const d of docs.slice(0, 3)) {
      const u = `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`;
      if (await probeImage(u)) return u;
    }
  }

  // 4. Google Books
  {
    const q = encodeURIComponent(`intitle:${b.title}${firstAuthor ? ` inauthor:${firstAuthor}` : ''}`);
    const r = await getJson(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=6&printType=books&fields=items(volumeInfo(title,imageLinks))`);
    if (!r.ok) netTrouble = true;
    for (const it of (r.data?.items || []).slice(0, 6)) {
      const v = it.volumeInfo || {};
      const raw = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail;
      if (raw && sameBook(b.title, v.title || '')) {
        const u = https(raw);
        if (await probeImage(u)) return u;
      }
    }
  }

  return netTrouble ? null : '';
}

let repairing = false;
export const isRepairing = () => repairing;

/**
 * Re-fetch only the covers that failed. Returns how many were fixed, not found anywhere, or
 * couldn't be checked (network trouble — these are not marked "not found").
 */
export async function repairMissingCovers(opts: { includeNotFound?: boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<RepairResult> {
  if (repairing) return { fixed: 0, notFound: 0, failed: 0, total: 0 };
  repairing = true;
  try {
    if (opts.includeNotFound) {
      const none = read<number>(NONE_KEY);
      lastNotFound.forEach(b => { delete none[coverKey(b)]; missing.set(coverKey(b), b); });
      write(NONE_KEY, none);
      lastNotFound = [];
    }
    const queue = [...missing.entries()];
    const result: RepairResult = { fixed: 0, notFound: 0, failed: 0, total: queue.length };
    let next = 0;
    let done = 0;
    opts.onProgress?.(0, queue.length);

    const worker = async () => {
      while (next < queue.length) {
        const [key, book] = queue[next++];
        let url: string | null = null;
        try { url = await findWorkingCover(book); } catch { url = null; }

        if (url) {
          fixes[key] = { url, t: Date.now() };
          const keys = Object.keys(fixes);
          if (keys.length > MAX_FIXES) keys.slice(0, keys.length - MAX_FIXES).forEach(k => delete fixes[k]);
          write(FIX_KEY, fixes);
          missing.delete(key);
          result.fixed++;
          emitFixes(); // the cover appears right away
        } else if (url === '') {
          const none = read<number>(NONE_KEY);
          none[key] = Date.now();
          write(NONE_KEY, none);
          missing.delete(key);
          lastNotFound.push(book);
          result.notFound++;
        } else {
          result.failed++; // offline / blocked: keep it in the list to try again
        }
        opts.onProgress?.(++done, queue.length);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    emitMissing();
    return result;
  } finally {
    repairing = false;
  }
}
