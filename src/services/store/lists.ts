/** Which NYT lists the Store shows. Add or swap an entry (e.g. 'hardcover-fiction') to change the Store. */
export interface NytShelf {
  id: string;
  list: string; // NYT list name (encoded)
  title: string;
  genre: string;
  kind: 'fiction' | 'nonfiction';
  /** false = official list only: no GreatReads-collated stand-in when the NYT is unreachable (right for niche lists). Default true. */
  fallback?: boolean;
  /** How many entries to show (default 15). */
  limit?: number;
  /** What Customize Store says about when the list updates, when "NYT publishes weekly" is not right for it */
  schedule?: string;
}

export const NYT_SHELVES: NytShelf[] = [
  { id: 'nyt-fiction', list: 'combined-print-and-e-book-fiction', title: 'Top 15 this week · Fiction', genre: 'Fiction', kind: 'fiction' },
  { id: 'nyt-nonfiction', list: 'combined-print-and-e-book-nonfiction', title: 'Top 15 this week · Non-Fiction', genre: 'Non-fiction', kind: 'nonfiction' },
];

/**
 * More NYT lists, chosen because their books do NOT appear on the two combined lists above (those already merge print + e-book,
 * hardcover + paperback). Official list or nothing: when the NYT cannot be reached the shelf shows its last saved list (up to
 * 10 days old) or hides itself. Each list costs one cached request per 6 hours per visitor (and far fewer at the site's edge).
 */
/*
 * NYT Books API list names (list_name_encoded) noted for FUTURE shelves. Not used yet; none were verified live, run `npm run check:nyt`
 * with NYT_API_KEY to see which the NYT really publishes:
 *   Fiction & non-fiction : hardcover-fiction, hardcover-nonfiction, trade-fiction-paperback, paperback-nonfiction, mass-market-paperback
 *   Combined print & e-book: combined-print-and-e-book-fiction, combined-print-and-e-book-nonfiction   (used above)
 *   Advice                 : advice-how-to-and-miscellaneous (used below), hardcover-advice, paperback-books
 *   Children's & YA        : childrens-middle-grade-hardcover, childrens-middle-grade-paperback, childrens-middle-grade-e-book, series-books,
 *                            picture-books, young-adult-hardcover (used below), young-adult-paperback, young-adult-e-book
 *   Specialised            : graphic-books-and-manga, audio-fiction, audio-nonfiction, business-books, science, sports, crime-and-punishment,
 *                            celebrities, fashion-manners-and-customs, food-and-fitness, humor, love-and-relationships,
 *                            politics-and-american-history, religion-spirituality-and-faith, travel
 * Reported by the owner as "trade-paperback-fiction" for paperback fiction; the NYT API spec itself says trade-fiction-paperback, which is
 * what the shelf below uses (check:nyt settles it).
 */
export const NYT_EXTRA_SHELVES: NytShelf[] = [
  // The API's list name is the list_name, not the display name: NYT's own API spec shows "list_name": "Trade Fiction Paperback" with
  // "display_name": "Paperback Trade Fiction", and queries /lists/.../trade-fiction-paperback.json. `npm run check:nyt` re-checks all of these.
  { id: 'nyt-paperback-fiction', list: 'trade-fiction-paperback', title: 'NYT Best Sellers · Paperback Fiction', genre: 'Fiction', kind: 'fiction', fallback: false, limit: 10 },
  // The weekly paperback non-fiction list was retired; this is its replacement. Off by default (registry.ts).
  { id: 'nyt-paperback-nonfiction', list: 'paperback-nonfiction-monthly', title: 'NYT Best Sellers · Paperback Non-Fiction', genre: 'Non-fiction', kind: 'nonfiction', fallback: false, limit: 10, schedule: 'Checked every 6 hours when opened' },
  // The two hardcover lists are off by default (registry.ts): the combined lists at the top already include hardcovers.
  { id: 'nyt-hardcover-fiction', list: 'hardcover-fiction', title: 'NYT Best Sellers · Hardcover Fiction', genre: 'Fiction', kind: 'fiction', fallback: false, limit: 10 },
  { id: 'nyt-hardcover-nonfiction', list: 'hardcover-nonfiction', title: 'NYT Best Sellers · Hardcover Non-Fiction', genre: 'Non-fiction', kind: 'nonfiction', fallback: false, limit: 10 },
  { id: 'nyt-advice', list: 'advice-how-to-and-miscellaneous', title: 'NYT Best Sellers · Advice & How-To', genre: 'Self-help', kind: 'nonfiction', fallback: false, limit: 10 },
  { id: 'nyt-ya', list: 'young-adult-hardcover', title: 'NYT Best Sellers · Young Adult', genre: 'Young adult', kind: 'fiction', fallback: false, limit: 10 },
];

/**
 * NYT lists used ONLY by the "Popular now" row of a genre page on the Search tab (never a Store shelf, so Customize Store does not list them).
 * Official list or nothing: a genre whose list the NYT does not publish (or that cannot be loaded) simply shows no "Popular now" row.
 * List names are the NYT API's list_name_encoded; `npm run check:nyt` reports which of them the NYT really publishes.
 */
export const NYT_GENRE_SHELVES: NytShelf[] = [
  { id: 'nyt-genre-graphic', list: 'graphic-books-and-manga', title: 'NYT Best Sellers · Graphic Books & Manga', genre: 'Graphic novels', kind: 'fiction', fallback: false, limit: 10 },
  { id: 'nyt-genre-business', list: 'business-books', title: 'NYT Best Sellers · Business', genre: 'Business', kind: 'nonfiction', fallback: false, limit: 10 },
  { id: 'nyt-genre-science', list: 'science', title: 'NYT Best Sellers · Science', genre: 'Science', kind: 'nonfiction', fallback: false, limit: 10 },
  { id: 'nyt-genre-crime', list: 'crime-and-punishment', title: 'NYT Best Sellers · Crime & Punishment', genre: 'True crime', kind: 'nonfiction', fallback: false, limit: 10 },
  { id: 'nyt-genre-travel', list: 'travel', title: 'NYT Best Sellers · Travel', genre: 'Travel', kind: 'nonfiction', fallback: false, limit: 10 },
  { id: 'nyt-genre-history', list: 'politics-and-american-history', title: 'NYT Best Sellers · Politics & American History', genre: 'History', kind: 'nonfiction', fallback: false, limit: 10 },
];
