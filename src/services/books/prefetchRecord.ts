import type { Resolved } from './resolve';
import { chooseRating, externalRating, settleSiteRating, type RatingSourceId } from './ratings';

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

/**
 * What a prefetch run saves for a book that already has a record: the new answer on top of the old record, never instead of it.
 * A run that could not reach a site, or got no usable answer, used to replace the whole record with whatever it did find ({ title } when
 * nothing answered), which wiped covers, page counts, Open Library links and ratings that were fine (also with --redo-ratings).
 *
 *  - only a record of the SAME title is built on: another book in that slot starts fresh (record ids and book identities are never mixed);
 *  - a field the new answer has wins (fresh data); a field it lacks (absent, undefined, null, empty, or an invalid rating pair) keeps the old value;
 *  - each site's own pair is merged on its own by settleSiteRating: both pairs are validated (externalRating) first, a valid old pair is kept
 *    when the fresh one is invalid or missing, a valid fresh pair replaces it, except that a thin fresh pair (fewer than SUFFICIENT_RATINGS)
 *    never replaces a solid old one; an invalid pair on either side is dropped, never saved;
 *  - the headline rating is chosen again from the merged pairs by the same ladder (chooseRating), so provider priority is unchanged;
 *  - `checked` only grows (a site that answered once and is now unreachable keeps its old answer, so it is not asked again for nothing);
 *  - `rv` (final) is the new run's, else the old record's: a failed run does not make a final record look unfinished.
 */
export function mergePrefetchedRecord(prev: PrefetchedRecord | null | undefined, next: PrefetchedRecord, title: string): PrefetchedRecord {
  if (!prev || prev.title !== title) return next;
  // Only what the new answer really has is laid over the old record: a key present with `undefined` / null / '' / 0 (or an invalid rating pair) is
  // "nothing found", never a value, so it cannot blank a saved field. The headline rating is one unit (average + count + source): all or none.
  const hasValue = (k: string, v: unknown) => v !== undefined && v !== null && v !== '' && !(typeof v === 'number' && !(k === 'pageCount' ? v > 0 : Number.isFinite(v)));
  const fresh: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) if (hasValue(k, v)) fresh[k] = v;
  if (!externalRating({ ratingAverage: next.ratingAverage, ratingCount: next.ratingCount }) || !next.ratingSource) { delete fresh.ratingAverage; delete fresh.ratingCount; delete fresh.ratingSource; }
  const out: PrefetchedRecord = { ...prev, ...fresh, title };
  // a cover is one thing: the new one entirely, or the old one entirely
  if (next.coverUrl || next.coverId) {
    delete out.coverUrl; delete out.coverId;
    if (next.coverUrl) out.coverUrl = next.coverUrl; else out.coverId = next.coverId;
  }
  // each site's pair, judged by the same rules as the resolver (settleSiteRating -> externalRating): an invalid pair on either side is no pair,
  // a valid old pair survives an invalid or missing fresh one, a valid fresh pair wins (unless thin against a solid old one)
  const sources: NonNullable<PrefetchedRecord['sources']> = {};
  const toPair = (t?: [number, number]) => (t ? { average: t[0], count: t[1] } : undefined);
  for (const site of new Set([...Object.keys(prev.sources ?? {}), ...Object.keys(next.sources ?? {})]) as Set<keyof typeof sources>) {
    const kept = settleSiteRating(toPair(next.sources?.[site]), toPair(prev.sources?.[site]));
    if (kept) sources[site] = [kept.average, kept.count as number];
  }
  if (Object.keys(sources).length) {
    out.sources = sources;
    const pair = (s: 'apple' | 'openlibrary' | 'google') => (sources[s] ? { average: sources[s]![0], count: sources[s]![1] } : undefined);
    const best = chooseRating({ apple: pair('apple'), ol: pair('openlibrary'), google: pair('google') });
    if (best && externalRating({ ratingAverage: best.average, ratingCount: best.count })) {
      const bestSource = (['apple', 'openlibrary', 'google'] as const).find(s => sources[s]?.[0] === best.average && sources[s]?.[1] === best.count);
      out.ratingAverage = best.average; out.ratingCount = best.count; out.ratingSource = bestSource;
    }
  } else delete out.sources;
  const checked = [...new Set([...(prev.checked ?? []), ...(next.checked ?? [])])];
  if (checked.length) out.checked = checked;
  if (next.rv === undefined && prev.rv !== undefined) out.rv = prev.rv;
  return out;
}
