import type { Book } from '../../types';
import { dedupeBooks } from './merge';
import { hasRealSummary, isKnownGenre, shrunkRating } from './model';
import { searchGoogle } from './sources/googleBooks';
import { searchOpenLibrary } from './sources/openLibrary';
import { isUnknownAuthor } from './identity';

/** Lower-case, accent-free, letters and digits only: "Brontë!" and "bronte" compare equal. */
const normQ = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * How well a result fits what was typed, in this order of importance:
 * exact/strong title match -> author match -> popularity (rating count) -> rating quality -> metadata completeness -> cover -> a small recency nudge.
 * The title tier is worth up to 100; everything after it adds only a few points each, so a better title match nearly always
 * wins, and among similar title matches the established, well-documented book comes first.
 */
export function searchRelevance(b: Book, qTitle: string, qAuthor = ''): number {
  const q = normQ(qTitle);
  const t = normQ(b.title || '');
  const a = normQ(b.author || '');
  let score = 0;
  if (q && t) {
    if (t === q) score += 100;
    else if (t.startsWith(`${q} `)) score += 70;
    else if (` ${t} `.includes(` ${q} `)) score += 55;
    else {
      const words = q.split(' ').filter(w => w.length > 1);
      const hit = words.filter(w => ` ${t} `.includes(` ${w} `)).length;
      score += words.length ? (40 * hit) / words.length : 0;
    }
    // Someone typing an author's name (e.g. "josh silver") wants that author's books
    if (q.split(' ').every(w => ` ${a} `.includes(` ${w} `))) score += 60;
  }
  if (qAuthor) {
    const last = normQ(qAuthor).split(' ').pop();
    if (last && ` ${a} `.includes(` ${last} `)) score += 50;
  }
  const count = b.ratingCount || 0;
  score += Math.min(14, Math.log10(count + 1) * 3.2); // popularity: 100 ratings ~6, 10k ~13
  if (b.ratingAverage) score += Math.max(-3, Math.min(9, (shrunkRating(b.ratingAverage, count) - 3.5) * 6)); // quality, shrunk for small samples
  let meta = 0;
  if (b.pageCount) meta += 1.5;
  if (b.year) meta += 1;
  if (hasRealSummary(b.summary)) meta += 1.5;
  if (isKnownGenre(b.genre)) meta += 1;
  if (!isUnknownAuthor(b.author)) meta += 1;
  score += meta; // up to 6
  if (b.coverId || b.coverUrl) score += 4;
  const year = Number(b.year);
  const thisYear = new Date().getFullYear();
  if (year && year >= thisYear - 1) score += 2; // a small nudge for brand-new releases
  else if (year && year >= thisYear - 5) score += 1;
  return score;
}

/**
 * Search for books. Open Library and Google Books are asked AT THE SAME TIME and their answers are merged, because each one
 * misses things the other has: Open Library is slow to list brand-new releases, and a plain title search can be crowded out
 * by unrelated books. Results are de-duplicated by work/edition identity and ranked so the closest title match comes first.
 * Title-only searching is fully supported (author is optional).
 */
export async function searchBooks(title: string, author = '', limit = 10, signal?: AbortSignal): Promise<Book[]> {
  const qTitle = title.trim();
  const qAuthor = author.trim();
  if (!qTitle) return [];

  // A slightly larger candidate set than we show lets ranking pick the best (bulk import asks for 1 and stays small)
  const candidates = limit <= 1 ? 10 : Math.min(24, Math.max(16, limit * 2));
  const gbQuery = qAuthor ? `intitle:"${qTitle}" inauthor:"${qAuthor}"` : `intitle:"${qTitle}"`;
  const lists = await Promise.all([
    ...(qAuthor
      ? [searchOpenLibrary({ title: qTitle, author: qAuthor }, candidates, { signal })]
      : [
          searchOpenLibrary({ q: qTitle }, candidates, { signal }), // title, author or keyword
          searchOpenLibrary({ title: qTitle }, candidates, { signal }), // titles only: far fewer unrelated hits
        ]),
    searchGoogle(gbQuery, candidates, { signal }),
  ]);
  if (signal?.aborted) return [];

  return dedupeBooks(lists.flat().map(h => h.book))
    .map((book, order) => ({ book, order, score: searchRelevance(book, qTitle, qAuthor) }))
    .sort((x, y) => y.score - x.score || x.order - y.order)
    .slice(0, limit)
    .map(x => x.book);
}
