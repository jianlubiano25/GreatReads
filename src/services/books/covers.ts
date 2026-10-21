/**
 * COVERS: everything about a book's cover. Being split into modules (no change in behaviour):
 *   coverAnalysis    link quality, flat-vs-render pictures (pixels / inspectCover / readCover), probeImage, coverKey   (done)
 *   coverCandidates  the covers a book has: the three sources, their ranking (English first), the candidate cache     (done)
 *   still here       finding / repairing / showing (lookup), your picks, the published set, publishing, owner mode
 * Everything is re-exported from here, so existing imports keep working.
 */
import { type Book } from '../../types';
import { clearCaches, COVER_CACHE_KEYS, registerClearableKey } from './cache';
import { dedupeInflight, mapPool, pool, transientFailureCount } from './http';
import { isUnknownAuthor, authorKey, titleKey } from './identity';
import { olCoverById } from './sources/openLibrary';
import { coverKey, inspectCover, isWeakCover, probeImage } from './coverAnalysis';
import { imageKey, loadCoverCandidates, rankCandidates, type CoverCandidate } from './coverCandidates';

export * from './coverAnalysis';
export * from './coverCandidates';

/* ======================================================================================================
 * what a chosen cover is (shared by your picks and the published set)  (was coverRecords.ts)
 * ====================================================================================================== */

/** What a chosen cover is, shared by your own picks (covers.ts) and the set published for everyone (covers.ts). */

export type CoverSource = 'apple' | 'google' | 'openlibrary' | 'link';
export const COVER_SOURCE_LABEL: Record<CoverSource, string> = { apple: 'Apple Books', google: 'Google Books', openlibrary: 'Open Library', link: 'Original link' };
/** `title` / `author` are kept (as typed) so a list of picks can name its books; the key alone is lower-cased. */
export type CoverPick = { url: string; source: CoverSource; t: number; title?: string; author?: string };

/** Which site an image URL belongs to (so a book's own link can say where it came from). */
export function coverSourceOf(url: string): CoverSource {
  try {
    const host = new URL(url).hostname;
    if (/(^|\.)mzstatic\.com$/.test(host)) return 'apple';
    if (/(^|\.)(books\.google\.[a-z.]+|googleusercontent\.com|gstatic\.com)$/.test(host)) return 'google';
    if (/(^|\.)(openlibrary\.org|archive\.org)$/.test(host)) return 'openlibrary';
  } catch {}
  return 'link';
}

const SOURCES: readonly string[] = ['apple', 'google', 'openlibrary', 'link'];
export const isHttps = (u: unknown): u is string => typeof u === 'string' && u.length <= 1000 && /^https:\/\/[^\s]+$/i.test(u);
const short = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined);

/** Keep only well-formed picks: a record saved by another version, sent by the server, or pasted in a backup is checked entry by entry and never trusted whole. */
export function cleanPicks(raw: unknown): Record<string, CoverPick> {
  const out: Record<string, CoverPick> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, any>)) {
    if (!k || k.length > 200 || !v || typeof v !== 'object' || !isHttps(v.url)) continue;
    const rec: CoverPick = { url: v.url, source: SOURCES.includes(v.source) ? v.source : coverSourceOf(v.url), t: Number.isFinite(v.t) ? Number(v.t) : 0 };
    const title = short(v.title);
    const author = short(v.author);
    if (title) rec.title = title;
    if (author) rec.author = author;
    out[k] = rec;
  }
  return out;
}

/** The book a pick is for, for a list: its saved title / author, else the words of its key ("title|author"). */
export function pickBook(key: string, rec: Pick<CoverPick, 'title' | 'author'>): { title: string; author: string } {
  const [t = '', a = ''] = key.split('|');
  return { title: rec.title || t, author: rec.author || a };
}

const OL_ID = /^(https:\/\/covers\.openlibrary\.org\/b\/id\/\d+-)[SML](\.jpg)$/;
/** A picked URL at the size a card draws: Apple art is resized like any Apple cover, an Open Library id picks its own S / M / L file. */
export function pickSizedUrl(url: string, size: CoverSize): string {
  const m = OL_ID.exec(url);
  return m ? `${m[1]}${size}${m[2]}` : sizedCoverUrl(url, size);
}

