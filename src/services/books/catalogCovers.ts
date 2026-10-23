/**
 * The published catalog, as this device keeps it: one saved copy, shown at once on launch, topped up with only what changed (see services/catalog.ts).
 * Self-contained on purpose (no imports from the cover code) so the cover chain can read it without a circular import.
 */
import { registerClearableKey } from './cache';
import { authorKey, titleKey } from './identity';
import { matchIdentity, validIsbn10, validIsbn13 } from './identity-engine/match';
import type { IdentityRecord, ExternalIdentifier } from './identity-engine/model';

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
      for (const a of [w.author, ...(w.authorAliases || [])]) {
        const k = `${titleKey(t)}|${authorKey(a || '')}`;
        if (titleKey(t) && authorKey(a || '')) add(byInfo, k, w);
      }
    }
    for (const e of w.editions || []) for (const i of [e.isbn13, e.isbn10]) if (i) add(byIsbn, i.replace(/[^0-9Xx]/g, '').toUpperCase(), w);
  }
  infoIndexVersion = version;
};
function catalogIdentity(w: CatalogWork): IdentityRecord {
  const link: ExternalIdentifier = { source: 'supabase', kind: 'work', value: w.id };
  const editions: ExternalIdentifier[] = [];
  for (const e of w.editions || []) {
    const n13 = (e.isbn13 || '').replace(/[^0-9Xx]/g, '').toUpperCase();
    const n10 = (e.isbn10 || '').replace(/[^0-9Xx]/g, '').toUpperCase();
    if (validIsbn13(n13)) editions.push({ source: 'manual', kind: 'edition', value: n13, scheme: 'isbn13' });
    if (validIsbn10(n10)) editions.push({ source: 'manual', kind: 'edition', value: n10, scheme: 'isbn10' });
  }
  const evidence = { basis: 'catalog-link' as const, source: 'supabase' as const, identifier: link };
  return {
    title: w.title, author: w.author, identifiers: [], edition: { identifiers: editions },
    work: { identifiers: [], canonicalTitle: w.title, relatedWorkIds: [], titleAliases: (w.aliases || []).map(title => ({ title, kind: 'alternate-title' as const, evidence })) },
    authors: w.authorAliases?.length ? [{ identifiers: [], canonicalName: w.author, aliases: w.authorAliases.map(name => ({ name, evidence })) }] : undefined,
  };
}
/** The catalog's published work, accepted only when the shared identity matcher supports it. */
export function getCatalogWork(book: { title?: string; author?: string; isbn13?: string; isbn10?: string; id?: string | number; identity?: { olWork?: string; olEdition?: string; gbVolume?: string; isbn13?: string; isbn10?: string } }): CatalogWork | undefined {
  buildInfoIndex();
  const ids = { ...(book.identity || {}), isbn13: book.isbn13 || book.identity?.isbn13, isbn10: book.isbn10 || book.identity?.isbn10 };
  const query: IdentityRecord = {
    title: book.title || '', author: book.author || '', identifiers: [],
    work: { identifiers: ids.olWork ? [{ source: 'openlibrary', kind: 'work', value: ids.olWork }] : [], canonicalTitle: book.title, relatedWorkIds: [], titleAliases: [] },
    edition: { identifiers: [...(ids.olEdition ? [{ source: 'openlibrary' as const, kind: 'edition' as const, value: ids.olEdition }] : []), ...(ids.gbVolume ? [{ source: 'google' as const, kind: 'edition' as const, value: ids.gbVolume }] : [])], isbn10: ids.isbn10, isbn13: ids.isbn13 },
  };
  const candidates = new Map<string, CatalogWork>();
  const add = (works?: CatalogWork[]) => works?.forEach(w => candidates.set(w.id, w));
  for (const isbn of [ids.isbn13, ids.isbn10]) if (isbn) add(byIsbn!.get(isbn.replace(/[^0-9Xx]/g, '').toUpperCase()));
  const title = titleKey(book.title || ''), author = authorKey(book.author || '');
  if (title && author) add(byInfo!.get(`${title}|${author}`));
  const matches = [...candidates.values()].flatMap(work => {
    const result = matchIdentity(query, catalogIdentity(work));
    if (result.status === 'confirmed') return [{ work, strength: 2 }];
    if (result.status === 'probable') return [{ work, strength: 1 }];
    return [];
  });
  if (!matches.length) return undefined;
  const strongest = Math.max(...matches.map(match => match.strength));
  const best = matches.filter(match => match.strength === strongest);
  // Duplicate catalog works are possible while the owner reviews or reconciles records.
  // Never let storage order choose which approved description or cover a reader sees.
  return best.length === 1 ? best[0].work : undefined;
}

/** The catalog's cover is selected from the same validated work match as its Book Info metadata. */
export const getCatalogCover = (book: Parameters<typeof getCatalogWork>[0]): string | undefined => {
  const cover = getCatalogWork(book)?.cover;
  return cover && /^https:\/\//i.test(cover) ? cover : undefined;
};
