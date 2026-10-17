import type { Book, BookHistory, BookStatus, HighlightItem, ReadingState } from '../types';
import { DEFAULT_BOOKS } from '../data/defaultBooks';
import { mergeBooks, sameWork } from './books';
import type { Collection } from './libraryCollections';

/** One book that is in the Library more than once: `keepId` stays, `otherIds` are folded into it. */
export interface DuplicateGroup {
  keepId: string;
  otherIds: string[];
  /** For showing the list before anything changes */
  title: string;
  author: string;
}

const CATALOG_IDS = new Set(DEFAULT_BOOKS.map(b => String(b.id)));
/** How far along a status is: when two copies disagree, the furthest one is kept. */
const STATUS_RANK: Record<BookStatus, number> = { skip: 1, dnf: 2, list: 2, next: 3, now: 4, done: 5 };

const visibleBooks = (s: ReadingState): Book[] =>
  [...DEFAULT_BOOKS, ...s.customBooks].filter(b => !s.hiddenBookIds[String(b.id)]);

/** How much of YOUR data a copy holds (its notes, pages, quotes, dates, rating): the copy with the most is kept. */
function weight(s: ReadingState, b: Book): number {
  const id = String(b.id);
  let w = CATALOG_IDS.has(id) ? 1000 : 0; // a built-in record is the "official" one
  if (s.status[id]) w += 10;
  if (s.currentPage[id]) w += 10;
  if (s.notes[id]) w += 10;
  if ((s.highlights[id] || []).length) w += 10;
  if (s.history[id]) w += 10;
  if (s.ratings[id]) w += 10;
  if (b.summary) w += 1;
  if (b.pageCount) w += 1;
  return w;
}

