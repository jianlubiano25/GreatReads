/**
 * coverLookup: finding, repairing and showing a cover. Repaired covers (fixes), settled marks, the "no cover found" notes, resolveCover / search,
 * fillMissingCovers, the Reload / Refresh Book Covers buttons, getCoverUrl / sizedCoverUrl. (Split out of covers.ts; no change in behaviour.)
 */
import { type Book } from '../../types';
import { clearCaches, COVER_CACHE_KEYS, registerClearableKey } from './cache';
import { dedupeInflight, mapPool, transientFailureCount } from './http';
import { olCoverById } from './sources/openLibrary';
import { coverKey, inspectCover, isWeakCover, probeImage } from './coverAnalysis';
import { imageKey, loadCoverCandidates, rankCandidates, type CoverCandidate } from './coverCandidates';
import { syncSharedCovers } from './coverPicks';
import { isCoverRejected } from './rejectedCovers';

/* ======================================================================================================
 * finding, repairing and showing a cover  (was covers.ts)
 * ====================================================================================================== */

/**
 * Covers: ONE system for Store, Search, Trending, Library and the nook.
 *
 * A book's own link (coverUrl / Open Library coverId) is shown first. When it is missing or fails, `resolveCover` looks for
 * the best replacement, preferring the EXACT edition when an ISBN / volume id is known:
 *   1. Apple Books (title + author)   2. Google Books volume / ISBN   3. Google Books (title + author)
 *   4. Open Library cover for the ISBN   5. another Open Library edition of the same book (most-rated first)
 * Every candidate must really load (probed in an <img>), and a title/author mismatch is never accepted. Within that order a FLAT front cover wins: a candidate that
 * is a 3D render (covers.ts) is skipped for the next, and used only when no source has a flat one. Winners are remembered
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

/** The book's own cover link at this size, or '' when the owner rejected that picture. */
export function ownCoverUrl(book: { title?: string; author?: string; coverId?: number; coverUrl?: string }, size: CoverSize = 'M'): string {
  const u = getCoverUrl(book.coverId, size, book.coverUrl);
  return u && isCoverRejected(book, u) ? '' : u;
}

/* ---------------- stores: repaired covers (rare) and the missing list (for the button) ---------------- */

const FIX_KEY = 'readlife.coverFix1'; // key -> { url, t }
const NONE_KEY = 'readlife.coverNone4'; // key -> time of the last miss (4: the day-long misses a title-matching bug left in 3 are not carried over)
registerClearableKey(FIX_KEY);
registerClearableKey(NONE_KEY);
try { localStorage.removeItem('readlife.coverNone3'); } catch {}
const NONE_TTL = 24 * 60 * 60 * 1000;
const MAX_FIXES = 1500; // repairs and settled marks together (small records)
const SETTLED_TTL = 90 * 24 * 60 * 60 * 1000;
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


type CoverFix = { url: string; t: number; own?: string; v?: number };
/** Version of the rule a repair was chosen by (2 = English first). An older repair may be another language's jacket, so it is not used and is forgotten. */
const FIX_RULE = 2;
let fixes: Record<string, CoverFix> = read(FIX_KEY);
let fixVersion = 0;
const fixListeners = new Set<() => void>();
export const subscribeCovers = (l: () => void) => { fixListeners.add(l); return () => { fixListeners.delete(l); }; };
export const getCoversVersion = () => fixVersion;
const emitFixes = () => { fixVersion++; fixListeners.forEach(l => l()); };
/** Tell every drawn cover to look again (a repaired cover or a picked cover changed). Used by covers.ts. */
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
const rawCoverFix = (book: CoverLinks): string => {
  const key = coverKey(book);
  const f = fixes[key];
  if (!f?.url) return '';
  const own = ownLinkOf(book);
  const current = f.v === FIX_RULE;
  if (!own) { if (!current) scheduleFixPrune(key); return current ? f.url : ''; }
  const fresh = Date.now() - f.t < FIX_TTL;
  // Dead for good: an old repair that never recorded the link it replaced (this book now has its own cover), or one past its 30 days. Forgotten a moment later, off the drawing path.
  // (A repair recorded for a DIFFERENT own link is left alone: another copy of the same title may still be using it.)
  if (f.own === undefined || !fresh || !current) scheduleFixPrune(key);
  return f.own === own && fresh && current ? f.url : '';
};

/** The repaired cover, unless the owner rejected that picture (then it is as if there were none). */
export const getCoverFix = (book: CoverLinks): string => {
  const u = rawCoverFix(book);
  return u && isCoverRejected(book, u) ? '' : u;
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
      if (f && (f.own === undefined || f.v !== FIX_RULE || Date.now() - f.t >= FIX_TTL)) { delete fixes[k]; changed = true; }
    }
    stalePrune.clear();
    if (changed) write(FIX_KEY, fixes); // no redraw needed: a stale entry already answered ''
  }, 0);
}

