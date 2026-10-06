import type { Book } from '../../types';
import { mergeIdentity, sameWork } from './identity';
import { hasRealSummary, isKnownGenre } from './model';

/** The same book from two places becomes one record that keeps the best of both. `a` wins on identity (id, title, author). */
export function mergeBooks(a: Book, b: Book): Book {
  const out: Book = { ...a };
  if (!out.coverId && !out.coverUrl) {
    if (b.coverId) out.coverId = b.coverId;
    else if (b.coverUrl) out.coverUrl = b.coverUrl;
  }
  if (!out.pageCount && b.pageCount) { out.pageCount = b.pageCount; out.difficulty = b.difficulty; }
  if (!out.year && b.year) out.year = b.year;
  // keep whichever rating rests on clearly more readers
  if ((!out.ratingAverage && b.ratingAverage) || (b.ratingAverage && (b.ratingCount || 0) > (out.ratingCount || 0) * 1.5)) {
    out.ratingAverage = b.ratingAverage;
    out.ratingCount = b.ratingCount;
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
