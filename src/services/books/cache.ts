import { bump, timed } from './perf';
import { forgetDurable, mirrorDurable, registerDurableKey } from '../durableCopy';

/** A small localStorage-backed map with an expiry and a size cap. Failures (private mode, full storage) are silent: it is only a cache. */

export interface Cache<T> {
  get(key: string): T | undefined;
  /** Even an expired entry, with its age: for showing something when a fresh load fails. Entries older than `keepStale` are gone. */
  peek(key: string): { value: T; ageMs: number } | undefined;
  /** `at` sets the entry's saved time (used when a choice arrives from the cloud, so it keeps the time it was really made). */
  set(key: string, value: T, at?: number): void;
  delete(key: string): void;
  /** Every live entry with the time it was saved (only caches that can list themselves). */
  entries?(): { key: string; value: T; at: number }[];
  /** Forget everything in this cache (memory and storage). */
  clear(): void;
  /** Mark every entry as expired WITHOUT removing it: `get` no longer returns it (so it is fetched again), `peek` still shows it as the last good copy while that happens. */
  expire(): void;
}

/** The saved caches that hold a book's cover choice, named once so "Refresh Book Covers" and the caches themselves cannot disagree. */
export const COVER_CACHE_KEYS = { resolved: 'readlife.resolved3', shelves: 'readlife.curated3', candidates: 'readlife.coverCands1' } as const;
const instances = new Map<string, Cache<any>>();
/** Empty the named caches, in memory as well as in storage (removing only the storage key would leave this session's copy in use). */
export const clearCaches = (keys: readonly string[]): void => {
  for (const k of keys) {
    const c = instances.get(k);
    if (c) c.clear();
    else { try { localStorage.removeItem(k); } catch {} }
  }
};

/**
 * "Last good" copies: the genre lists, the Hidden Gems rows and the saved answers of searches. A refresh (the button, or a DATA_EPOCH change) never removes them: it only
 * marks them expired, so everything is fetched again in the background while the old copy is shown at once. Wiping them left Search and Hidden Gems empty for ~10 minutes
 * (the owner's report) while the slow providers refilled them. Each cache's own `keepStale` still retires really old entries.
 */
export const LAST_GOOD_KEYS: readonly string[] = ['readlife.genrepool1', 'readlife.genregems1', 'readlife.searchlast1'];
export const expireCaches = (keys: readonly string[]): void => { for (const k of keys) { try { instances.get(k)?.expire(); } catch {} } };

/** Every localStorage key the app can download again, so the "storage is full" cleanup can never go stale. */
const clearableKeys = new Set<string>();

/** Marks a localStorage key as re-downloadable (safe to wipe when storage is full). */
export const registerClearableKey = (key: string) => { clearableKeys.add(key); };

/** Keys that are safe to clear: registered caches plus the old cache keys older versions used. */
/** Saved with persistentCache but a choice of the reader, not a download: no cleanup or refresh may ever clear it. */
export const NEVER_CLEAR: readonly string[] = ['readlife.nameChoices1'];
/** Saved shelf lists: kept when the device is merely out of storage (clearing them sent every shelf back to its starting books). "Refresh everything" still clears them. */
export const KEEP_WHEN_STORAGE_FULL: readonly string[] = ['readlife.dynseeds1', 'readlife.dynstatus1', 'readlife.dynreset1'];
export const clearableKeysWhenStorageFull = (): string[] => clearableCacheKeys().filter(k => !KEEP_WHEN_STORAGE_FULL.includes(k));

/**
 * Re-downloadable, but what makes the Store look right on the first frame: the saved lists of self-refreshing shelves, their one-time reset marks
 * (without the mark a reset fires again and drops the saved list) and the shelf covers. A new build keeps them (the data refresh of a new build
 * must not blank the Store); the explicit "Refresh App & Data" button may still clear them (the storage-full cleanup keeps the lists, see KEEP_WHEN_STORAGE_FULL).
 */
