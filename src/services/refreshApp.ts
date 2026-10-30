/**
 * "Refresh App & Data": the whole app, fresh, without touching what is yours.
 *  - forgets everything this device only downloaded or worked out (the re-downloadable caches: resolved books, shelves, cover lookups, learned names, ...);
 *  - fetches the covers published for everyone again (refreshAllCovers);
 *  - deletes the browser's saved copy of the app (Cache Storage) and the service worker that serves it, and re-fetches the page itself past the HTTP cache,
 *    so the next load is the newest version (the app registers a new worker on that load).
 * NOT touched: your library, reading history, notes, highlights, settings, cover picks, and the owner's title/author choices (see NEVER_CLEAR in books/cache.ts).
 * The caller reloads the page afterwards. Needs a connection: with none the saved copy would be deleted and nothing fetched, so it is refused.
 */
import { clearCaches, clearableCacheKeys, KEEP_ACROSS_BUILDS } from './books/cache';
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
 * The saved downloads of an older version are forgotten ONCE per DATA_EPOCH, not on every new build. Every build used to wipe everything (genre lists, Hidden Gems,
 * the browser's saved provider answers), so the first searches after every update started from nothing and leaned on slow providers for 10-15 minutes (weak genre
 * results, empty Hidden Gems). A normal update now keeps the last good data; each cache's own rules (versioned keys such as curated3, validators, expiry, refresh
 * schedules, shelf signatures) retire what is really out of date.
 *
 * DATA_EPOCH: change this text ONLY when something an older build saved must not be trusted any more and no cache rule can tell (a search or ranking rule, a saved
 * shape, a cover rule changed without bumping that cache's own key). Devices then clear once, automatically, on their next start: the same data refresh as the button
 * (re-downloadable caches, covers published for everyone), with no reload and no change to the saved app copy. Recorded first, so a failure can never repeat on every
 * launch. Your own data is untouched. Returns true when it ran.
 * Kept even then (KEEP_ACROSS_BUILDS): the saved lists of self-refreshing shelves, their reset marks and the shelf covers (wiping them showed the hand-picked defaults and
 * cover placeholders and made one-time resets run again).
 */
export const DATA_EPOCH = 'e2-2026-10-30';
const EPOCH_KEY = 'readlife.dataEpoch1'; // one tiny control record; not a cache, so no cleanup clears it
export function refreshDataForNewBuild(build: string, epoch: string = DATA_EPOCH): boolean {
  if (!build || build === 'dev') return false;
  try { if (localStorage.getItem(EPOCH_KEY) === epoch) return false; localStorage.setItem(EPOCH_KEY, epoch); } catch { return false; }
  try { clearCaches([...clearableCacheKeys().filter(k => !KEEP_ACROSS_BUILDS.includes(k)), ...EXTRA_CLEARABLE]); } catch {}
  void refreshAllCovers({ keepShelfCovers: true }).catch(() => {});
  return true;
}
