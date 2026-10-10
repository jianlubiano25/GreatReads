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

export type RatingSourceId = NonNullable<Book['ratingSource']>;
export const RATING_SOURCE_LABEL: Record<RatingSourceId, string> = { openlibrary: 'Open Library', google: 'Google', apple: 'Apple', library: 'Library' };

export interface RatingPair {
  average: number;
  count?: number;
  /** where the pair came from, when known */
  source?: RatingSourceId;
}

/** One site's own rating of a book (shown next to the others in the book info; never combined with them). */
export interface SourceRating extends RatingPair {
  source: Exclude<RatingSourceId, 'library'>;
}

/** Fewer ratings than this is "thin": a preferred source that is thin yields to a lower step that has more. */
export const SUFFICIENT_RATINGS = 10;

/** The rating a book carries, as a pair (undefined when it has none). */
export function ratingOf(b?: Pick<Book, 'ratingAverage' | 'ratingCount'> & { ratingSource?: Book['ratingSource'] } | null): RatingPair | undefined {
  const average = Number(b?.ratingAverage);
  if (!b || !Number.isFinite(average) || average <= 0 || average > 5) return undefined;
  const source = (b as Book).ratingSource;
  return { average, count: b.ratingCount && b.ratingCount > 0 ? b.ratingCount : undefined, ...(source ? { source } : {}) };
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
    if (r && sameWork(k, book, true)) return { ...r, ...(inferRatingSource(k) ? { source: inferRatingSource(k) } : {}) };
  }
  return undefined;
}

/** Ladder step 1: the same book in `known` supplies its average + count together; otherwise the book is returned as it was. */
export function withKnownRating<T extends Book>(book: T, known: readonly Book[]): T {
  const r = knownRating(book, known);
  if (!r || (r.average === book.ratingAverage && r.count === book.ratingCount)) return book;
  return { ...book, ratingAverage: r.average, ratingCount: r.count, ratingSource: r.source };
}

/** Put a chosen pair (or nothing) on a book. */
export const setRating = <T extends Book>(book: T, r?: RatingPair): T => ({ ...book, ratingAverage: r?.average, ratingCount: r?.count, ratingSource: r?.source });

/** Which site the rating a book shows came from: what it says, else the one site whose own rating is exactly that pair. */
export function inferRatingSource(book: Pick<Book, 'ratingAverage' | 'ratingCount' | 'ratingSource' | 'source' | 'id'>, found: readonly SourceRating[] = []): RatingSourceId | undefined {
  if (book.ratingSource) return book.ratingSource;
  if (!book.ratingAverage) return undefined;
  const same = found.find(f => Math.abs(f.average - book.ratingAverage!) < 0.05 && (f.count || 0) === (book.ratingCount || 0));
  if (same) return same.source;
  return typeof book.id === 'number' || book.source === 'curated' ? 'library' : undefined; // the hand-written ratings of the built-in books
}

/** Every site's rating except the one already shown as the main rating, in the order Open Library, Google, Apple. Nothing here is added together. */
export function otherRatings(found: readonly SourceRating[], main?: RatingSourceId): SourceRating[] {
  const order = ['openlibrary', 'google', 'apple'];
  return found.filter(f => f.source !== main).sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source));
}

/** How much of each of the five stars is filled: 4.0 -> [1,1,1,1,0]; 4.5 -> [1,1,1,1,.5]; 3.2 -> [1,1,1,.2,0]. */
export function starFills(rating: number): number[] {
  const r = Math.max(0, Math.min(5, Number(rating) || 0));
  return [0, 1, 2, 3, 4].map(i => Math.round(Math.max(0, Math.min(1, r - i)) * 1000) / 1000);
}
