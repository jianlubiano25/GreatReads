/**
 * coverPicks: what a chosen cover is, the cover YOU picked, the set published for everyone, publishing it, and the owner's admin token tools.
 * (Split out of covers.ts; no change in behaviour.)
 */
import { registerClearableKey } from './cache';
import { isUnknownAuthor, authorKey, titleKey } from './identity';
import { coverKey } from './coverAnalysis';
import { getCatalogCover } from './catalogCovers';
import { isCoverRejected } from './rejectedCovers';
import { notifyCoversChanged, sizedCoverUrl, type CoverSize } from './coverLookup';

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
const persistPicks = () => {
  try { localStorage.setItem(PICKS_KEY, JSON.stringify(all())); } catch {}
  // Tells the cloud sync a synced preference changed on this device, so it uploads soon instead of waiting for the next other edit.
  try { if (typeof window !== 'undefined') window.dispatchEvent(new Event('greatreads-library-local-change')); } catch {}
};

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

/** The cover in use for this book: your own pick, else the catalog's, else the one published for everyone; undefined when neither (or it failed to load this session). */
export function getCoverPickInfo(book: { title?: string; author?: string }): CoverPick | undefined {
  const key = coverKey(book);
  const ok = (p?: CoverPick) => (p && !failed.has(p.url) && !isCoverRejected(book, p.url) ? p : undefined);
  const cat = getCatalogCover(key);
  const fromCatalog = cat ? ok({ url: cat, source: coverSourceOf(cat), t: 0 }) : undefined; // your pick, then the catalog, then the older shared set
  const exact = ok(all()[key]) ?? fromCatalog ?? ok(getSharedPick(key));
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
