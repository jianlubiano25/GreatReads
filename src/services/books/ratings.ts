import type { Book } from '../../types';
import { identityOf, sameWork, titleKeys } from './identity';
import { timed } from './perf';

/**
 * Ratings policy (one place, so every screen agrees).
 *
 * A rating is an AVERAGE and a COUNT that belong together: they describe one audience on one site. So
 *  - counts from different sources are NEVER added (Open Library + Google + Apple readers overlap and would be double-counted);
 *  - an average from one source is NEVER shown with another source's count;
 *  - the whole pair comes from exactly one place, chosen by the ladder below. Nothing found -> no rating (the stars are hidden).
 *
 *   1. the same book (sameWork) already in the library / built-in list -> its average + count
 *   2. Apple Books
 *   3. Open Library work ratings
 *   4. Google Books averageRating + ratingsCount
 *
 * An outside site's pair is valid only with an average from 1 to 5 AND that site's own count above zero (see externalRating).
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

/**
 * One site's pair after a fresh lookup, given the pair that site gave before (a saved result):
 *  - the fresh pair when it is valid (fresh data wins), unless it is thin (fewer than SUFFICIENT_RATINGS) and the old pair is solid;
 *  - otherwise the old pair, when it is still a valid pair: a request that failed, or came back without a usable rating, never erases a rating
 *    the site really gave. Nothing is ever made up: with no valid pair on either side there is none.
 */
export function settleSiteRating<T extends RatingPair>(fresh: T | undefined, had: T | undefined): T | undefined {
  const valid = (r?: T) => (r && externalRating({ ratingAverage: r.average, ratingCount: r.count }) ? r : undefined);
  const f = valid(fresh), h = valid(had);
  if (!f) return h;
  return h && (h.count || 0) >= SUFFICIENT_RATINGS && (f.count || 0) < SUFFICIENT_RATINGS ? h : f;
}

/** The rating a book carries, as a pair (undefined when it has none). */
export function ratingOf(b?: Pick<Book, 'ratingAverage' | 'ratingCount'> & { ratingSource?: Book['ratingSource'] } | null): RatingPair | undefined {
  const average = Number(b?.ratingAverage);
  if (!b || !Number.isFinite(average) || average <= 0 || average > 5) return undefined;
  const source = (b as Book).ratingSource;
  return { average, count: b.ratingCount && b.ratingCount > 0 ? b.ratingCount : undefined, ...(source ? { source } : {}) };
}

/** An outside site's rating: an average from 1 to 5 together with that site's own count above zero, else nothing (never half a pair). */
export function externalRating(b?: Pick<Book, 'ratingAverage' | 'ratingCount'> & { ratingSource?: Book['ratingSource'] } | null): RatingPair | undefined {
  const r = ratingOf(b);
  return r && r.average >= 1 && (r.count || 0) > 0 ? r : undefined;
}

/**
 * Pick ONE pair from the ladder. A `library` pair always wins. Otherwise the first of Apple, Open Library, Google that has a valid pair
 * (externalRating) with at least SUFFICIENT_RATINGS behind it; when none is that solid, the first valid one.
 */
export function chooseRating(c: { library?: RatingPair; apple?: RatingPair; ol?: RatingPair; google?: RatingPair }): RatingPair | undefined {
  if (c.library) return c.library;
  const ladder = [c.apple, c.ol, c.google].filter((r): r is RatingPair => !!r && !!externalRating({ ratingAverage: r.average, ratingCount: r.count }));
  return ladder.find(r => (r.count || 0) >= SUFFICIENT_RATINGS) ?? ladder[0];
}

type Identified = Pick<Book, 'id' | 'identity' | 'title' | 'author'>;

/**
 * The rated books of a list, filed under every way sameWork can recognise them: ISBN-13 / ISBN-10 / Open Library edition / Google volume
 * (same edition), Open Library work, and each main-title key (same title). A book is compared only with the few books filed under ITS
 * keys, instead of with the whole list, and the real sameWork test still decides: the answer is the one a scan of the whole list gives
 * (the first book of the list that is the same book), only found without visiting every other book. A shelf of 240 cards against a library
 * of a few hundred books was tens of thousands of title comparisons on every update.
 */
export interface KnownRatings {
  /** The rating of the same book (any edition) in the list this was built from, or undefined. */
  of(book: Identified): RatingPair | undefined;
}

