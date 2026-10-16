import type { Book } from '../../types';
import { mergeIdentity, sameWork, titleKey, titlesMatch } from './identity';
import { looksEnglish, titleLooksForeign } from './language';
import { hasRealSummary, isKnownGenre } from './model';
import { chooseRating, externalRating, ratingOf, type RatingPair } from './ratings';

/** The same book from two places becomes one record that keeps the best of both. `a` wins on identity (id, title, author). */
export function mergeBooks(a: Book, b: Book): Book {
  const out: Book = { ...a };
  if (!out.coverId && !out.coverUrl) {
    if (b.coverId) out.coverId = b.coverId;
    else if (b.coverUrl) out.coverUrl = b.coverUrl;
  }
  if (!out.pageCount && b.pageCount) { out.pageCount = b.pageCount; out.difficulty = b.difficulty; }
  if (!out.year && b.year) out.year = b.year;
  // A rating is an average + count from ONE audience: `a` keeps its pair; `b`'s pair is taken whole only when `a` has none, or when both are
  // attributed outside-site pairs and `b`'s site ranks higher (Apple -> Open Library -> Google, ratings.ts): a record that was merged first
  // must not hide a better-ranked provider's pair. Never add the counts or mix one record's average with the other's count.
  if (!ratingOf(out) && ratingOf(b)) {
    out.ratingAverage = b.ratingAverage;
    out.ratingCount = b.ratingCount;
    out.ratingSource = b.ratingSource;
  } else if (out.ratingSource && b.ratingSource && out.ratingSource !== 'library' && b.ratingSource !== 'library' && b.ratingSource !== out.ratingSource) {
    const pa = externalRating(out);
    const pb = externalRating(b);
    if (pa && pb) {
      const pair = (r: RatingPair, source: RatingPair['source']): RatingPair => ({ ...r, source });
      const all = [pair(pa, out.ratingSource), pair(pb, b.ratingSource)];
      const at = (s: string) => all.find(x => x.source === s);
      const best = chooseRating({ apple: at('apple'), ol: at('openlibrary'), google: at('google') });
      if (best && best.source === b.ratingSource) { out.ratingAverage = best.average; out.ratingCount = best.count; out.ratingSource = best.source; }
    }
  }
  if (!hasRealSummary(out.summary) && hasRealSummary(b.summary)) out.summary = b.summary;
  if ((!out.authorBio || !looksEnglish(out.authorBio)) && b.authorBio && looksEnglish(b.authorBio)) out.authorBio = b.authorBio;
  // The same book catalogued under a foreign title ("L’étranger") takes the English title of its other copy ("The Stranger"); a different spelling alone ("Pokémon") is not a translation
  if (titleLooksForeign(out.title) && !titleLooksForeign(b.title) && titleKey(out.title) !== titleKey(b.title) && titlesMatch(out.title, b.title)) out.title = b.title;
  if (!isKnownGenre(out.genre) && isKnownGenre(b.genre)) out.genre = b.genre;
  out.identity = mergeIdentity(out.identity, b.identity);
  return out;
}

/** `long` is `short` plus a subtitle or edition note ("Verity: Special Edition", "Dune (Deluxe Edition)"): the shorter one is the clean title. */
function isDecorated(long: string, short: string): boolean {
  const l = long.trim().toLowerCase();
  const s = short.trim().toLowerCase();
  if (!s || l.length <= s.length || !l.startsWith(s)) return false;
  return /^\s*[:([\-–—,]/.test(l.slice(s.length));
}

/**
 * Collapse a list so each book appears once (first occurrence wins, later ones fill its gaps).
 * The record keeps the cleanest title of its copies, so an edition that happened to be listed first ("Verity: Special Edition") does not
 * make the book read, rank and display as a secondary edition.
 */
export function dedupeBooks(list: Book[]): Book[] {
  const out: Book[] = [];
  for (const book of list) {
    if (!book.title) continue;
    const i = out.findIndex(m => sameWork(m, book));
    if (i >= 0) {
      const merged = mergeBooks(out[i], book);
      if (isDecorated(out[i].title, book.title)) merged.title = book.title;
      out[i] = merged;
    } else out.push(book);
  }
  return out;
}
