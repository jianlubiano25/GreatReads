import type { Book } from '../../types';
import { bookKind } from '../bookKind';
import { SEARCH_GENRES } from '../../data/searchGenres';
import { isKnownGenre } from './model';
import { normQ } from './query';

/** What a result of a genre (or sub-genre) search should be: a book of the other kind is pushed down. Built from the genre list, so it cannot drift from it. */
const KIND_OF_QUERY: Map<string, 'fiction' | 'nonfiction'> = new Map();
for (const g of SEARCH_GENRES) {
  if (!g.kind) continue;
  KIND_OF_QUERY.set(normQ(g.query), g.kind);
  // "cozy mystery", "psychological thriller", "leadership": a sub-genre of a fiction genre is fiction, of a non-fiction genre non-fiction
  for (const s of g.subgenres) if (!KIND_OF_QUERY.has(normQ(s.query))) KIND_OF_QUERY.set(normQ(s.query), g.kind);
}

/** The kind the typed words ask for, or undefined (a title, an author, a topic that has both kinds). */
export const kindOfQuery = (text: string): 'fiction' | 'nonfiction' | undefined => KIND_OF_QUERY.get(normQ(text));

/** Pushed down when the catalog files the book as the other kind ("The Psychology of Fantasy" in a Fantasy search); a book with no known genre is left alone. */
export const KIND_MISMATCH = -35;
export function kindAdjust(b: Pick<Book, 'genre'>, want: 'fiction' | 'nonfiction' | undefined): number {
  if (!want || !isKnownGenre(b.genre)) return 0;
  return bookKind(b) === want ? 0 : KIND_MISMATCH;
}

/** A book nobody rated, with no cover, in a broad genre search: almost always a thin catalog record. A small push down, never a removal. */
export const THIN_RECORD = -15;
export const thinRecord = (b: Pick<Book, 'ratingCount' | 'ratingAverage' | 'coverId' | 'coverUrl'>): number =>
  !b.ratingCount && !b.ratingAverage && !b.coverId && !b.coverUrl ? THIN_RECORD : 0;

const authorKey = (a: string) => normQ(a || '');

/**
 * One author does not fill a genre page (the whole Discworld, every volume of a series): within the first `window` places an author appears
 * at most `perAuthor` times, and the extra books follow after them in their own order. Nothing is dropped, and a book with an unknown author is never held back.
 */
export function diversify<T extends Pick<Book, 'author'>>(list: readonly T[], perAuthor = 2, window = 24): T[] {
  const seen = new Map<string, number>();
  const first: T[] = [];
  const later: T[] = [];
  for (const b of list) {
    const k = authorKey(b.author);
    const n = seen.get(k) || 0;
    if (!k || /unknown/.test(k) || (first.length < window && n < perAuthor)) {
      if (first.length < window) { first.push(b); seen.set(k, n + 1); continue; }
    }
    later.push(b);
  }
  return [...first, ...later];
}
