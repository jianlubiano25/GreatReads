/**
 * The published catalog, as this device keeps it: one saved copy, shown at once on launch, topped up with only what changed (see services/catalog.ts).
 * Self-contained on purpose (no imports from the cover code) so the cover chain can read it without a circular import.
 */
import { registerClearableKey, registerClearHook } from './cache';
import { bigGet, bigPut, bigRemove, bigStoreAvailable } from '../durableCopy';
import { authorKey, titleKey } from './identity';

const KEY = 'readlife.catalog1';
registerClearableKey(KEY);

export type CatalogWork = {
  id: string; key: string | null; title: string; author: string; aliases?: string[]; authorAliases?: string[]; genres?: string[];
  identifiers?: Record<string, unknown>; updatedAt: string; cover: string | null;
  /** Cover addresses the owner rejected: never shown or used on any device */
  rejectedCovers?: string[];
  content?: { type: string; language?: string; content: string; source?: string }[];
  metadata?: { field: string; value: string; source?: string }[];
  ratings?: { source: string; average: number; count?: number; checkedAt?: string }[];
  editions?: { isbn10?: string; isbn13?: string; publisher?: string; year?: number; pages?: number; language?: string }[];
};
type Saved = { since: string; t: number; works: Record<string, CatalogWork> };

let saved: Saved | undefined;
const EMPTY = (): Saved => ({ since: '-infinity', t: 0, works: {} });
const parseSaved = (text: string | null | undefined): Saved => {
  try {
    const r = JSON.parse(text || 'null');
    return r && r.works && typeof r.works === 'object' ? { since: String(r.since || '-infinity'), t: Number(r.t) || 0, works: r.works } : EMPTY();
  } catch { return EMPTY(); }
};
export const catalogCopy = (): Saved => {
  if (!saved) { let text: string | null = null; try { text = localStorage.getItem(KEY); } catch {} saved = parseSaved(text); }
  return saved;
};

/**
 * Where the copy lives. In a browser with IndexedDB it is kept THERE (it was 1.3 MB of the 2.7 MB the app may keep in localStorage, which left no room for the genre lists, covers
 * and book lookups: 41 failed saves in one session). It is read once before the app draws (`loadCatalogCopy`, main.tsx) and kept in memory; writes are batched. Without
 * IndexedDB (private mode, scripts, tests) nothing changes: localStorage as before. A copy found in localStorage is moved over once.
 */
let idbMode = false;
let writeTimer: ReturnType<typeof setTimeout> | undefined;
async function flushCopy(): Promise<void> {
  writeTimer = undefined;
  if (!saved) return;
  const text = JSON.stringify(saved);
  if (await bigPut(KEY, text)) { try { localStorage.removeItem(KEY); } catch {} } else { try { localStorage.setItem(KEY, text); } catch {} }
}
export const flushCatalogCopyForTests = flushCopy;
const persist = (): void => {
  if (!idbMode) { try { localStorage.setItem(KEY, JSON.stringify(catalogCopy())); } catch {} return; }
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => { void flushCopy(); }, 800);
};
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (writeTimer) { clearTimeout(writeTimer); void flushCopy(); } });

/** Before the app draws: read the copy from IndexedDB (moving an older localStorage copy over once). Never waits longer than `maxMs`; never throws. */
export async function loadCatalogCopy(maxMs = 1500): Promise<void> {
  if (!bigStoreAvailable()) return;
  let inIdb: string | undefined;
  try { inIdb = await Promise.race([bigGet(KEY), new Promise<undefined>(r => setTimeout(() => r(undefined), maxMs))]); } catch {}
  let old: string | null = null;
  try { old = localStorage.getItem(KEY); } catch {}
  idbMode = true;
  saved = parseSaved(inIdb || old);
  if (!inIdb && old) await flushCopy(); // moved over: flushCopy removes the localStorage copy once IndexedDB has it
  else if (old) { try { localStorage.removeItem(KEY); } catch {} } // IndexedDB has it: free the space
}
registerClearHook(KEY, () => { saved = EMPTY(); version++; clearTimeout(writeTimer); writeTimer = undefined; void bigRemove(KEY); });
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
  persist();
  if (changed) version++;
  return changed;
}

/** Remove works no longer published (a full refresh passes the ids that are still published). */
export function pruneCatalog(keepIds: ReadonlySet<string>): void {
  const s = catalogCopy();
  let n = 0;
  for (const id of Object.keys(s.works)) if (!keepIds.has(id)) { delete s.works[id]; n++; }
  if (n) { version++; persist(); }
}

/* ---- the whole work (description, bio, facts, rating) for Book Info ---- */
let byInfo: Map<string, CatalogWork[]> | undefined;
let byIsbn: Map<string, CatalogWork[]> | undefined;
let infoIndexVersion = -1;
const buildInfoIndex = () => {
  if (infoIndexVersion === version && byInfo && byIsbn) return;
  byInfo = new Map(); byIsbn = new Map();
  const add = (map: Map<string, CatalogWork[]>, key: string, work: CatalogWork) => {
    const list = map.get(key) || [];
    if (!list.some(x => x.id === work.id)) list.push(work);
    map.set(key, list);
  };
  for (const w of Object.values(catalogCopy().works)) {
    for (const t of [w.title, ...(w.aliases || [])]) {
      for (const a of [w.author, ...(w.authorAliases || [])]) add(byInfo, `${titleKey(t)}|${authorKey(a || '')}`, w);
    }
    for (const e of w.editions || []) for (const i of [e.isbn13, e.isbn10]) if (i) add(byIsbn, i.replace(/[^0-9Xx]/g, '').toUpperCase(), w);
  }
  infoIndexVersion = version;
};
type BookRef = { title?: string; author?: string; isbn13?: string; isbn10?: string; identity?: { isbn13?: string; isbn10?: string } };
const isbnOf = (i?: string) => (i || '').replace(/[^0-9Xx]/g, '').toUpperCase();

/**
 * Every published work that fits a book: by ISBN when the book has one (top level or in `identity`, as every Book carries it), else by title + author
 * (aliases and author aliases included, spelling normalised). This is the ONE matcher: Book Info, rejected covers and the cover chain all use it.
 */
function catalogWorksFor(book: BookRef): CatalogWork[] {
  buildInfoIndex();
  const isbns = [book.isbn13, book.isbn10, book.identity?.isbn13, book.identity?.isbn10].map(isbnOf).filter(i => i && byIsbn!.has(i));
  if (isbns.length) {
    const hits = new Map<string, CatalogWork>();
    for (const i of isbns) for (const w of byIsbn!.get(i) || []) hits.set(w.id, w);
    return [...hits.values()];
  }
  return byInfo!.get(`${titleKey(book.title || '')}|${authorKey(book.author || '')}`) || [];
}

/**
 * The catalog's published work for a book. When two published works fit equally well (duplicates while the owner is still reconciling records),
 * none is chosen: storage order must never decide which description or rating a reader sees.
 */
export function getCatalogWork(book: BookRef): CatalogWork | undefined {
  const hits = catalogWorksFor(book);
  return hits.length === 1 ? hits[0] : undefined;
}

/**
 * The published cover for a book, by the same matcher as Book Info. Two matching works (duplicates) still give a cover when they agree on it;
 * if they disagree, none, so a reader never sees a cover chosen by storage order.
 */
export function getCatalogCoverFor(book: BookRef): string | undefined {
  const covers = new Set(catalogWorksFor(book).map(w => w.cover).filter((c): c is string => !!c && /^https:\/\//i.test(c)));
  return covers.size === 1 ? [...covers][0] : undefined;
}
