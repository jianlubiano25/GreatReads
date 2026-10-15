import type { Book } from '../../types';
import { isKnownGenre, shrunkRating } from './model';

/**
 * What the reader can do with a search result list once it is on screen: put it in another order and narrow it down.
 * Pure functions on the list that search already returned (nothing is fetched, nothing saved): the default view changes nothing.
 */
export type SearchSort = 'relevance' | 'newest' | 'rating' | 'popular';

export interface SearchView {
  sort: SearchSort;
  /** '' = every genre */
  genre: string;
  coverOnly: boolean;
  ratedOnly: boolean;
  /** Published within this many years (0 = any time); a book with no year is left out while this is on */
  years: number;
}

export const DEFAULT_SEARCH_VIEW: SearchView = { sort: 'relevance', genre: '', coverOnly: false, ratedOnly: false, years: 0 };

export const SEARCH_PUBLISHED_LABEL: Record<number, string> = { 0: 'Any time', 2: 'Last 2 years', 5: 'Last 5 years', 10: 'Last 10 years', 25: 'Last 25 years' };

export const SEARCH_SORT_LABEL: Record<SearchSort, string> = {
  relevance: 'Best match',
  newest: 'Newest first',
  rating: 'Top rated',
  popular: 'Most rated',
};

/** How many things differ from the default view (shown on the filter icon; the sort order counts as one) */
export const activeFilterCount = (v: SearchView): number => (v.sort !== 'relevance' ? 1 : 0) + (v.genre ? 1 : 0) + (v.coverOnly ? 1 : 0) + (v.ratedOnly ? 1 : 0) + (v.years ? 1 : 0);

export const isDefaultView = (v: SearchView): boolean => activeFilterCount(v) === 0;

const genreOf = (b: Book): string => (isKnownGenre(b.genre) ? String(b.genre).trim() : '');

/** Genres present in the results, most common first (ties alphabetical), so the filter only offers what can match. */
export function genreOptions(books: readonly Book[], max = 10): string[] {
  const n = new Map<string, number>();
  for (const b of books) {
    const g = genreOf(b);
    if (g) n.set(g, (n.get(g) || 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([g]) => g);
}

const hasRating = (b: Book): boolean => !!b.ratingAverage && (b.ratingCount ?? 1) > 0;
const hasCover = (b: Book): boolean => !!(b.coverId || b.coverUrl);

/** The list in the chosen order, with the chosen filters applied. Sorting is stable: books that tie keep their best-match order. */
export function applySearchView(books: readonly Book[], v: SearchView): Book[] {
  const thisYear = new Date().getFullYear();
  let out = books.filter(b => (!v.genre || genreOf(b).toLowerCase() === v.genre.toLowerCase()) && (!v.coverOnly || hasCover(b)) && (!v.ratedOnly || hasRating(b)) && (!v.years || (Number(b.year) || 0) >= thisYear - v.years));
  if (v.sort === 'relevance') return out;
  const key = (b: Book): number => {
    if (v.sort === 'newest') return Number(b.year) || 0; // no year sorts last
    if (v.sort === 'rating') return hasRating(b) ? shrunkRating(b.ratingAverage, b.ratingCount) : 0; // small samples are pulled toward the middle
    return b.ratingCount || 0;
  };
  out = out.map((b, i) => ({ b, i, k: key(b) })).sort((x, y) => y.k - x.k || x.i - y.i).map(x => x.b);
  return out;
}
