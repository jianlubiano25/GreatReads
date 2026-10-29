/**
 * The published catalog, as this device keeps it: one saved copy, shown at once on launch, topped up with only what changed (see services/catalog.ts).
 * Self-contained on purpose (no imports from the cover code) so the cover chain can read it without a circular import.
 */
import { registerClearableKey } from './cache';
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
export const catalogCopy = (): Saved => {
  if (!saved) {
    try {
      const r = JSON.parse(localStorage.getItem(KEY) || 'null');
      saved = r && r.works && typeof r.works === 'object' ? { since: String(r.since || '-infinity'), t: Number(r.t) || 0, works: r.works } : { since: '-infinity', t: 0, works: {} };
    } catch { saved = { since: '-infinity', t: 0, works: {} }; }
  }
  return saved;
};
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
  if (changed) version++;
  return changed;
}

/** Remove works no longer published (a full refresh passes the ids that are still published). */
export function pruneCatalog(keepIds: ReadonlySet<string>): void {
  const s = catalogCopy();
  let n = 0;
  for (const id of Object.keys(s.works)) if (!keepIds.has(id)) { delete s.works[id]; n++; }
  if (n) { version++; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
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
