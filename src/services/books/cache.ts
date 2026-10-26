import { bump, timed } from './perf';

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

/** Every localStorage key the app can download again, so the "storage is full" cleanup can never go stale. */
const clearableKeys = new Set<string>();

/** Marks a localStorage key as re-downloadable (safe to wipe when storage is full). */
export const registerClearableKey = (key: string) => { clearableKeys.add(key); };

/** Keys that are safe to clear: registered caches plus the old cache keys older versions used. */
/** Saved with persistentCache but a choice of the reader, not a download: no cleanup or refresh may ever clear it. */
export const NEVER_CLEAR: readonly string[] = ['readlife.nameChoices1'];
export const clearableCacheKeys = (): string[] => [...new Set([...clearableKeys, ...LEGACY_BOOK_CACHE_KEYS, 'readlife.curated1', 'readlife.curated2'])].filter(k => !NEVER_CLEAR.includes(k));

export function persistentCache<T>(storageKey: string, opts: {
  ttl: number;
  max: number;
  keepStale?: number;
  /**
   * Safe migration: an entry saved by another version of the app in a shape this version cannot use is dropped (alone) when the cache is read,
   * instead of crashing a screen or being trusted. The other entries, and everything outside this cache, are left as they are.
   */
  validate?: (value: any) => boolean;
}): Cache<T> {
  registerClearableKey(storageKey);
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
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const keys = [...mem.keys()];
        if (keys.length > opts.max) keys.slice(0, keys.length - opts.max).forEach(k => mem.delete(k));
        timed(`cache.${storageKey}.save`, () => {
          const text = JSON.stringify(Object.fromEntries(mem));
          bump(`cache.${storageKey}.saveBytes`, text.length);
          localStorage.setItem(storageKey, text);
        });
      } catch {}
    }, 400);
  };

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
    clear() {
      loaded = true;
      mem.clear();
      clearTimeout(timer);
      try { localStorage.removeItem(storageKey); } catch {}
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