/* ======================================================================================================
 * the set of covers published for everyone  (was sharedCovers.ts)
 * ====================================================================================================== */

/**
 * The covers published for EVERYONE (the owner's picks, served by functions/api/covers.js). Read-only here: the app keeps one copy on this
 * device, shows it at once on the next launch, and asks the server for a newer one only now and then:
 *   - not more than once every 10 minutes (and a failed try waits a minute), however often the app is opened or brought back;
 *   - with the saved ETag, so "nothing changed" costs a tiny 304 answer and no download;
 *   - never while offline, and never blocking anything: a failure just means the saved copy is used.
 * Cards re-draw only when the version really changed. The copy is re-downloadable, so it is registered as clearable.
 */

const KEY = 'readlife.sharedCovers1';
registerClearableKey(KEY);
const MIN_GAP = 10 * 60 * 1000;
const RETRY_GAP = 60 * 1000;

type Saved = { v: number; etag: string; t: number; picks: Record<string, CoverPick> };
let saved: Saved | undefined;
const copy = (): Saved => {
  if (!saved) {
    try {
      const r = JSON.parse(localStorage.getItem(KEY) || 'null');
      saved = r && typeof r === 'object' && r.picks ? { v: Number(r.v) || 0, etag: typeof r.etag === 'string' ? r.etag : '', t: Number(r.t) || 0, picks: cleanPicks(r.picks) } : { v: 0, etag: '', t: 0, picks: {} };
    } catch {
      saved = { v: 0, etag: '', t: 0, picks: {} };
    }
  }
  return saved;
};
const persistShared = () => { try { localStorage.setItem(KEY, JSON.stringify(copy())); } catch {} };

export const getSharedPick = (key: string): CoverPick | undefined => copy().picks[key];
export const sharedCoverPicks = (): Record<string, CoverPick> => ({ ...copy().picks });
export const sharedCoversVersion = (): number => copy().v;

/** Take a set from the server (a sync or the owner's own publish). Cards re-draw only when the version differs from what is held. */
export function applySharedCovers(v: number, picks: unknown, etag = `"${v}"`): void {
  const s = copy();
  const changed = v !== s.v;
  saved = { v, etag, t: Date.now(), picks: cleanPicks(picks) };
  persistShared();
  if (changed) notifyCoversChanged();
}

let syncing: Promise<boolean> | undefined;
let lastTry = 0;

/** Bring the saved copy up to date. Resolves true when the copy is current, false when it could not be checked (the saved copy stays in use). */
export function syncSharedCovers(opts: { force?: boolean } = {}): Promise<boolean> {
  if (syncing) return syncing;
  const s = copy();
  const now = Date.now();
  if (!opts.force && (now - s.t < MIN_GAP || now - lastTry < RETRY_GAP)) return Promise.resolve(now - s.t < MIN_GAP);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve(false);
  lastTry = now;
  syncing = (async () => {
    try {
      const res = await fetch('/api/covers', { headers: s.etag ? { 'If-None-Match': s.etag } : {} });
      if (res.status === 304) { s.t = Date.now(); persistShared(); return true; }
      if (!res.ok) return false;
      const body = await res.json();
      if (!body || typeof body !== 'object' || !body.picks || typeof body.picks !== 'object') return false;
      applySharedCovers(Number(body.v) || 0, body.picks, res.headers.get('etag') || `"${Number(body.v) || 0}"`);
      return true;
    } catch {
      return false;
    } finally {
      syncing = undefined;
    }
  })();
  return syncing;
}

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

/* ---------------- stores: repaired covers (rare) and the missing list (for the button) ---------------- */

