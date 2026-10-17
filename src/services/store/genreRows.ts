import type { Book } from '../../types';
import type { SearchGenre } from '../../data/searchGenres';
import { persistentCache } from '../books/cache';
import { searchBooksLive } from '../books/search';
import { shrunkRating } from '../books/model';
import { kindAdjust } from '../books/genreRank';
import type { ShelfSource } from './shelves';

/**
 * The two rows under a genre's hand-picked books: "New releases" and "Hidden gems". Both are cut from ONE ranked Keywords search of the genre
 * (the same ranking the results below use), so a genre costs a single catalog request however many rows it shows. The search is kept for a day,
 * and an older copy is still used when the catalogs can't be reached, so a repeat tap is instant and works offline.
 */
export const ROW_SIZE = 12;
/** A "new release" came out this year or last year, and has a cover. */
export const NEW_YEARS = 1;
/** A "hidden gem" is well liked (average) by enough readers to mean something, but not one of the most-read books of the genre. */
export const GEM_MIN_AVERAGE = 4.1;
export const GEM_MIN_RATINGS = 40;
export const GEM_MAX_RATINGS = 5000;
/** A row with fewer books than this is not worth showing */
export const MIN_ROW = 3;

const hasCover = (b: Book) => !!(b.coverId || b.coverUrl);
const rightKind = (b: Book, kind: SearchGenre['kind']) => kindAdjust(b, kind) === 0;

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
    .filter(b => hasCover(b) && rightKind(b, kind) && (b.ratingAverage || 0) >= GEM_MIN_AVERAGE && (b.ratingCount || 0) >= GEM_MIN_RATINGS && (b.ratingCount || 0) <= GEM_MAX_RATINGS)
    .map((b, i) => ({ b, i, k: shrunkRating(b.ratingAverage, b.ratingCount) }))
    .sort((x, y) => y.k - x.k || x.i - y.i)
    .map(x => x.b)
    .slice(0, ROW_SIZE);
}

const POOL_TTL = 24 * 60 * 60 * 1000;
const pools = persistentCache<Book[]>('readlife.genrepool1', { ttl: POOL_TTL, max: 30, keepStale: 14 * 24 * 60 * 60 * 1000, validate: v => Array.isArray(v) });
const inFlight = new Map<string, Promise<Book[]>>();

/** The ranked books of a genre's Keywords search: kept for a day; shared by both rows; an older copy stands in when the catalogs fail. */
export function genrePool(g: SearchGenre): Promise<Book[]> {
  const fresh = pools.get(g.query);
  if (fresh) return Promise.resolve(fresh);
  let p = inFlight.get(g.query);
  if (!p) {
    p = searchBooksLive(g.query, { scope: 'keywords', limit: 40, final: true, local: false })
      .then(books => {
        if (books.length) { pools.set(g.query, books); return books; }
        return pools.peek(g.query)?.value ?? [];
      })
      .catch(() => pools.peek(g.query)?.value ?? [])
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
  src = {
    id: `genre-${row}-${g.label}`,
    cached: () => { const hit = pools.peek(g.query)?.value; const books = hit ? cut(hit) : []; return books.length >= MIN_ROW ? books : null; },
    load: async () => {
      const books = cut(await genrePool(g));
      if (books.length < MIN_ROW) throw new Error('too few books for this row');
      return books;
    },
  };
  sources.set(key, src);
  return src;
}
