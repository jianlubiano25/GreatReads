/**
 * The reader's Store layout: which shelves come first and which are hidden.
 *
 * This is deliberately separate from shelf DATA (books, caches, refresh times). Moving or hiding a shelf only edits this small
 * record; the shelf's saved list, its schedule and its last-updated time are never touched, so a hidden shelf comes back exactly
 * as it was, and a refresh (scheduled or manual) never disturbs the layout.
 *
 * Shelves the saved layout has never seen (added by a later app update) take their place in the default order, right after the
 * shelf that precedes them by default, instead of piling up at the end or disappearing.
 */

export interface StorePrefs { order: string[]; hidden: string[] }

export const STORE_PREFS_KEY = 'readlife.storeprefs1';
export const NO_PREFS: StorePrefs = { order: [], hidden: [] };

const strings = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : []);

export function loadStorePrefs(): StorePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_PREFS_KEY) || 'null');
    if (raw && typeof raw === 'object') return { order: strings(raw.order), hidden: strings(raw.hidden) };
  } catch {}
  return NO_PREFS;
}

/** Returns false when the device refused the write (the layout then lasts only until the app closes). */
export function saveStorePrefs(p: StorePrefs): boolean {
  try { localStorage.setItem(STORE_PREFS_KEY, JSON.stringify(p)); return true; } catch { return false; }
}

/** The full shelf order to show: the saved order, minus shelves that no longer exist, plus new shelves in their default place. */
export function orderShelves(defaultIds: string[], saved: string[]): string[] {
  const exists = new Set(defaultIds);
  const out = strings(saved).filter(id => exists.has(id));
  const placed = new Set(out);
  defaultIds.forEach((id, i) => {
    if (placed.has(id)) return;
    const before = i > 0 ? out.indexOf(defaultIds[i - 1]) : -1; // the default predecessor is always placed already
    out.splice(before + 1, 0, id);
    placed.add(id);
  });
  return out;
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

export const toggleHidden = (hidden: string[], id: string): string[] => (hidden.includes(id) ? hidden.filter(h => h !== id) : [...hidden, id]);