const FIX_KEY = 'readlife.coverFix1'; // key -> { url, t }
const NONE_KEY = 'readlife.coverNone3'; // key -> time of the last miss
registerClearableKey(FIX_KEY);
registerClearableKey(NONE_KEY);
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
export const getCoverFix = (book: CoverLinks): string => {
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


const lookupSlots = pool(6); // covers are looked up six at a time (a results page shows nine at once), however many ask
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
  // Apple and Google first (quick); Open Library, the slow source, only when they gave nothing usable (no cover, a render, or another language's)
  const quick = await tryList(await loadCoverCandidates(b, () => {}, undefined, { fast: true }).catch(() => [] as CoverCandidate[]));
  if (quick) return quick;
  const full = await tryList(await loadCoverCandidates(b, () => {}).catch(() => [] as CoverCandidate[]));
  if (full) return full;
  return hasOwn ? '' : renders[0] || '';
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
    const trouble = transientFailureCount();
    try { url = await search(b); } catch {}
    if (url) {
      saveFix(key, url, ownLinkOf(b));
      emitFixes();
    } else if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      // "No cover anywhere" is remembered for a day only when every site really answered. A timeout, a rate limit or an error says nothing about the book,
      // so then it is remembered for 5 minutes only (a stampede of lookups no longer leaves a book on a placeholder for 24 hours)
      const none = read<number>(NONE_KEY);
      none[key] = transientFailureCount() === trouble ? Date.now() : Date.now() - NONE_TTL + 5 * 60 * 1000;
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
  // The saved answers a cover is chosen from: each book's resolved result, the shelves built from them and the cover viewer's lists. (Ratings are looked up again with them.)
  clearCaches([COVER_CACHE_KEYS.resolved, COVER_CACHE_KEYS.shelves, COVER_CACHE_KEYS.candidates]);
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
export async function refreshAllCovers(): Promise<number> {
  const count = refreshBookCovers();
  try { await (globalThis as any).caches?.delete('rl-api-v1'); } catch {}
  await syncSharedCovers({ force: true }).catch(() => false);
  return count;
}

/* ======================================================================================================
 * the cover YOU picked  (was coverPicks.ts)
 * ====================================================================================================== */

/**
 * Cover picks: the cover YOU chose for a book (the star in the cover viewer).
 *
 * A pick is plain data (book key, https URL, where it came from) kept under its OWN storage key, apart from the clearable cover caches:
 * "Refresh Book Covers", the storage-full cleanup and cache expiry never touch it. It is part of Backup & Restore (see useReadingLife).
 * It is keyed like every other cover record (title + author, see coverKey), so one pick reaches every card of that book at once: Store,
 * Library, the nook, the book info and search. It wins over a repaired cover and over the book's own link. A pick that stops loading is set
 * aside for this session only (the normal cover shows, never a blank) and is kept, so a bad connection does not lose your choice.
 *
 * A pick is the OWNER's draft: it applies on this device at once. Publishing (covers.ts) sends the set to the shared store, after which
 * everyone draws it (covers.ts). Your own pick wins over the published one on your device; everyone else sees the published set.
 */

export const PICKS_KEY = 'readlife.coverPicks1'; // deliberately NOT registered as clearable: this is the user's own choice
const MAX_PICKS = 1000;
const PICK_SOURCES: readonly string[] = ['apple', 'google', 'openlibrary', 'link'];

let picks: Record<string, CoverPick> | undefined;
const all = (): Record<string, CoverPick> => {
  if (!picks) {
    try { picks = cleanPicks(JSON.parse(localStorage.getItem(PICKS_KEY) || '{}')); } catch { picks = {}; }
  }
  return picks;
};
const persistPicks = () => { try { localStorage.setItem(PICKS_KEY, JSON.stringify(all())); } catch {} };

/** Picks that failed to load during this session (not saved). */
const failed = new Set<string>();

/**
 * The same book is spelled differently by different sources ("Dune: Deluxe Edition" / "Dune", "J.K. Rowling" / "J. K. Rowling"), so a pick saved
 * under one spelling must still reach a search result with another. The loose key is the title without subtitle / brackets / article + the author's
 * surname. It is only a FALLBACK: an exact title + author match always wins, and books with an unknown author are never matched loosely.
 */
const looseKey = (title = '', author = ''): string => {
  const t = titleKey(title);
  if (!t || isUnknownAuthor(author)) return '';
  return `${t}|${authorKey(author).split(' ').pop()}`;
};
const splitKey = (k: string): [string, string] => { const i = k.lastIndexOf('|'); return i < 0 ? [k, ''] : [k.slice(0, i), k.slice(i + 1)]; };
let picksRev = 0; // bumped whenever the owner's own picks change
let loose: { rev: number; shared: number; mine: Map<string, CoverPick>; pub: Map<string, CoverPick> } | undefined;
const looseIndex = () => {
  const shared = sharedCoversVersion();
  if (!loose || loose.rev !== picksRev || loose.shared !== shared) {
    const build = (src: Record<string, CoverPick>) => {
      const m = new Map<string, CoverPick>();
      for (const [k, p] of Object.entries(src)) { const [t, a] = splitKey(k); const lk = looseKey(t, a); if (lk && !m.has(lk)) m.set(lk, p); }
      return m;
    };
    loose = { rev: picksRev, shared, mine: build(all()), pub: build(sharedCoverPicks()) };
  }
  return loose;
};

/** The cover in use for this book: your own pick, else the one published for everyone; undefined when neither (or it failed to load this session). */
export function getCoverPickInfo(book: { title?: string; author?: string }): CoverPick | undefined {
  const key = coverKey(book);
  const ok = (p?: CoverPick) => (p && !failed.has(p.url) ? p : undefined);
  const exact = ok(all()[key]) ?? ok(getSharedPick(key));
  if (exact) return exact;
  const lk = looseKey(book.title, book.author);
  if (!lk) return undefined;
  const idx = looseIndex();
  return ok(idx.mine.get(lk)) ?? ok(idx.pub.get(lk));
}

/** Your own pick for this book (not the published one). */
export const getMyCoverPick = (book: { title?: string; author?: string }): CoverPick | undefined => all()[coverKey(book)];

/** The picked cover URL at `size`, or ''. */
export function getCoverPick(book: { title?: string; author?: string }, size: CoverSize = 'M'): string {
  const p = getCoverPickInfo(book);
  return p ? pickSizedUrl(p.url, size) : '';
}

export function setCoverPick(book: { title?: string; author?: string }, pick: { url: string; source?: CoverSource }): boolean {
  if (!book.title || !isHttps(pick.url)) return false;
  const map = all();
  const key = coverKey(book);
  delete map[key]; // newest last
  map[key] = { url: pick.url, source: pick.source && PICK_SOURCES.includes(pick.source) ? pick.source : coverSourceOf(pick.url), t: Date.now(), title: book.title.trim().slice(0, 200), ...(book.author?.trim() ? { author: book.author.trim().slice(0, 200) } : {}) };
  const keys = Object.keys(map);
  if (keys.length > MAX_PICKS) keys.slice(0, keys.length - MAX_PICKS).forEach(k => delete map[k]);
  failed.delete(pick.url);
  picksRev++;
  persistPicks();
  notifyCoversChanged();
  return true;
}

/** Back to the automatic cover. */
export function clearCoverPick(book: { title?: string; author?: string }): void {
  const map = all();
  const key = coverKey(book);
  if (!map[key]) return;
  delete map[key];
  picksRev++;
  persistPicks();
  notifyCoversChanged();
}

/** The picked image could not be loaded: show the normal cover for the rest of this session (the pick itself is kept). */
export function markCoverPickFailed(book: { title?: string; author?: string }): void {
  const p = getCoverPickInfo(book);
  if (!p) return;
  failed.add(p.url);
  notifyCoversChanged();
}

/* ---------------- Backup & Restore ---------------- */

export const exportCoverPicks = (): Record<string, CoverPick> => ({ ...all() });

/** Replace every pick with these (checked entry by entry). Returns how many were kept. */
export function restoreCoverPicks(raw: unknown): number {
  picks = cleanPicks(raw);
  picksRev++;
  failed.clear();
  persistPicks();
  notifyCoversChanged();
  return Object.keys(picks).length;
}

/** Restore the picks inside a pasted backup. A backup without a `coverPicks` part (made before picks existed) leaves the current picks alone; returns null then. */
export function restoreCoverPicksFromBackup(text: string): number | null {
  try {
    let t = String(text ?? '').trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('\u201C') && t.endsWith('\u201D'))) t = t.slice(1, -1).trim();
    const parsed = JSON.parse(t.replace(/[\u201C\u201D]/g, '"'));
    if (!parsed || typeof parsed !== 'object' || !('coverPicks' in parsed)) return null;
    return restoreCoverPicks(parsed.coverPicks);
  } catch {
    return null;
  }
}

