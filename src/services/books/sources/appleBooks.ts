import { getJson } from '../http';
import { authorListMatches, titlesMatch } from '../identity';
import { genreFromSubjects, makeBook, plainText } from '../model';
import type { CallOpts, Hit } from './types';

/** Apple Books (iTunes Search): fast CDN, 600x900 art, readers' ratings. No key needed. */
export async function findApple(q: { title: string; author?: string }, opts: CallOpts = {}): Promise<Hit | null> {
  const generic = !q.author || /^(Unknown|Featured) Author$/.test(q.author);
  const term = encodeURIComponent(`${q.title} ${generic ? '' : q.author}`.trim());
  const data = await getJson(`https://itunes.apple.com/search?media=ebook&entity=ebook&limit=6&term=${term}`, { timeout: 4500, signal: opts.signal });
  const m = (data?.results || []).find((it: any) => it.artworkUrl100 && titlesMatch(String(it.trackName || ''), q.title) && authorListMatches(it.artistName, q.author || ''));
  if (!m) return null;
  const genres: string[] = Array.isArray(m.genres) ? m.genres.map(String).filter((g: string) => g !== 'Books') : [];
  const book = makeBook({
    id: `apple_${m.trackId}`,
    title: String(m.trackName),
    author: String(m.artistName || 'Unknown Author'),
    year: m.releaseDate ? String(m.releaseDate).slice(0, 4) : '',
    genre: genreFromSubjects(genres) || genres[0] || 'Book',
    summary: m.description ? plainText(String(m.description)).slice(0, 500) : undefined as any,
    coverUrl: String(m.artworkUrl100).replace(/100x100bb\.(jpg|png)/, '600x900bb.$1'),
    ratingAverage: m.averageUserRating && m.userRatingCount ? Number(Number(m.averageUserRating).toFixed(1)) : undefined,
    ratingCount: m.userRatingCount || undefined,
    source: 'apple',
  });
  if (!m.description) book.summary = `A book by ${book.author}.`;
  return { book, flags: { subjects: genres, description: m.description ? String(m.description) : undefined, appleAdvisory: String(m.contentAdvisoryRating || m.trackExplicitness || '') } };
}
