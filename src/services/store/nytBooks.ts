import type { Book } from '../../types';
import { isbnPair } from '../books/identity';
import { mergeBooks } from '../books/merge';
import { makeBook } from '../books/model';
import type { NytEntry } from '../books/sources/nyt';

export const nytLabel = (e: NytEntry) =>
  e.weeksOnList > 1 ? `NYT bestseller · ${e.weeksOnList} weeks` : e.rankLastWeek === 0 ? 'NYT bestseller · new this week' : 'NYT bestseller';

/** The book as the NYT describes it: complete enough to show, accurate on rank, title, author and edition. */
export function nytEntryToBook(e: NytEntry, genre: string): Book {
  return makeBook({
    id: `nyt_${e.isbn13 || e.isbn10 || `${e.list}_${e.rank}`}`,
    title: e.title,
    author: e.author,
    genre,
    summary: e.description || `${e.title} by ${e.author}.`,
    coverUrl: e.cover || undefined,
    awardLabel: nytLabel(e),
    source: 'nyt',
    identity: isbnPair(e.isbn13 || e.isbn10),
  });
}

/** NYT facts win on what the list says; resolved data fills everything else (and supplies the Open Library work id). */
export function combineWithNyt(nytBook: Book, resolved: Book | null): Book {
  if (!resolved) return nytBook;
  const merged = mergeBooks(resolved, nytBook);
  return { ...merged, title: nytBook.title, author: nytBook.author, awardLabel: nytBook.awardLabel, coverUrl: nytBook.coverUrl || merged.coverUrl, genre: nytBook.genre !== 'Book' && merged.genre === 'Book' ? nytBook.genre : merged.genre };
}
