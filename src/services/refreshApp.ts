/**
 * "Refresh App & Data": the whole app, fresh, without touching what is yours.
 *  - forgets everything this device only downloaded or worked out (the re-downloadable caches: resolved books, shelves, cover lookups, learned names, ...);
 *  - fetches the covers published for everyone again (refreshAllCovers);
 *  - deletes the browser's saved copy of the app (Cache Storage) and the service worker that serves it, and re-fetches the page itself past the HTTP cache,
 *    so the next load is the newest version (the app registers a new worker on that load).
 * NOT touched: your library, reading history, notes, highlights, settings, cover picks, and the owner's title/author choices (see NEVER_CLEAR in books/cache.ts).
 * The caller reloads the page afterwards. Needs a connection: with none the saved copy would be deleted and nothing fetched, so it is refused.
 */
import { clearCaches, clearableCacheKeys } from './books/cache';
import { refreshAllCovers } from './books/coverLookup';
import { EXTRA_CLEARABLE } from '../hooks/useReadingLife';

export async function refreshEverything(): Promise<boolean> {
  try { if (typeof navigator !== 'undefined' && navigator.onLine === false) return false; } catch {}
  try { await refreshAllCovers(); } catch {}
  try { clearCaches([...clearableCacheKeys(), ...EXTRA_CLEARABLE]); } catch {}
  try {
    const c = (globalThis as any).caches;
    if (c?.keys) await Promise.all((await c.keys()).map((n: string) => c.delete(n)));
  } catch {}
  try {
    const regs = await (globalThis as any).navigator?.serviceWorker?.getRegistrations?.();
    if (regs) await Promise.all(regs.map((r: any) => r.unregister()));
  } catch {}
  try { await Promise.all(['/', '/index.html', '/version.json'].map(u => fetch(u, { cache: 'reload' }).catch(() => null))); } catch {}
  return true;
}

/**
 * What this device downloaded or worked out (re-downloadable caches, covers published for everyone) is forgotten ONLY when a rule changed in a way that makes the
 * saved copy wrong: bump DATA_VERSION in that commit. It is NOT forgotten on every deploy: wiping the Hidden Gems lists, the genre results, the on-device search
 * index, the book info and the catalog copy on every new build sent every reader's phone to download them all again at once, right when they opened the app.
 * Caches expire by themselves (each has its own lifetime) and a changed saved format is dropped alone by that cache's own check (`validate`) or its versioned key.
 * Recorded first, so a failure can never repeat on every launch. Your own data is untouched. Returns true when it ran.
 *
 * A device that holds the old marker (a build id, written by earlier builds) or none (a fresh install) has nothing saved under a different data version, so
 * nothing is forgotten: the marker is just brought up to date.
 */
export const DATA_VERSION = 1;
const BUILD_KEY = 'readlife.dataBuild1'; // one tiny control record; not a cache, so no cleanup clears it
const DATA_MARK = 'data:';
export function refreshDataForNewBuild(build: string): boolean {
  if (!build || build === 'dev') return false;
  const mark = `${DATA_MARK}${DATA_VERSION}`;
  let stored: string | null;
  try { stored = localStorage.getItem(BUILD_KEY); if (stored === mark) return false; localStorage.setItem(BUILD_KEY, mark); } catch { return false; }
  if (!stored || !stored.startsWith(DATA_MARK)) return false;
  try { clearCaches([...clearableCacheKeys(), ...EXTRA_CLEARABLE]); } catch {}
  void refreshAllCovers().catch(() => {});
  return true;
}