/* ======================================================================================================
 * publishing your picks for everyone (owner)  (was coverPublish.ts)
 * ====================================================================================================== */

/** Publishing the owner's picks for everyone (used only by the Publish book covers screen, which loads on demand). */

export type PublishResult =
  | { ok: true; count: number; dropped: number }
  | { ok: false; reason: 'unauthorized' | 'not_configured' | 'too_large' | 'invalid' | 'network' | 'error' };

/**
 * What will be published: what is already published, with your own picks laid over it (yours win), minus what you removed.
 * Starting from the published set means a new phone with no picks of its own can never wipe the set by publishing.
 */
export function buildDraft(shared: Record<string, CoverPick>, mine: Record<string, CoverPick>, removed: ReadonlySet<string>): Record<string, CoverPick> {
  const out: Record<string, CoverPick> = { ...shared, ...mine };
  removed.forEach(k => delete out[k]);
  return out;
}

export type DraftStatus = 'new' | 'changed' | 'published';
export const draftStatus = (key: string, rec: CoverPick, shared: Record<string, CoverPick>): DraftStatus => (!shared[key] ? 'new' : shared[key].url !== rec.url ? 'changed' : 'published');

/** How many entries differ from what is published: added or changed, and taken away. */
export function countChanges(draft: Record<string, CoverPick>, shared: Record<string, CoverPick>): { changed: number; removed: number } {
  let changed = 0;
  for (const [k, rec] of Object.entries(draft)) if (draftStatus(k, rec, shared) !== 'published') changed++;
  const removed = Object.keys(shared).filter(k => !(k in draft)).length;
  return { changed, removed };
}

