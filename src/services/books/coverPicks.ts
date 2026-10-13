import { coverKey, notifyCoversChanged, sizedCoverUrl, type CoverSize } from './covers';

/**
 * Cover picks: the cover YOU chose for a book (the star in the cover viewer).
 *
 * A pick is plain data (book key, https URL, where it came from) kept under its OWN storage key, apart from the clearable cover caches:
 * "Refresh Book Covers", the storage-full cleanup and cache expiry never touch it. It is part of Backup & Restore (see useReadingLife).
 * It is keyed like every other cover record (title + author, see coverKey), so one pick reaches every card of that book at once: Store,
 * Library, the nook, the book info and search. It wins over a repaired cover and over the book's own link. A pick that stops loading is set
 * aside for this session only (the normal cover shows, never a blank) and is kept, so a bad connection does not lose your choice.
 *
 * Later, a per-user shared store only has to read and write these same records.
 */

export type CoverSource = 'apple' | 'google' | 'openlibrary' | 'link';
export const COVER_SOURCE_LABEL: Record<CoverSource, string> = { apple: 'Apple Books', google: 'Google Books', openlibrary: 'Open Library', link: 'Original link' };
export type CoverPick = { url: string; source: CoverSource; t: number };

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

export const PICKS_KEY = 'readlife.coverPicks1'; // deliberately NOT registered as clearable: this is the user's own choice
const MAX_PICKS = 1000;
const SOURCES: readonly string[] = ['apple', 'google', 'openlibrary', 'link'];
const isHttps = (u: unknown): u is string => typeof u === 'string' && u.length <= 1000 && /^https:\/\/[^\s]+$/i.test(u);

/** Keep only well-formed picks: a pick saved by another version, or pasted in a backup, is checked entry by entry and never trusted whole. */
function clean(raw: unknown): Record<string, CoverPick> {
  const out: Record<string, CoverPick> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, any>)) {
    if (!k || !v || typeof v !== 'object' || !isHttps(v.url)) continue;
    out[k] = { url: v.url, source: SOURCES.includes(v.source) ? v.source : coverSourceOf(v.url), t: Number.isFinite(v.t) ? Number(v.t) : 0 };
  }
  return out;
}

let picks: Record<string, CoverPick> | undefined;
const all = (): Record<string, CoverPick> => {
  if (!picks) {
    try { picks = clean(JSON.parse(localStorage.getItem(PICKS_KEY) || '{}')); } catch { picks = {}; }
  }
  return picks;
};
const persist = () => { try { localStorage.setItem(PICKS_KEY, JSON.stringify(all())); } catch {} };

/** Picks that failed to load during this session (not saved). */
const failed = new Set<string>();

const OL_ID = /^(https:\/\/covers\.openlibrary\.org\/b\/id\/\d+-)[SML](\.jpg)$/;
/** A picked URL at the size a card draws: Apple art is resized like any Apple cover, an Open Library id picks its own S / M / L file. */
export function pickSizedUrl(url: string, size: CoverSize): string {
  const m = OL_ID.exec(url);
  return m ? `${m[1]}${size}${m[2]}` : sizedCoverUrl(url, size);
}

/** The pick for this book, or undefined (none, or it failed to load this session). */
export function getCoverPickInfo(book: { title?: string; author?: string }): CoverPick | undefined {
  const p = all()[coverKey(book)];
  return p && !failed.has(p.url) ? p : undefined;
}

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
  map[key] = { url: pick.url, source: pick.source && SOURCES.includes(pick.source) ? pick.source : coverSourceOf(pick.url), t: Date.now() };
  const keys = Object.keys(map);
  if (keys.length > MAX_PICKS) keys.slice(0, keys.length - MAX_PICKS).forEach(k => delete map[k]);
  failed.delete(pick.url);
  persist();
  notifyCoversChanged();
  return true;
}

/** Back to the automatic cover. */
export function clearCoverPick(book: { title?: string; author?: string }): void {
  const map = all();
  const key = coverKey(book);
  if (!map[key]) return;
  delete map[key];
  persist();
  notifyCoversChanged();
}

/** The picked image could not be loaded: show the normal cover for the rest of this session (the pick itself is kept). */
export function markCoverPickFailed(book: { title?: string; author?: string }): void {
  const p = all()[coverKey(book)];
  if (!p || failed.has(p.url)) return;
  failed.add(p.url);
  notifyCoversChanged();
}

/* ---------------- Backup & Restore ---------------- */

export const exportCoverPicks = (): Record<string, CoverPick> => ({ ...all() });

/** Replace every pick with these (checked entry by entry). Returns how many were kept. */
export function restoreCoverPicks(raw: unknown): number {
  picks = clean(raw);
  failed.clear();
  persist();
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
