import type { Book } from '../../types';
import { enrichPool, gatherPool, rankPool, SIGNAL_WEIGHTS, pickDiverse, scoreCandidate } from './collate';
import { dynamicShelves, type ShelfSource } from './shelves';

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

export const trendingSource: ShelfSource = {
  id: SHELF_ID,
  cached: () => dynamicShelves.get(SHELF_ID) ?? null,
  load: async onUpdate => {
    const cached = dynamicShelves.get(SHELF_ID);
    if (cached) return cached;
    const stale = dynamicShelves.peek(SHELF_ID)?.value;

    const pool = await gatherPool();
    const first: Book[] = pool ? rankPool(pool, { limit: 15 }).map(r => r.book) : [];
    if (!pool || !first.length) {
      if (stale?.length) return stale; // every source is down: yesterday's list beats an error
      throw new Error('trending unavailable');
    }

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
  },
};
