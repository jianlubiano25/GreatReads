import type { Book } from '../../types';
import { registerClearableKey } from './cache';
import { dedupeInflight, mapPool, pool } from './http';
import { identityOf, isUnknownAuthor, primaryAuthor, titlesMatch } from './identity';
import { findApple } from './sources/appleBooks';
import { findGoogle, googleVolume } from './sources/googleBooks';
import { olCoverById, olCoverByIsbn, searchOpenLibrary } from './sources/openLibrary';

/**
 * Covers: ONE system for Store, Search, Trending, Library and the nook.
 *
 * A book's own link (coverUrl / Open Library coverId) is shown first. When it is missing or fails, `resolveCover` looks for
 * the best replacement, preferring the EXACT edition when an ISBN / volume id is known:
 *   1. Open Library cover for the ISBN   2. Google Books volume / ISBN   3. Apple Books (title + author)
 *   4. Google Books (title + author)     5. another Open Library edition of the same book
 * Every candidate must really load (probed in an <img>), and a title/author mismatch is never accepted. Winners are remembered
 * on this device; misses are remembered for a day so a book with no cover anywhere is not searched on every render.
 */

export type CoverSize = 'S' | 'M' | 'L';
export function getCoverUrl(coverId?: number, size: CoverSize = 'M', customUrl?: string): string {
  if (customUrl) return customUrl;
  if (!coverId || coverId <= 0) return '';
  return olCoverById(coverId, size);
}

/* ---------------- stores: repaired covers (rare) and the missing list (for the button) ---------------- */

const FIX_KEY = 'readlife.coverFix1'; // key -> { url, t }
const NONE_KEY = 'readlife.coverNone3'; // key -> time of the last miss
registerClearableKey(FIX_KEY);
registerClearableKey(NONE_KEY);
const NONE_TTL = 24 * 60 * 60 * 1000;
const MAX_FIXES = 400;

export type MissingBook = Pick<Book, 'id' | 'title' | 'author' | 'coverId' | 'coverUrl' | 'identity'>;
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

export const coverKey = (b: { title?: string; author?: string }) => `${(b.title || '').trim()}|${(b.author || '').trim()}`.toLowerCase();

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
const emitMissing = () => {
  clearTimeout(emitTimer);
  emitTimer = setTimeout(() => { missingVersion++; missingListeners.forEach(l => l()); }, 250);
};

/** A repaired cover URL for this book, or '' */
export const getCoverFix = (book: { title?: string; author?: string }): string => fixes[coverKey(book)]?.url || '';

const saveFix = (key: string, url: string) => {
  fixes[key] = { url, t: Date.now() };
  const keys = Object.keys(fixes);
  if (keys.length > MAX_FIXES) keys.slice(0, keys.length - MAX_FIXES).forEach(k => delete fixes[k]);
  write(FIX_KEY, fixes);
  const none = read<number>(NONE_KEY);
  if (key in none) { delete none[key]; write(NONE_KEY, none); }
};

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
  missing.set(key, { id: book.id, title: book.title, author: book.author, coverId: book.coverId, coverUrl: book.coverUrl, identity: book.identity });
  emitMissing();
}

/** The image did load after all (slow network etc.) */
export function clearMissingCover(book: { title?: string; author?: string }) {
  if (missing.size && missing.delete(coverKey(book))) emitMissing();
}

/* ---------------- finding a cover ---------------- */

/** Does this image actually load (and isn't a 1×1 placeholder)? */
export function probeImage(url: string, ms = 9000): Promise<boolean> {
  return new Promise(resolve => {
    if (typeof Image === 'undefined') return resolve(true);
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

const lookupSlots = pool(2); // covers are looked up two at a time, however many ask at once
const inflight = new Map<string, Promise<string>>();

async function search(b: MissingBook): Promise<string> {
  const id = identityOf(b);
  const author = isUnknownAuthor(b.author) ? '' : primaryAuthor(b.author);
  const accept = async (url?: string) => (url && (await probeImage(url)) ? url : '');
  let url = '';

  // exact edition first
  const isbn = id.isbn13 || id.isbn10;
  if (isbn && (url = await accept(olCoverByIsbn(isbn, 'L')))) return url;
  const gb = id.gbVolume ? await googleVolume(id.gbVolume) : isbn ? await findGoogle({ title: b.title, author, isbn }) : null;
  if (gb?.book.coverUrl && (url = await accept(gb.book.coverUrl))) return url;

  // then by name, always checking the title and author really match
  const apple = await findApple({ title: b.title, author });
  if (apple?.book.coverUrl && (url = await accept(apple.book.coverUrl))) return url;
  const byName = await findGoogle({ title: b.title, author });
  if (byName?.book.coverUrl && (url = await accept(byName.book.coverUrl))) return url;

  // other Open Library editions of this book
  const editions = (await searchOpenLibrary({ title: b.title, ...(author ? { author } : {}) }, 8))
    .filter(h => h.book.coverId && h.book.coverId !== b.coverId && titlesMatch(h.book.title, b.title))
    .slice(0, 3);
  for (const h of editions) if ((url = await accept(olCoverById(h.book.coverId!, 'M')))) return url;
  return '';
}

/**
 * Find a working cover for a book whose own link is missing or broken. Returns the URL, or '' when nothing reliable exists.
 * Remembered per book; concurrent calls for the same book share one lookup.
 */
export function resolveCover(b: MissingBook, opts: { force?: boolean } = {}): Promise<string> {
  const key = coverKey(b);
  if (!opts.force) {
    const known = fixes[key]?.url;
    if (known) return Promise.resolve(known);
    const none = read<number>(NONE_KEY)[key];
    if (none && Date.now() - none < NONE_TTL) return Promise.resolve('');
  }
  return dedupeInflight(inflight, key, () => lookupSlots(async () => {
    let url = '';
    try { url = await search(b); } catch {}
    if (url) {
      saveFix(key, url);
      emitFixes();
    } else if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      const none = read<number>(NONE_KEY);
      none[key] = Date.now();
      write(NONE_KEY, none);
    }
    return url;
  }));
}

/**
 * After search results are already on screen, quietly look for covers the search did not return and hand back the updated
 * list as they arrive. Never blocks the search. The cover is stored on the result, so a book added from it keeps its cover.
 */
export function fillMissingCovers(books: Book[], onUpdate: (books: Book[]) => void, signal?: AbortSignal): void {
  const out = [...books];
  books.forEach((b, i) => {
    if (b.coverId || b.coverUrl || !b.title) return;
    void resolveCover(b).then(url => {
      if (!url || signal?.aborted) return;
      out[i] = { ...out[i], coverUrl: url };
      onUpdate([...out]);
    });
  });
}

/* ---------------- the "Reload missing covers" button ---------------- */

let repairing = false;

/**
 * Re-run the lookup for only the covers that failed. Returns how many were fixed, not found anywhere, or
 * couldn't be checked (offline — these are not marked "not found").
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
    let done = 0;
    opts.onProgress?.(0, queue.length);
    await mapPool(queue, 3, async ([key, book]) => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) result.failed++;
      else {
        const url = await resolveCover(book, { force: true });
        if (url) { missing.delete(key); result.fixed++; }
        else { missing.delete(key); lastNotFound.push(book); result.notFound++; }
      }
      opts.onProgress?.(++done, queue.length);
    });
    emitMissing();
    return result;
  } finally {
    repairing = false;
  }
}
