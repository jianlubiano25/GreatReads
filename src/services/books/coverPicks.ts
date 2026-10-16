import { cleanPicks, coverSourceOf, isHttps, pickSizedUrl, type CoverPick, type CoverSource } from './coverRecords';
import { coverKey, notifyCoversChanged, type CoverSize } from './covers';
import { getSharedPick, sharedCoverPicks, sharedCoversVersion } from './sharedCovers';
import { authorKey, isUnknownAuthor, titleKey } from './identity';

export { COVER_SOURCE_LABEL, coverSourceOf, pickSizedUrl, pickBook, type CoverPick, type CoverSource } from './coverRecords';

/**
 * Cover picks: the cover YOU chose for a book (the star in the cover viewer).
 *
 * A pick is plain data (book key, https URL, where it came from) kept under its OWN storage key, apart from the clearable cover caches:
 * "Refresh Book Covers", the storage-full cleanup and cache expiry never touch it. It is part of Backup & Restore (see useReadingLife).
 * It is keyed like every other cover record (title + author, see coverKey), so one pick reaches every card of that book at once: Store,
 * Library, the nook, the book info and search. It wins over a repaired cover and over the book's own link. A pick that stops loading is set
 * aside for this session only (the normal cover shows, never a blank) and is kept, so a bad connection does not lose your choice.
 *
 * A pick is the OWNER's draft: it applies on this device at once. Publishing (coverPublish.ts) sends the set to the shared store, after which
 * everyone draws it (sharedCovers.ts). Your own pick wins over the published one on your device; everyone else sees the published set.
 */

export const PICKS_KEY = 'readlife.coverPicks1'; // deliberately NOT registered as clearable: this is the user's own choice
const MAX_PICKS = 1000;
const SOURCES: readonly string[] = ['apple', 'google', 'openlibrary', 'link'];

let picks: Record<string, CoverPick> | undefined;
const all = (): Record<string, CoverPick> => {
  if (!picks) {
    try { picks = cleanPicks(JSON.parse(localStorage.getItem(PICKS_KEY) || '{}')); } catch { picks = {}; }
  }
  return picks;
};
const persist = () => { try { localStorage.setItem(PICKS_KEY, JSON.stringify(all())); } catch {} };

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
  map[key] = { url: pick.url, source: pick.source && SOURCES.includes(pick.source) ? pick.source : coverSourceOf(pick.url), t: Date.now(), title: book.title.trim().slice(0, 200), ...(book.author?.trim() ? { author: book.author.trim().slice(0, 200) } : {}) };
  const keys = Object.keys(map);
  if (keys.length > MAX_PICKS) keys.slice(0, keys.length - MAX_PICKS).forEach(k => delete map[k]);
  failed.delete(pick.url);
  picksRev++;
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
  picksRev++;
  persist();
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
