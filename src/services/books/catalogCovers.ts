/**
 * The published catalog, as this device keeps it: one saved copy, shown at once on launch, topped up with only what changed (see services/catalog.ts).
 * Self-contained on purpose (no imports from the cover code) so the cover chain can read it without a circular import.
 */
import { registerClearableKey } from './cache';

const KEY = 'readlife.catalog1';
registerClearableKey(KEY);

export type CatalogWork = {
  id: string; key: string | null; title: string; author: string; aliases?: string[]; authorAliases?: string[]; genres?: string[];
  identifiers?: Record<string, unknown>; updatedAt: string; cover: string | null;
  content?: { type: string; language?: string; content: string; source?: string }[];
  metadata?: { field: string; value: string; source?: string }[];
  ratings?: { source: string; average: number; count?: number; checkedAt?: string }[];
  editions?: { isbn10?: string; isbn13?: string; publisher?: string; year?: number; pages?: number; language?: string }[];
};
type Saved = { since: string; t: number; works: Record<string, CatalogWork> };

let saved: Saved | undefined;
export const catalogCopy = (): Saved => {
  if (!saved) {
    try {
      const r = JSON.parse(localStorage.getItem(KEY) || 'null');
      saved = r && r.works && typeof r.works === 'object' ? { since: String(r.since || '-infinity'), t: Number(r.t) || 0, works: r.works } : { since: '-infinity', t: 0, works: {} };
    } catch { saved = { since: '-infinity', t: 0, works: {} }; }
  }
  return saved;
};
let byCover: Map<string, string> | undefined;
let version = 0;
export const catalogVersion = (): number => version;

export function applyCatalog(works: CatalogWork[], since?: string): boolean {
  const s = catalogCopy();
  let changed = false;
  for (const w of works) {
    if (!w || !w.id) continue;
    s.works[w.id] = w;
    changed = true;
  }
  if (since) s.since = since;
  s.t = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  if (changed) { byCover = undefined; version++; }
  return changed;
}

/** Remove works no longer published (a full refresh passes the ids that are still published). */
export function pruneCatalog(keepIds: ReadonlySet<string>): void {
  const s = catalogCopy();
  let n = 0;
  for (const id of Object.keys(s.works)) if (!keepIds.has(id)) { delete s.works[id]; n++; }
  if (n) { byCover = undefined; version++; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
}

const index = (): Map<string, string> => {
  if (!byCover) {
    byCover = new Map();
    for (const w of Object.values(catalogCopy().works)) {
      if (!w.cover || !/^https:\/\//i.test(w.cover)) continue;
      const names = [w.key, `${w.title}|${w.author}`.toLowerCase(), ...(w.aliases || []).map(a => `${a}|${w.author}`.toLowerCase())];
      for (const n of names) if (n && !byCover.has(n.toLowerCase())) byCover.set(n.toLowerCase(), w.cover);
    }
  }
  return byCover;
};

/** The catalog's cover for a book, by the app's own key (title|author, lower case). */
export const getCatalogCover = (key: string): string | undefined => index().get(key);