const saveFix = (key: string, url: string, own: string) => {
  fixes[key] = { url, t: Date.now(), own, v: FIX_RULE };
  const keys = Object.keys(fixes);
  if (keys.length > MAX_FIXES) keys.slice(0, keys.length - MAX_FIXES).forEach(k => delete fixes[k]);
  write(FIX_KEY, fixes);
  const none = read<number>(NONE_KEY);
  if (key in none) { delete none[key]; write(NONE_KEY, none); }
};

/**
 * A book is SETTLED once its cover has had its one look (measured, and replaced by a flat front when one was found, or kept because none was): from then on nothing is
 * measured, looked up or swapped for it again while its own cover link stays the same, for 90 days. It is the same record as a repair (an entry with no replacement
 * url), so Refresh Book Covers clears both and a changed cover link reopens the book. Not recorded while offline: a failed lookup is not "nothing better exists".
 */
export const isCoverSettled = (book: CoverLinks): boolean => {
  const f = fixes[coverKey(book)];
  return !!f && f.v === FIX_RULE && f.own === ownLinkOf(book) && Date.now() - f.t < SETTLED_TTL;
};
export function markCoverSettled(book: CoverLinks) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const key = coverKey(book);
  if (!book.title || fixes[key]?.url) return; // a repair already says it
  fixes[key] = { url: '', t: Date.now(), own: ownLinkOf(book), v: FIX_RULE };
  // A shelf settles many books in a burst: the list is written once, a moment later
  clearTimeout(settledWrite);
  settledWrite = setTimeout(() => {
    const keys = Object.keys(fixes);
    if (keys.length > MAX_FIXES) keys.slice(0, keys.length - MAX_FIXES).forEach(k => delete fixes[k]);
    write(FIX_KEY, fixes);
  }, 1500);
}
let settledWrite: ReturnType<typeof setTimeout> | undefined;

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
 * Covers are looked up six at a time (a results page shows nine at once), however many ask, and the books on screen go first: a lookup asked for by a visible
 * cover jumps ahead of every background one, and background lookups (below the fold, upgrades, repairs) never take more than two of the six slots, so a
 * long Library cannot hold up the covers you are looking at. A book is queued once; asking again (visible now) only moves it forward.
 */
const MAX_LOOKUPS = 6;
const MAX_BACKGROUND = 2;
type Waiting = { high: boolean; start: () => void };
const waiting = new Map<string, Waiting>();
let activeLookups = 0;
let activeBackground = 0;
function pumpLookups() {
  while (activeLookups < MAX_LOOKUPS && waiting.size) {
    let pick: [string, Waiting] | undefined;
    for (const e of waiting) if (e[1].high) { pick = e; break; }
    if (!pick && activeBackground < MAX_BACKGROUND) pick = waiting.entries().next().value as [string, Waiting];
    if (!pick) return;
    waiting.delete(pick[0]);
    pick[1].start();
  }
}
function lookupSlot<T>(key: string, high: boolean, job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const w: Waiting = {
      high,
      start: () => {
        const bg = !w.high;
        activeLookups++;
        if (bg) activeBackground++;
        job().then(resolve, reject).finally(() => { activeLookups--; if (bg) activeBackground--; pumpLookups(); });
      },
    };
    waiting.set(key, w);
    pumpLookups();
  });
}
const inflight = new Map<string, Promise<string>>();

/**
 * The cover for a book whose own link is missing, broken or a 3D render: the FIRST picture of the cover viewer's own ranked list (loadCoverCandidates: English before
 * another language, Apple, Google, Open Library) that really loads, is front-shaped and is not a render. One list, so the shelf and the viewer never disagree, and the
 * viewer opens on what the shelf already looked up. A render is only the last resort for a book with no cover at all; another language's jacket likewise (a book that
 * already has a cover keeps it rather than get either).
 */
async function search(b: MissingBook): Promise<string> {
  const ownUrl = b.coverUrl || (b.coverId && b.coverId > 0 ? olCoverById(b.coverId, 'M') : '');
  const hasOwn = !!ownLinkOf(b);
  const renders: string[] = [];
  const tryList = async (list: CoverCandidate[]): Promise<string> => {
    const usable = rankCandidates(list)
      .filter(c => !(c.foreign && hasOwn)) // foreign ones are last: a book with a cover of its own is not given another language's
      .filter(c => !(ownUrl && imageKey(c.url) === imageKey(ownUrl))) // the cover it already has is the one that failed
      .map(c => (c.source === 'openlibrary' ? c.url.replace(/-L\.jpg/, '-M.jpg') : c.url)) // a shelf card is drawn from the medium size (the viewer shows the large one)
      .filter(u => !tried.has(imageKey(u)));
    // The first few are checked TOGETHER (one slow picture no longer holds up the rest), then taken in rank order
    const checked = await Promise.all(usable.slice(0, 4).map(u => probeImage(u, 5000, true)));
    for (let i = 0; i < usable.length; i++) {
      const url = usable[i];
      tried.add(imageKey(url));
      if (i < checked.length ? !checked[i] : !(await probeImage(url, 5000, true))) continue;
      if ((await inspectCover(url)) === 'render') { renders.push(url); continue; }
      return url;
    }
    return '';
  };
  const tried = new Set<string>();
  // Early accept: the moment Apple or Google hands over an English cover that loads, is front-shaped and is flat, it is taken: no waiting for the slower source or for Open Library
  let early: ((u: string) => void) | undefined;
  const earlyWin = new Promise<string>(r => { early = r; });
  const seen = new Set<string>();
  const onEarly = (list: CoverCandidate[]) => {
    for (const c of rankCandidates(list)) {
      if (c.foreign || c.source === 'openlibrary' || seen.has(c.url) || (ownUrl && imageKey(c.url) === imageKey(ownUrl))) continue;
      seen.add(c.url);
      void (async () => {
        if (!(await probeImage(c.url, 5000, true))) return;
        if ((await inspectCover(c.url)) === 'render') return;
        early?.(c.url);
      })();
    }
  };
  // Apple and Google first (quick); Open Library, the slow source, only when they gave nothing usable (no cover, a render, or another language's)
  const quickList = loadCoverCandidates(b, onEarly, undefined, { fast: true }).catch(() => [] as CoverCandidate[]);
  const quick = await Promise.race([earlyWin, quickList.then(tryList)]);
  if (quick) return quick;
  const full = await tryList(await loadCoverCandidates(b, () => {}).catch(() => [] as CoverCandidate[]));
  if (full) return full;
  return hasOwn ? '' : renders[0] || '';
}

