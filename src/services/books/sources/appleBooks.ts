import { getJsonDetailed } from '../http';
import { authorListMatches, subtitleKey, titleKey, titleVariants, titlesMatch } from '../identity';
import { genreFromSubjects, makeBook, plainText } from '../model';
import { isEnglishLanguage } from '../language';
import { BUNDLE_TITLE } from './openLibrary';
import type { CallOpts, Hit } from './types';

/**
 * Apple Books (iTunes Search): fast CDN, 600x900 art, readers' ratings. No key needed.
 * `failed` tells a search that could not be answered (offline, rate limited, 5xx) from a search that answered and had no matching book,
 * so a failure is never remembered as "Apple has no rating for this book" (see lookupApple's callers).
 */
export async function lookupApple(q: { title: string; author?: string }, opts: CallOpts = {}): Promise<{ hit: Hit | null; failed: boolean }> {
  const generic = !q.author || /^(Unknown|Featured) Author$/.test(q.author);
  // Apple lists a book under its own (often shorter, club-marketed or translated) title: ask with the full title, then the main
  // title, then each half of a dual title. The first search that returns a matching book wins.
  let m: any;
  let failed = false;
  for (const title of titleVariants(q.title)) {
    const term = encodeURIComponent(`${title} ${generic ? '' : q.author}`.trim());
    const r = await getJsonDetailed(`https://itunes.apple.com/search?media=ebook&entity=ebook&limit=6&country=us&lang=en_us&term=${term}`, { timeout: 4500, signal: opts.signal });
    if (!r.data && !opts.signal?.aborted && (r.status === 0 || r.status === 429 || r.status >= 500 || r.failure === 'not-json')) failed = true; // a malformed answer is not "no such book"
    // The same book can be listed more than once (editions, re-listings). Apple's first match stays the book, but when that listing is unrated,
    // an identically titled duplicate that Apple's readers rated (the most ratings) is taken instead: an unrated duplicate must not hide the
    // rating. A differently titled listing (a study guide, a bundle) is never a stand-in.
    // A listing that declares another language (Apple's languageCodesISO2A) is a translation's art: skipped, so an English listing (or the next source) supplies the cover
    const english = (it: any) => isEnglishLanguage(String(it.languageCodesISO2A?.[0] || '').toLowerCase());
    const matches: any[] = (r.data?.results || []).filter((it: any) => it.artworkUrl100 && english(it) && !BUNDLE_TITLE.test(String(it.trackName || '')) && titlesMatch(String(it.trackName || ''), q.title) && authorListMatches(it.artistName, q.author || ''));
    const rated = (it: any) => (it.averageUserRating && it.userRatingCount > 0 ? Number(it.userRatingCount) : 0);
    const first = matches[0];
    const sameListing = (it: any) => titleKey(String(it.trackName || '')) === titleKey(String(first.trackName || '')) && subtitleKey(String(it.trackName || '')) === subtitleKey(String(first.trackName || ''));
    m = first && !rated(first) ? matches.filter(sameListing).reduce<any>((best, it) => (rated(it) > rated(best) ? it : best), first) : first;
    if (m || opts.signal?.aborted) break;
  }
  if (!m) return { hit: null, failed };
  return { hit: appleHit(m), failed: false };
}

export async function findApple(q: { title: string; author?: string }, opts: CallOpts = {}): Promise<Hit | null> {
  return (await lookupApple(q, opts)).hit;
}

function appleHit(m: any): Hit {
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
