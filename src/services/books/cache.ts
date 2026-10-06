/** A small localStorage-backed map with an expiry and a size cap. Failures (private mode, full storage) are silent: it is only a cache. */

export interface Cache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
}

export function persistentCache<T>(storageKey: string, opts: { ttl: number; max: number }): Cache<T> {
  type Entry = { t: number; v: T };
  const mem = new Map<string, Entry>();
  let loaded = false;

  const load = () => {
    if (loaded) return;
    loaded = true;
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) || '{}');
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [k, e] of Object.entries<any>(raw)) if (e && typeof e.t === 'number') mem.set(k, e);
    } catch {}
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const keys = [...mem.keys()];
        if (keys.length > opts.max) keys.slice(0, keys.length - opts.max).forEach(k => mem.delete(k));
        localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(mem)));
      } catch {}
    }, 400);
  };

  return {
    get(key) {
      load();
      const e = mem.get(key);
      if (!e) return undefined;
      if (Date.now() - e.t > opts.ttl) { mem.delete(key); return undefined; }
      return e.v;
    },
    set(key, value) {
      load();
      mem.delete(key); // newest entries live at the end, so the oldest are dropped first
      mem.set(key, { t: Date.now(), v: value });
      save();
    },
    delete(key) {
      load();
      if (mem.delete(key)) save();
    },
  };
}

/** Cache keys older versions of the app used for book data. Removed at startup so they do not eat the 5 MB storage budget. */
export const LEGACY_BOOK_CACHE_KEYS = [
  'readlife.store1', 'readlife.store2', 'readlife.store3', 'readlife.meta2', 'readlife.meta3',
  'readlife.covers1', 'readlife.coverMiss1', 'readlife.coverNone1',
];
export const dropLegacyBookCaches = () => {
  try { LEGACY_BOOK_CACHE_KEYS.forEach(k => localStorage.removeItem(k)); } catch {}
};
