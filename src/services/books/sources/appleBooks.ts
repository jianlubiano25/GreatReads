import { getJsonDetailed } from '../http';
import { authorListMatches, subtitleKey, titleKey, titleVariants, titlesMatch } from '../identity';
import { genreFromSubjects, makeBook, plainText } from '../model';
import { isEnglishLanguage, titleIsNonLatin } from '../language';
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
    const original = titleIsNonLatin(q.title); // asked for by its own non-Latin title: that language's listing is the book
    const english = (it: any) => original || isEnglishLanguage(String(it.languageCodesISO2A?.[0] || '').toLowerCase());
    const localizedAuthorCandidate = (it: any) => original && !!q.author && titleKey(String(it.trackName || '')) === titleKey(q.title)
      && !authorListMatches(it.artistName, q.author) && /\p{Script=Latin}/u.test(q.author) !== /\p{Script=Latin}/u.test(String(it.artistName || ''));
    const matches: any[] = (r.data?.results || []).filter((it: any) => it.artworkUrl100 && english(it) && !BUNDLE_TITLE.test(String(it.trackName || '')) && titlesMatch(String(it.trackName || ''), q.title) && (authorListMatches(it.artistName, q.author || '') || localizedAuthorCandidate(it)));
    const rated = (it: any) => (it.averageUserRating && it.userRatingCount > 0 ? Number(it.userRatingCount) : 0);
    const first = matches[0];
    const sameListing = (it: any) => titleKey(String(it.trackName || '')) === titleKey(String(first.trackName || '')) && subtitleKey(String(it.trackName || '')) === subtitleKey(String(first.trackName || ''));
    m = first && !rated(first) ? matches.filter(sameListing).reduce<any>((best, it) => (rated(it) > rated(best) ? it : best), first) : first;
    if (m || opts.signal?.aborted) break;
  }
  if (!m) return { hit: null, failed };
  return { hit: appleHit(m), failed: false };
}

/**
 * The name Apple prints on the jacket of the book with exactly this title, for a saved book filed under the author's legal name (Open Library: Ursula Vernon,
 * Apple: T. Kingfisher). lookupApple cannot find it, because it only accepts a listing whose author matches the saved one. So this asks by title alone and
 * answers only when it is unambiguous: every English listing with that exact title names the same author (a common title with several authors answers nothing).
 */
/** A title distinctive enough to identify one book on its own: three or more words once articles and subtitles are set aside ("Nettle & Bone"; not "The Witch", "Less", "Gone Girl"). */
export const isDistinctiveTitle = (title = ''): boolean => titleKey(title).split(' ').filter(Boolean).length >= 3;

export async function appleJacketAuthor(title: string, opts: CallOpts = {}): Promise<{ author: string; year: string } | null> {
  const t = title.trim();
  // A short or common title ("The Witch", "Less", "Gone") belongs to many books by different authors, so a title alone never says whose book this is: at least three words
  if (!t || !isDistinctiveTitle(t)) return null;
  const r = await getJsonDetailed(`https://itunes.apple.com/search?media=ebook&entity=ebook&limit=8&country=us&lang=en_us&term=${encodeURIComponent(t)}`, { timeout: 4500, signal: opts.signal });
  const listings: any[] = (r.data?.results || []).filter((it: any) => it.artistName && isEnglishLanguage(String(it.languageCodesISO2A?.[0] || '').toLowerCase()) && !BUNDLE_TITLE.test(String(it.trackName || '')) && titleKey(String(it.trackName || '')) === titleKey(t));
  const authors = new Set(listings.map(it => String(it.artistName).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()));
  if (!listings.length || authors.size !== 1) return null;
  return { author: String(listings[0].artistName), year: listings[0].releaseDate ? String(listings[0].releaseDate).slice(0, 4) : '' };
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
