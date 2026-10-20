import type { Book } from '../../types';
import { registerClearableKey } from './cache';
import { dedupeInflight, mapPool, pool } from './http';
import { identityOf, isUnknownAuthor, primaryAuthor, titleVariants, titlesMatch } from './identity';
import { findApple } from './sources/appleBooks';
import { findGoogle, googleVolume } from './sources/googleBooks';
import { olCoverById, olCoverByIsbn, openLibraryEditionCovers, searchOpenLibrary } from './sources/openLibrary';
import { isFrontCoverShape } from './placeholderCover';
import { inspectCover } from './coverFlatness';
import { isWeakCover } from './coverQuality';

/**
 * Covers: ONE system for Store, Search, Trending, Library and the nook.
 *
 * A book's own link (coverUrl / Open Library coverId) is shown first. When it is missing or fails, `resolveCover` looks for
 * the best replacement, preferring the EXACT edition when an ISBN / volume id is known:
 *   1. Apple Books (title + author)   2. Google Books volume / ISBN   3. Google Books (title + author)
 *   4. Open Library cover for the ISBN   5. another Open Library edition of the same book (most-rated first)
 * Every candidate must really load (probed in an <img>), and a title/author mismatch is never accepted. Within that order a FLAT front cover wins: a candidate that
 * is a 3D render (coverFlatness.ts) is skipped for the next, and used only when no source has a flat one. Winners are remembered
 * on this device; misses are remembered for a day so a book with no cover anywhere is not searched on every render.
 */

export type CoverSize = 'S' | 'M' | 'L';

/**
 * Apple Books art is saved (and used for the book info) at 600x900, but a Store / Library card is only ~125-140 CSS px wide. Decoding
 * ~300 full-size JPEGs (about 2 MB of bitmap each) is what made shelves stutter and the first Store open download many MB. The same
 * Apple CDN path serves any size, so a card asks for the size it draws: S 200x300, M 360x540 (about 3x a card), L the full 600x900.
 * Only Apple's own `<w>x<h>bb.jpg|png` links are rewritten; every other URL (NYT, Google, Open Library, a custom one) is returned as it is.
 */
const APPLE_ART = /^(https:\/\/is\d-ssl\.mzstatic\.com\/.+\/)(\d+)x(\d+)bb\.(jpg|png)$/;
const APPLE_SIZE: Record<CoverSize, [number, number] | null> = { S: [200, 300], M: [360, 540], L: null };
export function sizedCoverUrl(url: string, size: CoverSize): string {
  const m = APPLE_ART.exec(url);
  const want = APPLE_SIZE[size];
  if (!m || !want || Number(m[2]) <= want[0]) return url; // never ask for a bigger picture than the link already is
  return `${m[1]}${want[0]}x${want[1]}bb.${m[4]}`;
}

