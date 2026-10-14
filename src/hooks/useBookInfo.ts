import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Book } from '../types';
import { applyInfo, ensureBookInfo, getInfo, infoKey, infoVersion, isLoadingInfo, siteRatingsOf, subscribeInfo, type InfoField } from '../services/books/infoStore';
import { missingFields } from '../services/books/infoStore';
import type { SourceRating } from '../services/books/ratings';

/**
 * Book Info's data for one book. Everything saved is there on the FIRST render (no network, no loading state); what is missing is fetched
 * in the background (joining any lookup already running for this book), and each field appears as it is found.
 * `loading` is true only for a part that is still being fetched AND has nothing to show yet.
 */
export function useBookInfo(book: Book): { book: Book; siteRatings: SourceRating[]; loading: { ratings: boolean; text: boolean; facts: boolean } } {
  const key = infoKey(book);
  // The snapshot is the book's change counter: it moves when something is found, fails, starts or finishes
  const subscribe = useCallback((fn: () => void) => subscribeInfo(book, fn), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useSyncExternalStore(subscribe, () => infoVersion(book), () => 0);
  const entry = getInfo(book);
  const shown = useMemo(() => applyInfo(book, entry), [book, entry]);
  const siteRatings = useMemo(() => siteRatingsOf(entry), [entry]);

  useEffect(() => { void ensureBookInfo(book); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const due = missingFields(shown, entry);
  const has = (f: InfoField) => due.includes(f);
  const lookupOn = isLoadingInfo(book, 'lookup');
  const textOn = isLoadingInfo(book, 'text');
  return {
    book: shown,
    siteRatings,
    loading: {
      ratings: lookupOn && !siteRatings.length && (has('rating:openlibrary') || has('rating:google') || has('rating:apple')),
      text: textOn && (has('summary') || has('authorBio')),
      facts: lookupOn && (has('year') || has('pageCount')),
    },
  };
}