/**
 * Find a working cover for a book whose own link is missing or broken. Returns the URL, or '' when nothing reliable exists.
 * Remembered per book; concurrent calls for the same book share one lookup.
 */
export function resolveCover(b: MissingBook, opts: { force?: boolean; background?: boolean } = {}): Promise<string> {
  const key = coverKey(b);
  if (!opts.force) {
    const known = getCoverFix(b);
    if (known) return Promise.resolve(known);
    const none = read<number>(NONE_KEY)[key];
    if (none && Date.now() - none < NONE_TTL) return Promise.resolve('');
  }
  const w = waiting.get(key);
  if (w && !opts.background && !w.high) { w.high = true; pumpLookups(); } // a visible cover asks for a book that was queued in the background: it moves up
  return dedupeInflight(inflight, key, () => lookupSlot(key, !opts.background, async () => {
    let url = '';
    const trouble = transientFailureCount();
    try { url = await search(b); } catch {}
    // The owner rejected this picture for every reader: take the best other cover instead of it
    if (url && isCoverRejected(b, url)) url = (await loadCoverCandidates(b, () => {}).catch(() => [] as CoverCandidate[])).find(c => !c.foreign)?.url || '';
    if (url) {
      saveFix(key, url, ownLinkOf(b));
      emitFixes();
    } else if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      // "No cover anywhere" is remembered for a day only when every site really answered. A timeout, a rate limit or an error says nothing about the book,
      // so then it is remembered for 5 minutes only (a stampede of lookups no longer leaves a book on a placeholder for 24 hours)
      // A FIRST miss (nothing stored for the book yet, as after Refresh Book Covers) is remembered for 2 minutes only, so the next view tries again; a repeated clean miss is remembered for the day.
      const none = read<number>(NONE_KEY);
      const repeated = key in none && transientFailureCount() === trouble;
      none[key] = repeated ? Date.now() : Date.now() - NONE_TTL + (transientFailureCount() === trouble ? 2 : 5) * 60 * 1000;
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
        const url = await resolveCover(book, { force: true, background: true });
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
export function refreshBookCovers(opts: { keepShelfCovers?: boolean } = {}): number {
  const count = Object.keys(fixes).length;
  // The saved answers a cover is chosen from: each book's resolved result, the shelves built from them and the cover viewer's lists. (Ratings are looked up again with them.)
  // (`keepShelfCovers`: a new build keeps the shelves' saved covers, so the Store never starts from placeholders)
  clearCaches([COVER_CACHE_KEYS.resolved, ...(opts.keepShelfCovers ? [] : [COVER_CACHE_KEYS.shelves]), COVER_CACHE_KEYS.candidates]);
  fixes = {};
  try { localStorage.removeItem(FIX_KEY); localStorage.removeItem(NONE_KEY); } catch {}
  inflight.clear();
  missing.clear();
  lastNotFound = [];
  emitMissing();
  emitFixes();
  return count;
}

/**
 * "Refresh Book Covers" in full: forget every saved cover choice (refreshBookCovers), drop the browser's saved Open Library / Google / Apple answers (the service worker
 * keeps them for 12 hours and would hand the same old answer back), and fetch the covers published for everyone right now. Your own picks and your data are untouched.
 * Pictures already on the device stay: a new choice is a different picture, and an unchanged one need not be downloaded again. The caller reloads the page afterwards.
 */
export async function refreshAllCovers(opts: { keepShelfCovers?: boolean } = {}): Promise<number> {
  const count = refreshBookCovers(opts);
  try { await (globalThis as any).caches?.delete('rl-api-v1'); } catch {}
  await syncSharedCovers({ force: true }).catch(() => false);
  return count;
}
