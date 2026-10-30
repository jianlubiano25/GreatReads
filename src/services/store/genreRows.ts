import type { Book } from '../../types';
import type { SearchGenre } from '../../data/searchGenres';
import { persistentCache } from '../books/cache';
import { searchBooksLive } from '../books/search';
import { shrunkRating } from '../books/model';
import { fillMissingCovers } from '../books/covers';
import { kindAdjust } from '../books/genreRank';
import { InsufficientShelfError, type ShelfSource } from './shelves';

/** Both rows share a per-origin genre search pool. Hidden Gems also keeps its last eligible row for offline use and failed refreshes. */
export const ROW_SIZE = 12;
/** A "new release" came out this year or last year, and has a cover. */
export const NEW_YEARS = 1;
/** A "hidden gem" is well liked (average) by enough readers to mean something, but not one of the most-read books of the genre. */
export const GEM_MIN_AVERAGE = 4.1;
export const GEM_MIN_RATINGS = 40;
export const GEM_MAX_RATINGS = 5000;
/** A row with fewer books than this is not worth showing */
export const MIN_ROW = 3;

const hasCover = (b: Book) => {
  if (Number.isInteger(b.coverId) && Number(b.coverId) > 0) return true;
  if (!b.coverUrl) return false;
  try { return new URL(b.coverUrl).protocol === 'https:'; } catch { return false; }
};
const rightKind = (b: Book, kind: SearchGenre['kind']) => kindAdjust(b, kind) === 0;
const isGem = (b: Book, kind: SearchGenre['kind']) => {
  const average = Number(b.ratingAverage);
  const count = Number(b.ratingCount);
  return hasCover(b) && rightKind(b, kind) && Number.isFinite(average) && average >= GEM_MIN_AVERAGE && Number.isFinite(count) && count >= GEM_MIN_RATINGS && count <= GEM_MAX_RATINGS;
};

export function newReleases(pool: readonly Book[], kind: SearchGenre['kind'], year = new Date().getFullYear()): Book[] {
  return pool
    .filter(b => hasCover(b) && Number(b.year) >= year - NEW_YEARS && Number(b.year) <= year && rightKind(b, kind))
    .map((b, i) => ({ b, i }))
    .sort((x, y) => Number(y.b.year) - Number(x.b.year) || (y.b.ratingCount || 0) - (x.b.ratingCount || 0) || x.i - y.i)
    .map(x => x.b)
    .slice(0, ROW_SIZE);
}

export function hiddenGems(pool: readonly Book[], kind: SearchGenre['kind']): Book[] {
  return pool
    .filter(b => isGem(b, kind))
    .map((b, i) => ({ b, i, k: shrunkRating(b.ratingAverage, b.ratingCount) }))
    .sort((x, y) => y.k - x.k || x.i - y.i)
    .map(x => x.b)
    .slice(0, ROW_SIZE);
}

const DAY = 24 * 60 * 60 * 1000;
const STALE_FOR = 14 * DAY;
const pools = persistentCache<Book[]>('readlife.genrepool1', { ttl: DAY, max: 30, keepStale: STALE_FOR, validate: Array.isArray });
const gemShelves = persistentCache<Book[]>('readlife.genregems1', { ttl: DAY, max: 30, keepStale: STALE_FOR, validate: Array.isArray });
type PoolResult = { books: Book[]; failed: boolean };
const inFlight = new Map<string, Promise<PoolResult>>();

async function genrePool(g: SearchGenre): Promise<PoolResult> {
  const fresh = pools.get(g.query);
  if (fresh) return { books: fresh, failed: false };
  let p = inFlight.get(g.query);
  if (!p) {
    const stale = pools.peek(g.query)?.value;
    p = (async () => {
      let failed = false;
      try {
        const books = await searchBooksLive(g.query, {
          scope: 'keywords', limit: 40, final: true, local: false,
          onUpdate: (_books, state) => { if (state.done) failed = !!state.failedSources?.length; },
        });
        if (failed) return { books: stale ?? books, failed: true };
        // An EMPTY answer (providers slow, timed out or rate-limited without saying so) is a failure, not a result: never save it, or the genre shows 0 results and no Hidden Gems for a whole day.
        if (!books.length) return { books: stale ?? [], failed: true };
        pools.set(g.query, books);
        return { books, failed: false };
      } catch {
        return { books: stale ?? [], failed: true };
      }
    })()
      .finally(() => { inFlight.delete(g.query); });
    inFlight.set(g.query, p);
  }
  return p;
}

type Row = 'new' | 'gems';
const sources = new Map<string, ShelfSource>();

/** A shelf source for one row of a genre page. One object per genre and row (a shelf reloads when its source changes). Fails (so the row hides itself) when too few books qualify. */
export function genreRowSource(g: SearchGenre, row: Row): ShelfSource {
  const key = `${g.label}|${row}`;
  let src = sources.get(key);
  if (src) return src;
  const cut = (pool: readonly Book[]) => (row === 'new' ? newReleases(pool, g.kind) : hiddenGems(pool, g.kind));
  const showable = (pool: readonly Book[]) => {
    const books = cut(pool);
    return books.length >= (row === 'gems' ? 1 : MIN_ROW) ? books : null;
  };
  src = {
    id: `genre-${row}-${g.label}`,
    cached: () => {
      const fresh = pools.get(g.query);
      if (fresh) {
        const current = showable(fresh);
        const previous = row === 'gems' ? gemShelves.peek(g.query)?.value : undefined;
        const lastGood = previous && showable(previous);
        return lastGood && lastGood.length > (current?.length ?? 0) ? lastGood : current;
      }
      const oldPool = pools.peek(g.query)?.value;
      const oldGems = row === 'gems' ? gemShelves.peek(g.query)?.value : undefined;
      return (oldPool && showable(oldPool)) || (oldGems && showable(oldGems)) || null;
    },
    load: async onUpdate => {
      const result = await genrePool(g);
      const books = showable(result.books);
      if (!books) {
        const lastGood = row === 'gems' ? gemShelves.peek(g.query)?.value : undefined;
        if (lastGood && showable(lastGood)) return showable(lastGood)!;
        if (result.failed) {
          throw new Error('genre provider refresh failed');
        }
        throw new InsufficientShelfError();
      }
      if (row === 'gems') {
        const lastGood = gemShelves.peek(g.query)?.value;
        const previous = lastGood && showable(lastGood);
        if (previous && (result.failed || previous.length > books.length)) return previous;
        gemShelves.set(g.query, books);
      }
      fillMissingCovers(books, onUpdate, undefined, { upgradeWeak: ROW_SIZE }); // a modern flat front in place of an old scan, as the covers are found
      return books;
    },
  };
  sources.set(key, src);
  return src;
}
