import type { Resolved } from './resolve';
import { externalRating, type RatingSourceId } from './ratings';

/**
 * The record `npm run prefetch:store` saves for one Store book (src/data/storeResolved.json), built from what the SHARED resolver
 * (resolveBook, apple: true) returned. The script has no matching or rating rules of its own: the card a reader sees at first open
 * is exactly what the same book resolves to in the app, so the two cannot drift apart again.
 */

/** Bump when the rules that decide a record change: older records are fetched again by the next prefetch run. */
export const PREFETCH_VERSION = 3; // 3: every site's own rating is kept (sources / checked), not only the one the ladder chose

export interface PrefetchedRecord {
  title: string; // so the app can tell if the shelf was edited after this was fetched
  rv?: number; // PREFETCH_VERSION; absent while a source could not be reached (the next run asks again)
  coverUrl?: string;
  coverId?: number;
  ratingAverage?: number;
  ratingCount?: number;
  ratingSource?: 'apple' | 'openlibrary' | 'google';
  pageCount?: number; // unknown stays unknown (never invented)
  year?: string;
  olKey?: string;
  /** Each site's OWN rating as [average, count] (never combined), for the book info. Only valid pairs are saved. */
  sources?: Partial<Record<Exclude<RatingSourceId, 'library'>, [number, number]>>;
  /** The sites that were asked and answered (a pair, or really none): the book info does not ask those again. */
  checked?: Exclude<RatingSourceId, 'library'>[];
}

export function toPrefetchedRecord(title: string, r: Resolved | null): PrefetchedRecord {
  if (!r) return { title };
  const b = r.book;
  const rec: PrefetchedRecord = { title };
  if (b.coverUrl) rec.coverUrl = b.coverUrl;
  else if (b.coverId) rec.coverId = b.coverId;
  // ONE source's average + count together, as chosen by the ladder in ratings.ts
  const pair = externalRating(b);
  if (pair && b.ratingSource && b.ratingSource !== 'library') {
    rec.ratingAverage = pair.average;
    rec.ratingCount = pair.count;
    rec.ratingSource = b.ratingSource;
  }
  if (b.pageCount) rec.pageCount = b.pageCount;
  if (b.year) rec.year = b.year;
  if (b.identity?.olWork) rec.olKey = `/works/${b.identity.olWork}`;
  if (r.ratings) {
    const sources: NonNullable<PrefetchedRecord['sources']> = {};
    for (const x of r.ratings) if (x.count) sources[x.source] = [x.average, x.count];
    if (Object.keys(sources).length) rec.sources = sources;
  }
  if (r.checked?.length) rec.checked = r.checked;
  if (!r.retry) rec.rv = PREFETCH_VERSION; // a result that is waiting for a failed source is not final
  return rec;
}

/**
 * Is a saved record final for `title` (made by the current rules, with a cover and a rating)? Anything else is fetched again.
 * The prefetch asks every site, so a final record has Google among the sites that were asked AND answered (`checked`): one saved while Google
 * could not be reached says nothing about Google, and is fetched again (a refused key or a blocked network, once fixed, then fills it in).
 */
export const isCurrentRecord = (rec: PrefetchedRecord | null | undefined, title: string): boolean =>
  !!rec && rec.rv === PREFETCH_VERSION && rec.title === title && !!(rec.coverUrl || rec.coverId) && !!rec.ratingAverage && !!rec.ratingSource && !!rec.checked?.includes('google');
