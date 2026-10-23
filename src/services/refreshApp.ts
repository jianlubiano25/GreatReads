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