export function indexKnownRatings(known: readonly Book[]): KnownRatings {
  const buckets = new Map<string, number[]>(); // key -> positions in `known` (ascending), rated books only
  const rated = new Map<number, RatingPair>();
  const file = (key: string | undefined, at: number) => {
    if (!key) return;
    const list = buckets.get(key);
    if (!list) buckets.set(key, [at]);
    else if (list[list.length - 1] !== at) list.push(at);
  };
  const keysOf = (b: Identified): string[] => {
    const i = identityOf(b);
    return [
      ...(i.isbn13 ? [`i13:${i.isbn13}`] : []), ...(i.isbn10 ? [`i10:${i.isbn10}`] : []),
      ...(i.olEdition ? [`oe:${i.olEdition}`] : []), ...(i.gbVolume ? [`gv:${i.gbVolume}`] : []),
      ...(i.olWork ? [`ow:${i.olWork}`] : []), ...titleKeys(b.title).map(t => `t:${t}`),
    ];
  };
  known.forEach((k, at) => {
    const r = ratingOf(k);
    if (!r) return;
    rated.set(at, r);
    keysOf(k).forEach(key => file(key, at));
  });
  return {
    of(book) {
      const seen = new Set<number>();
      let best: number | undefined;
      for (const key of keysOf(book)) {
        for (const at of buckets.get(key) || []) {
          if (best !== undefined && at > best) break; // positions are ascending: nothing later in this bucket can beat `best`
          if (seen.has(at)) continue;
          seen.add(at);
          if (sameWork(known[at], book, true)) { best = at; break; }
        }
      }
      return best === undefined ? undefined : withSource(known[best], rated.get(best)!);
    },
  };
}

const withSource = (k: Book, r: RatingPair): RatingPair => {
  const source = inferRatingSource(k);
  return { ...r, ...(source ? { source } : {}) };
};

/** One index per list: lists are not changed after they are built, and a new list is a new array. */
const indexes = new WeakMap<readonly Book[], KnownRatings>();
const indexFor = (known: readonly Book[]): KnownRatings => {
  let idx = indexes.get(known);
  if (!idx) {
    idx = timed('ratings.index.build', () => indexKnownRatings(known));
    indexes.set(known, idx);
  }
  return idx;
};

/** The rating of the same book (any edition) in a list of books you already have, e.g. the library plus the built-in books. */
export function knownRating(book: Identified, known: readonly Book[]): RatingPair | undefined {
  return indexFor(known).of(book);
}

/**
 * Ladder step 1: the same book in `known` supplies its average + count together; otherwise the book is returned as it was.
 * Only the library's OWN pair (hand-written ratings of the built-in books and of manual books) overrides what a card carries. A pair that was
 * saved from an outside site is that site's rating as it was when saved: it fills a book with no rating, and is otherwise ranked against the
 * book's own pair by the ladder (Apple -> Open Library -> Google), so a stale saved Open Library pair cannot hide a card's Apple rating.
 */
export function withKnownRating<T extends Book>(book: T, known: readonly Book[]): T {
  const r = knownRating(book, known);
  if (!r || (r.average === book.ratingAverage && r.count === book.ratingCount)) return book;
  const own = r.source !== 'library' ? externalRating(book) : undefined;
  if (own) {
    const ownSource = book.ratingSource && book.ratingSource !== 'library' ? book.ratingSource : undefined;
    if (!ownSource || !r.source) return book; // cannot rank what is not attributed: the card keeps what it shows
    const mine: RatingPair = { ...own, source: ownSource };
    const at = (s: RatingSourceId) => [r, mine].find(x => x.source === s);
    const best = chooseRating({ apple: at('apple'), ol: at('openlibrary'), google: at('google') });
    return !best || best.source === ownSource ? book : { ...book, ratingAverage: best.average, ratingCount: best.count, ratingSource: best.source };
  }
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

/**
 * The main rating of the book info: one source only, chosen by the ladder library -> Apple -> Open Library -> Google (chooseRating).
 *  - the library's own hand-written pair always wins;
 *  - otherwise each provider's rating is a candidate: what each site says live (`found`), and the pair the book already carries (the
 *    Store card, a saved copy) ONLY as the stand-in for its own provider, and only when `found` has nothing for that provider yet.
 *    A carried pair never outranks a higher provider: a card resolved before Apple answered (or while Apple was unreachable) carries
 *    Open Library's pair, and must not hide Apple's rating once it is known. The other sites are listed beside it by otherRatings.
 *  - a carried pair whose provider cannot be told (no ratingSource, matches no site exactly) is used only when nothing else is rated.
 */
export function mainRating(book: Pick<Book, 'id' | 'source' | 'ratingAverage' | 'ratingCount' | 'ratingSource'>, found: readonly SourceRating[] = []): RatingPair | undefined {
  const own = ratingOf(book);
  const ownSource = inferRatingSource(book, found);
  if (own && ownSource === 'library') return { ...own, source: 'library' };
  const kept = externalRating(book);
  const site = (s: SourceRating['source']) => found.find(f => f.source === s);
  const candidate = (s: SourceRating['source']): RatingPair | undefined => {
    const live = site(s);
    if (live) return live; // what the site says now beats what a card or a saved copy remembers of it
    return kept && ownSource === s ? { ...kept, source: s } : undefined;
  };
  const picked = chooseRating({ apple: candidate('apple'), ol: candidate('openlibrary'), google: candidate('google') });
  return picked ?? (kept ? { ...kept, ...(ownSource ? { source: ownSource } : {}) } : undefined);
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
