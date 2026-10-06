import type { Book } from '../../types';
import { mapPool } from '../books/http';
import { isbnPair } from '../books/identity';
import { mergeBooks } from '../books/merge';
import { makeBook } from '../books/model';
import { resolveBook } from '../books/resolve';
import { fetchNytList, type NytEntry } from '../books/sources/nyt';
import { dynamicShelves, type ShelfSource } from './shelves';

/**
 * "Top 15 this week": the New York Times bestseller list. The NYT decides WHICH books and in WHAT ORDER; nothing downstream
 * (Google Books, Open Library, Apple) can reorder or drop an entry. Each entry's ISBN then pins the exact edition so the
 * details and cover are accurate.
 *
 *   NYT list -> ranked books (shown at once, with the NYT's own cover) -> ISBN -> Google/Open Library details -> final shelf
 */

export interface NytShelf {
  id: string;
  list: string; // NYT list name (encoded)
  title: string;
  genre: string;
}

/** Which NYT lists the Store shows. Add or swap an entry (e.g. 'hardcover-fiction') to change the Store. */
export const NYT_SHELVES: NytShelf[] = [
  { id: 'nyt-fiction', list: 'combined-print-and-e-book-fiction', title: 'Top 15 this week · Fiction', genre: 'Fiction' },
  { id: 'nyt-nonfiction', list: 'combined-print-and-e-book-nonfiction', title: 'Top 15 this week · Non-Fiction', genre: 'Non-fiction' },
];

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

const refining = new Set<string>();

export function bestsellerSource(shelf: NytShelf): ShelfSource {
  return {
    id: shelf.id,
    cached: () => dynamicShelves.get(shelf.id) ?? null,
    load: async onUpdate => {
      const cached = dynamicShelves.get(shelf.id);
      if (cached) return cached;
      const entries = await fetchNytList(shelf.list);
      if (!entries) throw new Error('NYT list unavailable');
      const top = entries.slice(0, 15);
      const provisional = top.map(e => nytEntryToBook(e, shelf.genre));

      if (!refining.has(shelf.id)) {
        refining.add(shelf.id);
        void (async () => {
          try {
            const out = [...provisional];
            await mapPool(top, 3, async (e, i) => {
              const r = await resolveBook({ title: e.title, author: e.author, isbn: e.isbn13 || e.isbn10, fallbackId: provisional[i].id, genreHint: shelf.genre });
              out[i] = combineWithNyt(provisional[i], r?.book ?? null); // slot i stays slot i: the rank never moves
              onUpdate([...out]);
            });
            dynamicShelves.set(shelf.id, out);
          } finally {
            refining.delete(shelf.id);
          }
        })();
      }
      return provisional;
    },
  };
}
