import type { Book } from '../../types';
import { enrichPool, gatherPool, rankPool, SIGNAL_WEIGHTS, pickDiverse, scoreCandidate } from './collate';
import { dynamicShelves, SHELF_TTL, type RefreshResult, type ShelfSource } from './shelves';

/**
 * "Trending Today": GreatReads' own list. It is NOT a universal real-time ranking (no such public data exists) and it is NOT
 * any one source's chart: every source contributes its own signals, each normalised on its own scale, and GreatReads blends them
 * (see collate.ts for the signals and weights). The NYT is one signal among several, so a book that readers are rating and
 * charting everywhere can rank high without being on a NYT list, and a NYT bestseller nobody else is paying attention to
 * does not automatically win.
 *
 * If a source fails, the others keep contributing and the weights are rescaled; the list only fails when NO source answers
 * (and then the last list that was shown, however old, is used instead of an error).
 */

export { SIGNAL_WEIGHTS, pickDiverse, scoreCandidate };

const SHELF_ID = 'trending';
let refining = false;

/** Gather every source, rank, and save. Returns null when NO source answered (nothing is saved then, so the old list stays). */
async function build(onUpdate: (b: Book[]) => void): Promise<Book[] | null> {
  const pool = await gatherPool();
  const first: Book[] = pool ? rankPool(pool, { limit: 15 }).map(r => r.book) : [];
  if (!pool || !first.length) return null;

  if (!refining) {
    refining = true;
    void (async () => {
      try {
        // Closer look at the best candidates (covers, ratings from every source, categories, content flags), then re-rank
        await enrichPool(pool, { max: 24 });
        const final = rankPool(pool, { limit: 15 }).map(r => r.book);
        if (final.length >= Math.min(8, first.length)) {
          dynamicShelves.set(SHELF_ID, final);
          onUpdate(final);
        }
      } catch {
        /* the first-impression shelf stays */
      } finally {
        refining = false;
      }
    })();
  }
  dynamicShelves.set(SHELF_ID, first);
  return first;
}

export const trendingSource: ShelfSource = {
  id: SHELF_ID,
  cached: () => dynamicShelves.get(SHELF_ID) ?? null,
  info: () => {
    const p = dynamicShelves.peek(SHELF_ID);
    return {
      updatedAt: p ? Date.now() - p.ageMs : undefined,
      schedule: `Rebuilt every ${SHELF_TTL / 3600000} hours when opened`,
      source: "GreatReads' own blend of NYT, Apple Books, Open Library and Google Books signals, not an official chart",
      kind: 'generated',
    };
  },
  // Manual refresh: rebuild now. When every source is down nothing is saved, so the previous list (and its time) stay.
  refresh: async (): Promise<RefreshResult> => {
    try { return (await build(() => {})) ? 'updated' : 'failed'; } catch { return 'failed'; }
  },
  load: async onUpdate => {
    const cached = dynamicShelves.get(SHELF_ID);
    if (cached) return cached;
    const stale = dynamicShelves.peek(SHELF_ID)?.value;
    const books = await build(onUpdate);
    if (books) return books;
    if (stale?.length) return stale; // every source is down: yesterday's list beats an error
    throw new Error('trending unavailable');
  },
};