/** Every book that is in the Library under two or more records (same book, any edition or source). Changes nothing. */
export function findDuplicateGroups(s: ReadingState): DuplicateGroup[] {
  const books = visibleBooks(s);
  const parent = books.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < books.length; i++) {
    for (let j = i + 1; j < books.length; j++) {
      if (find(i) !== find(j) && sameWork(books[i], books[j], true)) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, Book[]>();
  books.forEach((b, i) => groups.set(find(i), [...(groups.get(find(i)) || []), b]));
  const out: DuplicateGroup[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ranked = members.map((b, i) => ({ b, i, w: weight(s, b) })).sort((x, y) => y.w - x.w || x.i - y.i);
    const keep = ranked[0].b;
    out.push({ keepId: String(keep.id), otherIds: ranked.slice(1).map(r => String(r.b.id)), title: keep.title, author: keep.author });
  }
  return out;
}

/** removed id -> the id that now holds the book (for tags and shelves that listed the removed copy) */
export const idMapOf = (groups: DuplicateGroup[]): Record<string, string> =>
  Object.fromEntries(groups.flatMap(g => g.otherIds.map(o => [o, g.keepId] as const)));

const without = <T,>(rec: Record<string, T>, key: string): Record<string, T> => {
  const { [key]: _gone, ...rest } = rec;
  return rest;
};

function mergeHistory(k: BookHistory | undefined, o: BookHistory | undefined, finished: boolean): BookHistory | undefined {
  if (!k && !o) return undefined;
  const h: BookHistory = {};
  const earliest = (a?: string, b?: string) => (a && b ? (a < b ? a : b) : a || b);
  const latest = (a?: string, b?: string) => (a && b ? (a > b ? a : b) : a || b);
  const added = earliest(k?.added, o?.added);
  const started = earliest(k?.started, o?.started);
  const fin = finished ? latest(k?.finished, o?.finished) : undefined;
  const last = Math.max(k?.lastRead ?? 0, o?.lastRead ?? 0);
  if (added) h.added = added;
  if (started) h.started = started;
  if (fin) h.finished = fin;
  if (last) h.lastRead = last;
  return Object.keys(h).length ? h : undefined;
}

function mergeHighlights(a: HighlightItem[] = [], b: HighlightItem[] = []): HighlightItem[] {
  const seen = new Set(a.map(h => h.text.trim().toLowerCase()));
  return [...a, ...b.filter(h => !seen.has(h.text.trim().toLowerCase()))];
}

function mergeNotes(a = '', b = ''): string {
  if (!b.trim() || a.includes(b.trim())) return a;
  if (!a.trim() || b.includes(a.trim())) return b;
  return `${a}\n\n${b}`;
}

/**
 * Folds each group's other copies into the one that is kept, without losing anything:
 * the furthest status, the most pages, notes and quotes from both, the earliest added/started and latest finished dates,
 * your star rating, and on-device if either copy was. The kept book also takes the best details (cover, summary, rating pair).
 */
export function applyMerge(prev: ReadingState, groups: DuplicateGroup[]): ReadingState {
  let s = prev;
  for (const g of groups) {
    for (const oid of g.otherIds) {
      const kid = g.keepId;
      const all = [...DEFAULT_BOOKS, ...s.customBooks];
      const keep = all.find(b => String(b.id) === kid);
      const other = all.find(b => String(b.id) === oid);
      if (!keep || !other || kid === oid) continue;

      const ks = s.status[kid], os = s.status[oid];
      const status = (STATUS_RANK[os as BookStatus] ?? 0) > (STATUS_RANK[ks as BookStatus] ?? 0) ? os : ks;
      const history = mergeHistory(s.history[kid], s.history[oid], status === 'done');
      const onDevice = (s.onDeviceOverrides[kid] ?? keep.isOnDevice) || (s.onDeviceOverrides[oid] ?? other.isOnDevice);
      const otherIsCustom = s.customBooks.some(b => String(b.id) === oid);
      const keepIsCustom = s.customBooks.some(b => String(b.id) === kid);

      let customBooks = s.customBooks;
      if (keepIsCustom) customBooks = customBooks.map(b => (String(b.id) === kid ? { ...mergeBooks(b, other), id: b.id, isOnDevice: b.isOnDevice || onDevice } : b));
      if (otherIsCustom) customBooks = customBooks.filter(b => String(b.id) !== oid);

      const rating = s.ratings[kid] ?? s.ratings[oid];
      const notes = mergeNotes(s.notes[kid], s.notes[oid]);
      const highlights = mergeHighlights(s.highlights[kid], s.highlights[oid]);
      const page = Math.max(s.currentPage[kid] || 0, s.currentPage[oid] || 0);
      const total = Math.max(s.totalPages[kid] || 0, s.totalPages[oid] || 0);

      const next: ReadingState = {
        ...s,
        customBooks,
        status: without(status ? { ...s.status, [kid]: status } : s.status, oid),
        currentPage: without(page ? { ...s.currentPage, [kid]: page } : s.currentPage, oid),
        totalPages: without(total ? { ...s.totalPages, [kid]: total } : s.totalPages, oid),
        notes: without(notes ? { ...s.notes, [kid]: notes } : s.notes, oid),
        highlights: without(highlights.length ? { ...s.highlights, [kid]: highlights } : s.highlights, oid),
        history: without(history ? { ...s.history, [kid]: history } : s.history, oid),
        ratings: without(rating ? { ...s.ratings, [kid]: rating } : s.ratings, oid),
        onDeviceOverrides: without(onDevice && !keep.isOnDevice ? { ...s.onDeviceOverrides, [kid]: true } : s.onDeviceOverrides, oid),
        // A built-in copy cannot be deleted, only hidden (as "remove" already does)
        hiddenBookIds: otherIsCustom ? s.hiddenBookIds : { ...s.hiddenBookIds, [oid]: true },
      };
      // (a custom copy being removed also takes its saved on-device setting with it: handled by without() above)
      s = next;
    }
  }
  return s;
}

/** Tags and shelves that listed a removed copy now list the book that was kept (no book twice). */
export function remapCollections(list: Collection[], idMap: Record<string, string>): Collection[] {
  return list.map(c => ({ ...c, bookIds: [...new Set(c.bookIds.map(id => idMap[id] ?? id))] }));
}
