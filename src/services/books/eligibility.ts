import type { Book } from '../../types';
import { persistentCache } from './cache';
import { authorKey, bookKey, titleKey } from './identity';

/**
 * The memory side of the content-eligibility filter (the judgement itself is in quality.ts).
 *
 * A saved shelf is only a list of Books: the categories, description and ratings that got a book excluded are not kept with it. So
 * the moment a book is excluded (collate.ts, rankPool) it is also REMEMBERED here, and every path that hands a saved, stale or
 * fallback list to the screen runs it through `filterEligible` first. A book judged ineligible while one shelf was being built can
 * therefore never come back through another shelf's saved list, or through a list saved before the judgement was made.
 *
 * This is a cache of the app's own verdicts, never user data: it holds only book keys, can be wiped at any time (it is on the
 * re-downloadable list), and only ever REMOVES books from discovery shelves. Search, the Library and Book Info never read it.
 */

/**
 * Bump when the rules in quality.ts change in a way that should re-judge books already saved: lists saved under an older
 * version are not trusted (see bestsellers.ts), so no card built under the old rules can stay on screen.
 */
export const CONTENT_FILTER_VERSION = 1;

const excluded = persistentCache<true>('readlife.excluded1', { ttl: 60 * 24 * 60 * 60 * 1000, max: 400 });

/**
 * The same book is recognised however a list spells it: by its exact edition / work when known, by normalised title + author, and by
 * title + surname (sources disagree on middle initials: "Anne Hooper" / "Anne J. Hooper").
 */
const keysOf = (b: Pick<Book, 'id' | 'identity' | 'title' | 'author'>): string[] => {
  const author = authorKey(b.author);
  return [...new Set([bookKey(b), `ta:${titleKey(b.title)}|${author}`, `ts:${titleKey(b.title)}|${author.split(' ').pop()}`])];
};

export function isRememberedExcluded(b: Pick<Book, 'id' | 'identity' | 'title' | 'author'>): boolean {
  return keysOf(b).some(k => excluded.get(k) === true);
}

export function rememberExcluded(b: Pick<Book, 'id' | 'identity' | 'title' | 'author'>): void {
  for (const k of keysOf(b)) if (excluded.get(k) !== true) excluded.set(k, true);
}

/** Forget every verdict (tests only). */
export const forgetExcludedForTests = (books: Pick<Book, 'id' | 'identity' | 'title' | 'author'>[]) => books.forEach(b => keysOf(b).forEach(k => excluded.delete(k)));

/** A list safe to draw: books already judged ineligible are dropped. The same array comes back when nothing was dropped. */
export function filterEligible<T extends Pick<Book, 'id' | 'identity' | 'title' | 'author'>>(books: T[]): T[] {
  const kept = books.filter(b => !isRememberedExcluded(b));
  return kept.length === books.length ? books : kept;
}
