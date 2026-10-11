import resolvedData from '../../data/storeResolved.json';
import { CURATED_SHELVES } from '../../data/storeCatalog';
import { authorKey, titleKey } from './identity';
import type { PrefetchedRecord } from './prefetchRecord';
import type { SourceRating } from './ratings';

/**
 * What `npm run prefetch:store` saved about each site's own rating of a Store book (see prefetchRecord.ts), found by BOOK (title +
 * first author, as the resolver keys them), so the book info can show Open Library, Google and Apple without asking any site again.
 * Built once, on first use. Only records saved by the current rules (`checked` present) are used.
 */
const PREFETCHED = resolvedData as unknown as Record<string, (PrefetchedRecord | null)[]>;
const keyOf = (title: string, author: string) => `${titleKey(title)}|${authorKey(author)}`;

let index: Map<string, PrefetchedRecord> | undefined;
function build(): Map<string, PrefetchedRecord> {
  const m = new Map<string, PrefetchedRecord>();
  for (const shelf of CURATED_SHELVES) {
    shelf.seeds.forEach(([title, author], i) => {
      const rec = PREFETCHED[shelf.id]?.[i];
      if (rec && rec.title === title && rec.checked) { const k = keyOf(title, author); if (!m.has(k)) m.set(k, rec); }
    });
  }
  return m;
}

export function prefetchedSourceRatings(book: { title: string; author: string }): { ratings: SourceRating[]; checked: SourceRating['source'][] } | undefined {
  index ??= build();
  const rec = index.get(keyOf(book.title, book.author));
  if (!rec?.checked) return undefined;
  const ratings = Object.entries(rec.sources ?? {}).flatMap(([source, pair]) => (pair ? [{ source: source as SourceRating['source'], average: pair[0], count: pair[1] }] : []));
  return { ratings, checked: rec.checked };
}