export function getCoverUrl(coverId?: number, size: CoverSize = 'M', customUrl?: string): string {
  if (customUrl) return sizedCoverUrl(customUrl, size);
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
const FIX_TTL = 30 * 24 * 60 * 60 * 1000; // a repaired cover is trusted over the book's own link for 30 days at most

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

type CoverFix = { url: string; t: number; own?: string };
let fixes: Record<string, CoverFix> = read(FIX_KEY);
let fixVersion = 0;
const fixListeners = new Set<() => void>();
export const subscribeCovers = (l: () => void) => { fixListeners.add(l); return () => { fixListeners.delete(l); }; };
export const getCoversVersion = () => fixVersion;
const emitFixes = () => { fixVersion++; fixListeners.forEach(l => l()); };
/** Tell every drawn cover to look again (a repaired cover or a picked cover changed). Used by coverPicks.ts. */
export const notifyCoversChanged = emitFixes;

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

type CoverLinks = { title?: string; author?: string; coverId?: number; coverUrl?: string };

/** The book's own cover link, in a size-independent form ('' when it has none). Recorded with a repair to tell a stale repair from a current one. */
const ownLinkOf = (b: { coverId?: number; coverUrl?: string }): string => b.coverUrl || (b.coverId && b.coverId > 0 ? `ol:${b.coverId}` : '');

/**
 * A repaired cover URL for this book, or ''. A repair is honoured only while it still belongs to the book's current data:
 *  - the book has no own link (the repair is all it has), or
 *  - the own link is the one the repair replaced (`own`) and the repair is under 30 days old.
 * A newer bundled cover therefore wins over an old repair, and repairs saved before this check (no `own`) are ignored whenever
 * the book has its own cover. Nothing is deleted here; a stale entry is simply not used and is replaced if a new repair is needed.
 */
export const getCoverFix = (book: CoverLinks): string => {
  const key = coverKey(book);
  const f = fixes[key];
  if (!f?.url) return '';
  const own = ownLinkOf(book);
  if (!own) return f.url;
  const fresh = Date.now() - f.t < FIX_TTL;
  // Dead for good: an old repair that never recorded the link it replaced (this book now has its own cover), or one past its 30 days. Forgotten a moment later, off the drawing path.
  // (A repair recorded for a DIFFERENT own link is left alone: another copy of the same title may still be using it.)
  if (f.own === undefined || !fresh) scheduleFixPrune(key);
  return f.own === own && fresh ? f.url : '';
};

const stalePrune = new Set<string>();
let prunePending = false;
function scheduleFixPrune(key: string) {
  stalePrune.add(key);
  if (prunePending) return;
  prunePending = true;
  setTimeout(() => {
    prunePending = false;
    let changed = false;
    for (const k of stalePrune) {
      const f = fixes[k];
      // Re-check: a new repair may have replaced it in the meantime
      if (f && (f.own === undefined || Date.now() - f.t >= FIX_TTL)) { delete fixes[k]; changed = true; }
    }
    stalePrune.clear();
    if (changed) write(FIX_KEY, fixes); // no redraw needed: a stale entry already answered ''
  }, 0);
}

const saveFix = (key: string, url: string, own: string) => {
  fixes[key] = { url, t: Date.now(), own };
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
  if (!book.title || getCoverFix(book) || missing.has(key)) return;
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

/**
 * Does this image actually load (and isn't a 1×1 placeholder)? With `front`, it must also be shaped like a FRONT cover: a wide picture
 * (spine + back, a box set, a photographed book) is refused so the next source is tried.
 */
export function probeImage(url: string, ms = 5000, front = false): Promise<boolean> {
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
    img.onload = () => finish(img.naturalWidth > 8 && img.naturalHeight > 8 && (!front || isFrontCoverShape(img.naturalWidth, img.naturalHeight)));
    img.onerror = () => finish(false);
    img.src = url;
  });
}

const lookupSlots = pool(6); // covers are looked up six at a time (a results page shows nine at once), however many ask
const inflight = new Map<string, Promise<string>>();

/** English first: hits whose language is English or unknown come before hits whose editions are all in another language (each group keeps its order). */
export const englishFirst = <T extends { flags: { language?: string } }>(hits: T[]): T[] => {
  const isEnglish = (h: T) => !h.flags.language || h.flags.language === 'en';
  return [...hits.filter(isEnglish), ...hits.filter(h => !isEnglish(h))];
};

async function search(b: MissingBook): Promise<string> {
  const id = identityOf(b);
  const author = isUnknownAuthor(b.author) ? '' : primaryAuthor(b.author);
  // Every candidate must load AND be a flat front cover (no spine / back / photographed book). A picture that loads but is a 3D RENDER (a tilted book,
  // the spine showing: coverFlatness.ts) is set aside and only used when nothing flat is found anywhere: no source is flat for every book, so the picture decides
  const renders: string[] = [];
  // English is preferred: a cover that belongs to another language's edition is only kept for the end, and used only for a book with no cover at all
  const foreign: string[] = [];
  const isEnglish = (language?: string) => !language || language === 'en';
  const accept = async (url?: string) => {
    if (!url || !(await probeImage(url, 5000, true))) return '';
    if ((await inspectCover(url)) === 'render') { renders.push(url); return ''; }
    return url;
  };
  let url = '';

  // All are asked at the same time (the slowest no longer holds up the others), then judged in a fixed order: Apple first, then
  // Google, then Open Library. Apple's art is flat, clean, front-facing and modern, so it beats a paper / contents-looking scan
  // whenever both exist; Open Library's scans are the most likely to be a spine, a back or a photographed book, so they come last.
  const isbn = id.isbn13 || id.isbn10;
  const appleAsk = findApple({ title: b.title, author });
  const olIsbnAsk = isbn ? accept(olCoverByIsbn(isbn, 'L')) : Promise.resolve('');
  const gbAsk = id.gbVolume ? googleVolume(id.gbVolume) : isbn ? findGoogle({ title: b.title, author, isbn }, {}, ['cover']) : Promise.resolve(null);
  const apple = await appleAsk.catch(() => null);
  if (apple?.book.coverUrl && (url = await accept(apple.book.coverUrl))) return url;
  const gb = await gbAsk.catch(() => null);
  if (gb?.book.coverUrl && !isEnglish(gb.flags.language)) foreign.push(gb.book.coverUrl); // another language's jacket: only if nothing English turns up
  else if (gb?.book.coverUrl && (url = await accept(gb.book.coverUrl))) return url;

  // Google by name (title and author must really match)
  const byName = await findGoogle({ title: b.title, author });
  if (byName?.book.coverUrl && !isEnglish(byName.flags.language)) foreign.push(byName.book.coverUrl);
  else if (byName?.book.coverUrl && (url = await accept(byName.book.coverUrl))) return url;

  // Open Library: the exact edition by ISBN, then other editions of this book (under any of its title forms), most popular first
  const olIsbnCover = await olIsbnAsk;
  if (olIsbnCover) return olIsbnCover;
  for (const title of titleVariants(b.title)) {
    const editions = (await searchOpenLibrary({ title, ...(author ? { author } : {}) }, 8))
      .filter(h => h.book.coverId && h.book.coverId !== b.coverId && titlesMatch(h.book.title, b.title))
      .sort((x, y) => (y.book.ratingCount || 0) - (x.book.ratingCount || 0) || (y.book.coverId || 0) - (x.book.coverId || 0)) // popular work first (ratings_count), then the newer cover_i
      .slice(0, 4);
    for (const h of englishFirst(editions)) {
      if (!isEnglish(h.flags.language)) { foreign.push(olCoverById(h.book.coverId!, 'M')); continue; }
      // The work's cover_i can be ANY edition's, a translation's included: an English edition's own cover is asked for first (one memoized request), cover_i after it
      const work = h.book.identity?.olWork;
      const english = work ? await openLibraryEditionCovers(work, 2).catch(() => [] as number[]) : [];
      for (const id of [...english, h.book.coverId!].filter((n, i, a) => n !== b.coverId && a.indexOf(n) === i)) {
        if ((url = await accept(olCoverById(id, 'M')))) return url;
      }
    }
  }
  // No English cover anywhere. For a book with NO cover at all, a flat jacket of another language's edition beats a render, and a render beats nothing; a book that already has a cover keeps it
  if (!ownLinkOf(b)) {
    for (const f of foreign) if ((url = await accept(f))) return url;
    return renders[0] || '';
  }
  return '';
}