export const KEEP_ACROSS_BUILDS: readonly string[] = ['readlife.dynseeds1', 'readlife.dynreset1', COVER_CACHE_KEYS.shelves];
export const clearableCacheKeys = (): string[] => [...new Set([...clearableKeys, ...LEGACY_BOOK_CACHE_KEYS, 'readlife.curated1', 'readlife.curated2'])].filter(k => !NEVER_CLEAR.includes(k));

/** Pending (debounced) writes by cache, so a closing or backgrounded app can save them at once instead of losing the last 400 ms of results. */
const flushers = new Map<string, () => void>();
export const flushPersistentCaches = (): void => { flushers.forEach(f => { try { f(); } catch {} }); };
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('pagehide', flushPersistentCaches);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPersistentCaches(); });
}

export function persistentCache<T>(storageKey: string, opts: {
  ttl: number;
  max: number;
  keepStale?: number;
  /**
   * Safe migration: an entry saved by another version of the app in a shape this version cannot use is dropped (alone) when the cache is read,
   * instead of crashing a screen or being trusted. The other entries, and everything outside this cache, are left as they are.
   */
  validate?: (value: any) => boolean;
  /** Also keep a safety copy in IndexedDB (see durableCopy.ts) that is put back before the app draws if the browser dropped localStorage. */
  durable?: boolean;
}): Cache<T> {
  registerClearableKey(storageKey);
  if (opts.durable) registerDurableKey(storageKey);
  type Entry = { t: number; v: T };
  const mem = new Map<string, Entry>();
  let loaded = false;

  const load = () => {
    if (loaded) return;
    loaded = true;
    try {
      timed(`cache.${storageKey}.load`, () => {
        const text = localStorage.getItem(storageKey) || '{}';
        bump(`cache.${storageKey}.loadBytes`, text.length);
        const raw = JSON.parse(text);
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [k, e] of Object.entries<any>(raw)) if (e && typeof e.t === 'number' && usable(e.v)) mem.set(k, e);
      });
    } catch {}
  };
  const usable = (v: unknown) => { try { return !opts.validate || opts.validate(v); } catch { return false; } };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let lastBytes = 0;
  const writeOnce = () => {
    const keys = [...mem.keys()];
    if (keys.length > opts.max) keys.slice(0, keys.length - opts.max).forEach(k => mem.delete(k));
    timed(`cache.${storageKey}.save`, () => {
      const text = JSON.stringify(Object.fromEntries(mem));
      lastBytes = text.length;
      bump(`cache.${storageKey}.saveBytes`, text.length);
      localStorage.setItem(storageKey, text);
      if (opts.durable) mirrorDurable(storageKey, text);
    });
  };
  const write = () => {
    if (!dirty) return;
    dirty = false;
    try { writeOnce(); } catch {
      // The device's storage is full (the saved-data budget is about 5 MB for everything): count it, then keep the NEWEST half of this cache (up to four times) and try again,
      // so the cache stays inside the budget instead of silently saving nothing (a failed save used to mean "nothing remembered after the app closes")
      bump('storage.writeFailed'); bump(`storage.writeFailed.${storageKey}`);
      for (let i = 0; i < 4 && mem.size > 8; i++) {
        [...mem.keys()].slice(0, Math.floor(mem.size / 2)).forEach(k => mem.delete(k));
        bump('storage.cacheTrimmed');
        try { writeOnce(); break; } catch {}
      }
    }
  };
  const save = () => {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(write, lastBytes > 100_000 ? 2500 : 400); // a big cache is written less often (a 600 KB cache was rewritten 349 times in 30 minutes)
  };
  flushers.set(storageKey, () => { clearTimeout(timer); write(); });

  const cache: Cache<T> = {
    get(key) {
      load();
      const e = mem.get(key);
      if (!e) return undefined;
      if (Date.now() - e.t > opts.ttl) return undefined; // expired (kept for peek until keepStale)
      return e.v;
    },
    peek(key) {
      load();
      const e = mem.get(key);
      if (!e) return undefined;
      const ageMs = Date.now() - e.t;
      if (ageMs > Math.max(opts.ttl, opts.keepStale ?? opts.ttl)) { mem.delete(key); return undefined; }
      return { value: e.v, ageMs };
    },
    set(key, value, at) {
      load();
      mem.delete(key); // newest entries live at the end, so the oldest are dropped first
      mem.set(key, { t: at ?? Date.now(), v: value });
      save();
    },
    entries() {
      load();
      return [...mem.entries()].map(([key, e]) => ({ key, value: e.v, at: e.t }));
    },
    delete(key) {
      load();
      if (mem.delete(key)) save();
    },
    expire() {
      load();
      const old = Date.now() - opts.ttl - 1;
      let any = false;
      for (const e of mem.values()) if (e.t > old) { e.t = old; any = true; }
      if (any) save();
    },
    clear() {
      loaded = true;
      mem.clear();
      dirty = false;
      clearTimeout(timer);
      try { localStorage.removeItem(storageKey); } catch {}
      if (opts.durable) forgetDurable(storageKey); // a deliberate clear is not undone by the safety copy
    },
  };
  instances.set(storageKey, cache);
  return cache;
}

