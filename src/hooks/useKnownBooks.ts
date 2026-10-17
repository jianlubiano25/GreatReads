import { useMemo } from 'react';
import type { Book } from '../types';

/**
 * Discover and Search compare their books with yours only to share ratings. A new array for every reading-progress change would redraw every
 * shelf (and rebuild the rating index), so the returned array changes only when something a rating match depends on does.
 */
export function useKnownBooks(allBooks: Book[]): Book[] {
  const sig = allBooks.map(b => `${b.id}|${b.title}|${b.ratingAverage ?? ''}|${b.ratingCount ?? ''}|${b.ratingSource ?? ''}|${b.identity?.olWork ?? ''}|${b.identity?.isbn13 ?? ''}`).join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => allBooks, [sig]);
}
