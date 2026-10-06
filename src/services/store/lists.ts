/** Which NYT lists the Store shows. Add or swap an entry (e.g. 'hardcover-fiction') to change the Store. */
export interface NytShelf {
  id: string;
  list: string; // NYT list name (encoded)
  title: string;
  genre: string;
  kind: 'fiction' | 'nonfiction';
}

export const NYT_SHELVES: NytShelf[] = [
  { id: 'nyt-fiction', list: 'combined-print-and-e-book-fiction', title: 'Top 15 this week · Fiction', genre: 'Fiction', kind: 'fiction' },
  { id: 'nyt-nonfiction', list: 'combined-print-and-e-book-nonfiction', title: 'Top 15 this week · Non-Fiction', genre: 'Non-fiction', kind: 'nonfiction' },
];
