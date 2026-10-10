import type { Book } from '../../types';
import { sameWork } from './identity';

/**
 * Ratings policy (one place, so every screen agrees).
 *
 * A rating is an AVERAGE and a COUNT that belong together: they describe one audience on one site. So
 *  - counts from different sources are NEVER added (Open Library + Google + Apple readers overlap and would be double-counted);
 *  - an average from one source is NEVER shown with another source's count;
 *  - the whole pair comes from exactly one place, chosen by the ladder below. Nothing found -> no rating (the stars are hidden).
 *
 *   1. the same book (sameWork) already in the library / built-in list -> its average + count
 *   2. Open Library work ratings
 *   3. Google Books averageRating + ratingsCount
 *
 * Other gaps (cover, pages, year, ids) may still be filled from any source; only ratings follow this ladder.
 */

export interface RatingPair {
  average: number;
  count?: number;
}

/** Fewer ratings than this is "thin": a preferred source that is thin yields to a lower step that has more. */
export const SUFFICIENT_RATINGS = 10;

/** The rating a book carries, as a pair (undefined when it has none). */
export function ratingOf(b?: Pick<Book, 'ratingAverage' | 'ratingCount'> | null): RatingPair | undefined {
  const average = Number(b?.ratingAverage);
  if (!b || !Number.isFinite(average) || average <= 0 || average > 5) return undefined;
  return { average, count: b.ratingCount && b.ratingCount > 0 ? b.ratingCount : undefined };
}

/**
 * Pick ONE pair from the ladder. A `library` pair always wins. Otherwise the first of Open Library, Google that has a rating with
 * at least SUFFICIENT_RATINGS behind it; when none is that solid, the first one that has any rating at all.
 */
export function chooseRating(c: { library?: RatingPair; ol?: RatingPair; google?: RatingPair }): RatingPair | undefined {
  if (c.library) return c.library;
  const ladder = [c.ol, c.google].filter((r): r is RatingPair => !!r);
  return ladder.find(r => (r.count || 0) >= SUFFICIENT_RATINGS) ?? ladder[0];
}

/** The rating of the same book (any edition) in a list of books you already have, e.g. the library plus the built-in books. */
export function knownRating(book: Pick<Book, 'id' | 'identity' | 'title' | 'author'>, known: readonly Book[]): RatingPair | undefined {
  for (const k of known) {
    const r = ratingOf(k);
    if (r && sameWork(k, book, true)) return r;
  }
  return undefined;
}

/** Ladder step 1: the same book in `known` supplies its average + count together; otherwise the book is returned as it was. */
export function withKnownRating<T extends Book>(book: T, known: readonly Book[]): T {
  const r = knownRating(book, known);
  if (!r || (r.average === book.ratingAverage && r.count === book.ratingCount)) return book;
  return { ...book, ratingAverage: r.average, ratingCount: r.count };
}

/** Put a chosen pair (or nothing) on a book. */
export const setRating = <T extends Book>(book: T, r?: RatingPair): T => ({ ...book, ratingAverage: r?.average, ratingCount: r?.count });
