/**
 * A safety copy of a few small localStorage records in IndexedDB (a browser feature, no dependency).
 * Why: the saved self-refreshing shelf lists, their one-time reset marks and the shelf covers are what make the Store look right on the first
 * frame. If the browser drops localStorage (storage pressure, a long close), they are put back from here before the app draws, instead of the
 * hand-picked default lists flashing and every cover starting as a placeholder.
 *  - Only copies of keys the caller names; nothing personal (library, notes, settings) is ever mirrored.
 *  - Best effort and silent: no IndexedDB (private mode, tests) or any error means "no copy", never a failure.
 *  - Restore only fills a key that is MISSING in localStorage. It never replaces what is there.
 *  - An explicit clear of a cache removes its copy too, so a deliberate "forget this" is not undone.
 */
export interface DurableBackend {
  put(key: string, text: string): Promise<void>;
  remove(key: string): Promise<void>;
  getAll(keys: readonly string[]): Promise<Record<string, string>>;
}

const DB = 'readlife-safety1', STORE = 'copies';

const openDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const done = (tx: IDBTransaction): Promise<void> => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });

const idbBackend: DurableBackend = {
  async put(key, text) { const db = await openDb(); try { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(text, key); await done(tx); } finally { db.close(); } },
  async remove(key) { const db = await openDb(); try { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(key); await done(tx); } finally { db.close(); } },
  async getAll(keys) {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, 'readonly');
      const out: Record<string, string> = {};
      await Promise.all(keys.map(k => new Promise<void>(res => { const r = tx.objectStore(STORE).get(k); r.onsuccess = () => { if (typeof r.result === 'string') out[k] = r.result; res(); }; r.onerror = () => res(); })));
      return out;
    } finally { db.close(); }
  },
};

let backend: DurableBackend | undefined = typeof indexedDB !== 'undefined' ? idbBackend : undefined;
/** Tests only: use an in-memory backend (or none). */
export const setDurableBackendForTests = (b?: DurableBackend) => { backend = b; };

/** The keys that have a safety copy (set by persistentCache({ durable: true })). */
const durableKeys = new Set<string>();
export const registerDurableKey = (key: string) => { durableKeys.add(key); };
export const durableKeyList = (): string[] => [...durableKeys];

export function mirrorDurable(key: string, text: string): void { try { void backend?.put(key, text).catch(() => {}); } catch {} }
export function forgetDurable(key: string): void { try { void backend?.remove(key).catch(() => {}); } catch {} }

const hasKey = (k: string): boolean => { try { return !!localStorage.getItem(k); } catch { return true; /* storage unreadable: do not touch it */ } };

/**
 * Before the app draws: for each safety-copied key that is missing in localStorage, write its copy back. Returns the keys restored.
 * With every key present (the normal case) it does not even open IndexedDB. Never waits longer than `maxMs`.
 */
export async function restoreDurableCopies(keys: readonly string[] = durableKeyList(), maxMs = 1500): Promise<string[]> {
  const missing = keys.filter(k => !hasKey(k));
  if (!missing.length || !backend) return [];
  const b = backend;
  try {
    const found = await Promise.race([b.getAll(missing), new Promise<Record<string, string>>(r => setTimeout(() => r({}), maxMs))]);
    const restored: string[] = [];
    for (const k of missing) {
      const text = found[k];
      if (typeof text !== 'string' || !text || hasKey(k)) continue; // never replace something that appeared meanwhile
      try { JSON.parse(text); localStorage.setItem(k, text); restored.push(k); } catch { /* an unreadable copy is ignored */ }
    }
    return restored;
  } catch { return []; }
}