/**
 * Find a working cover for a book whose own link is missing or broken. Returns the URL, or '' when nothing reliable exists.
 * Remembered per book; concurrent calls for the same book share one lookup.
 */
export function resolveCover(b: MissingBook, opts: { force?: boolean } = {}): Promise<string> {
  const key = coverKey(b);
  if (!opts.force) {
    const known = getCoverFix(b);
    if (known) return Promise.resolve(known);
    const none = read<number>(NONE_KEY)[key];
    if (none && Date.now() - none < NONE_TTL) return Promise.resolve('');
  }
  return dedupeInflight(inflight, key, () => lookupSlots(async () => {
    let url = '';
    try { url = await search(b); } catch {}
    if (url) {
      saveFix(key, url, ownLinkOf(b));
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
export function fillMissingCovers(books: Book[], onUpdate: (books: Book[]) => void, signal?: AbortSignal, opts: { upgradeWeak?: number; resolve?: typeof resolveCover } = {}): void {
  const out = [...books];
  const resolve = opts.resolve ?? resolveCover;
  let weakLeft = opts.upgradeWeak ?? 0;
  books.forEach((b, i) => {
    if (!b.title) return;
    const missing = !b.coverId && !b.coverUrl;
    // A cover that is there but weak (an Open Library cover: often the work's oldest edition, or a scan of the whole wrap or an inside page; the NYT's marketing render)
    // gets a look for a modern flat front too, for the first few results only (the lookup is shared, remembered, and never makes the result worse: it only answers with a flat, front-shaped picture)
    if (!missing && !(weakLeft > 0 && isWeakCover(b))) return;
    if (!missing) weakLeft--;
    void resolve(b).then(url => {
      if (!url || signal?.aborted) return;
      if (!missing && url === getCoverUrl(out[i].coverId, 'M', out[i].coverUrl)) return; // the same picture
      out[i] = { ...out[i], coverUrl: url, ...(missing ? {} : { coverId: undefined }) };
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

/* ---------------- the "Refresh Book Covers" button (Backup & Restore) ---------------- */

/**
 * Forget every saved cover repair and every "no cover found" note, then let the covers on screen look again.
 * Each book shows its own current cover first; one whose link really is broken is repaired again by the normal path.
 * Touches only the two cover caches: Library, history, notes, settings, shelves and offline data are left alone.
 * Returns how many saved repairs were forgotten.
 */
export function refreshBookCovers(): number {
  const count = Object.keys(fixes).length;
  fixes = {};
  try { localStorage.removeItem(FIX_KEY); localStorage.removeItem(NONE_KEY); } catch {}
  inflight.clear();
  missing.clear();
  lastNotFound = [];
  emitMissing();
  emitFixes();
  return count;
}