export async function publishCovers(draft: Record<string, CoverPick>, token: string): Promise<PublishResult> {
  let res: Response;
  try {
    res = await fetch('/api/covers', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ picks: draft }) });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (!res.ok) {
    let error = '';
    try { error = String((await res.json())?.error || ''); } catch {}
    if (res.status === 401) return { ok: false, reason: 'unauthorized' };
    if (res.status === 503 && error === 'not_configured') return { ok: false, reason: 'not_configured' };
    if (res.status === 413) return { ok: false, reason: 'too_large' };
    if (res.status === 400) return { ok: false, reason: 'invalid' };
    return { ok: false, reason: 'error' };
  }
  try {
    const body = await res.json();
    applySharedCovers(Number(body.v) || Date.now(), body.picks); // everyone, this device included, now draws the published set
    return { ok: true, count: Object.keys(body.picks || {}).length, dropped: Number(body.dropped) || 0 };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/* ======================================================================================================
 * owner mode (the cover admin token)  (was coverAdmin.ts)
 * ====================================================================================================== */

/**
 * The owner's hidden cover tools. Nothing here is security: it only keeps the cover button and "Publish book covers" out of everyone's way.
 * Tapping the name in the Today greeting five times switches the tools on (five more switch them off). What really protects the shared covers
 * is the secret token the server checks when something is published (functions/api/covers.js); it is typed once and kept on this device only,
 * never in a backup.
 */
const ON_KEY = 'readlife.coverAdmin1';
const TOKEN_KEY = 'readlife.coverToken1';
const TAPS = 5;
const WINDOW_MS = 3000;

const readAdmin = (k: string): string => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
let on = readAdmin(ON_KEY) === '1';
const listeners = new Set<() => void>();

export const isCoverAdminOn = (): boolean => on;
export const subscribeCoverAdmin = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function setCoverAdmin(next: boolean): void {
  if (next === on) return;
  on = next;
  try { next ? localStorage.setItem(ON_KEY, '1') : localStorage.removeItem(ON_KEY); } catch {}
  listeners.forEach(l => l());
}

let taps: number[] = [];
/** Call on every tap of the name. Returns the new state (true = tools shown) on the fifth tap within 3 seconds, else undefined. */
export function tapSecret(now = Date.now()): boolean | undefined {
  taps = taps.filter(t => now - t < WINDOW_MS);
  taps.push(now);
  if (taps.length < TAPS) return undefined;
  taps = [];
  setCoverAdmin(!on);
  return on;
}

export const getCoverToken = (): string => readAdmin(TOKEN_KEY);
export function setCoverToken(token: string): void {
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch {}
}
