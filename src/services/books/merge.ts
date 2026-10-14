import type { Book } from '../../types';
import { mergeIdentity, sameWork } from './identity';
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
  if (!out.authorBio && b.authorBio) out.authorBio = b.authorBio;
  if (!isKnownGenre(out.genre) && isKnownGenre(b.genre)) out.genre = b.genre;
  out.identity = mergeIdentity(out.identity, b.identity);
  return out;
}

/** Collapse a list so each book appears once (first occurrence wins, later ones fill its gaps). */
export function dedupeBooks(list: Book[]): Book[] {
  const out: Book[] = [];
  for (const book of list) {
    if (!book.title) continue;
    const i = out.findIndex(m => sameWork(m, book));
    if (i >= 0) out[i] = mergeBooks(out[i], book);
    else out.push(book);
  }
  return out;
}