/** Cache keys older versions of the app used for book data. Removed at startup so they do not eat the 5 MB storage budget. */
export const LEGACY_BOOK_CACHE_KEYS = [
  'readlife.store1', 'readlife.store2', 'readlife.store3', 'readlife.meta2', 'readlife.meta3',
  'readlife.covers1', 'readlife.coverMiss1', 'readlife.coverNone1', 'readlife.coverNone2', 'readlife.coverNone3', 'readlife.ratingsrc1',
  'readlife.resolved1', 'readlife.meta4', // kept ratings from before Google editions and the validity rules were fixed
  'readlife.curated2', 'readlife.resolved2', 'readlife.meta5', 'readlife.ratingsrc2', // keyed per spelling of the author / per record id, and could hold a source found without Apple for weeks
  'readlife.shelves1', // Trending lists saved before explicit books were judged on their categories and descriptions
  'readlife.shelves2', // Trending lists saved before satanic / demonic books were excluded
];
export const dropLegacyBookCaches = () => {
  try { LEGACY_BOOK_CACHE_KEYS.forEach(k => localStorage.removeItem(k)); } catch {}
};

/** The caches that remember covers: the last to be given up when storage is full. */
const COVER_MEMORY_KEYS: readonly string[] = [COVER_CACHE_KEYS.resolved, COVER_CACHE_KEYS.shelves, COVER_CACHE_KEYS.candidates, 'readlife.coverFlat1', 'readlife.loaded', 'readlife.preload', 'readlife.preload2'];

/**
 * Storage is full and the reader's own data cannot be saved: free space ONE re-downloadable key at a time, biggest first, other caches before cover memory,
 * and stop as soon as `write` succeeds. (It used to wipe every cache at once, which also threw away the remembered covers and left placeholders after every reopen.)
 * Returns true when `write` finally succeeded. `candidates` are the keys that may be removed.
 */
export function freeSpaceThenRun(write: () => void, candidates: readonly string[]): boolean {
  const size = (k: string) => { try { return (localStorage.getItem(k) || '').length; } catch { return 0; } };
  const order = [...new Set(candidates)].filter(k => size(k) > 0)
    .sort((a, b) => Number(COVER_MEMORY_KEYS.includes(a)) - Number(COVER_MEMORY_KEYS.includes(b)) || size(b) - size(a));
  for (const k of order) {
    clearCaches([k]);
    bump('storage.evicted'); bump(`storage.evicted.${k}`);
    try { write(); return true; } catch {}
  }
  return false;
}
