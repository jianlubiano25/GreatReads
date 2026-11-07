/**
 * Covers the owner rejected: the catalog tells every device (see catalog_work_json), and from then on no screen shows or uses them.
 * The match ignores the picture's size (Apple 200x300 vs 600x900, Open Library S / M / L), so one rejection covers every size of the same picture.
 */
import { getCatalogWork } from './catalogCovers';
import { flatKey } from './coverAnalysis';

const memo = new WeakMap<object, Set<string>>();
const setOf = (w: { rejectedCovers?: string[] }): Set<string> => {
  let s = memo.get(w);
  if (!s) { s = new Set((w.rejectedCovers || []).filter(u => typeof u === 'string').map(flatKey)); memo.set(w, s); }
  return s;
};

export function isCoverRejected(book: { title?: string; author?: string; isbn13?: string; isbn10?: string; identity?: { isbn13?: string; isbn10?: string } }, url?: string): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  const w = getCatalogWork(book);
  return !!w?.rejectedCovers?.length && setOf(w).has(flatKey(url));
}
