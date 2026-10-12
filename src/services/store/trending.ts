import type { Book } from '../../types';
import { filterEligible } from '../books/eligibility';
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
 *
 * Content eligibility (books/quality.ts): explicit books never reach this shelf. rankPool judges every candidate before any list is
 * made, and every list that comes out of a saved copy (the instant one, the stale one, the last-resort one) is checked again against
 * the books already judged (books/eligibility.ts), so a list saved before a book was excluded cannot put its card back on screen.
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
        // A short final list is not a reason to keep the first impression as it was: the closer look may have excluded books from it
        const next = final.length >= Math.min(8, first.length) ? final : filterEligible(first);
        if (next.length) {
          dynamicShelves.set(SHELF_ID, next);
          onUpdate(next);
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

/** A saved copy of the shelf, with every book already judged ineligible taken out; null when nothing is left to show. */
const eligibleCopy = (books: Book[] | null | undefined): Book[] | null => {
  if (!books) return null;
  const kept = filterEligible(books);
  return kept.length ? kept : null;
};

export const trendingSource: ShelfSource = {
  id: SHELF_ID,
  // Instant: the last list (kept for 7 days), fresh or not; load() rebuilds it when it is due and the shelf swaps in the answer
  cached: () => eligibleCopy(dynamicShelves.get(SHELF_ID) ?? dynamicShelves.peek(SHELF_ID)?.value),
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
    const cached = eligibleCopy(dynamicShelves.get(SHELF_ID));
    if (cached) return cached;
    const stale = eligibleCopy(dynamicShelves.peek(SHELF_ID)?.value);
    const books = await build(onUpdate);
    if (books) return books;
    if (stale?.length) return stale; // every source is down: yesterday's list beats an error
    throw new Error('trending unavailable');
  },
};
