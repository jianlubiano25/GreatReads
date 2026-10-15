import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book } from '../types';
import { fillMissingCovers, searchBooksLive, searchLocal } from '../services/books';

/** Wait this long after the last keystroke before asking the network (books already on the device are shown with no wait at all). */
const TYPING_DELAY_MS = 150;

export interface BookSearchState {
  results: Book[];
  /** A source is still answering: the list may still improve */
  loading: boolean;
  /** The list on screen belongs to an earlier query (nothing matches the new one yet); it is dimmed until an answer arrives */
  stale: boolean;
  /** Every source has answered for the current query and nothing matched */
  empty: boolean;
  /** Search now, without the typing delay (Enter / the Find button) */
  searchNow: () => void;
}

/**
 * Live book search: as the reader types, books already on the device appear in the same frame, then the merged list improves as each source answers.
 * A newer keystroke cancels the older request, so a slow old answer can never replace the results of what was typed last.
 * Covers the search did not return are filled in quietly after the list is on screen.
 */
export function useBookSearch(query: string, opts: { author?: string; limit?: number; enabled?: boolean; known?: readonly Book[] } = {}): BookSearchState {
  const { author = '', limit = 10, enabled = true, known } = opts;
  const [results, setResults] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [nudge, setNudge] = useState(0);
  const forced = useRef(false);

  const searchNow = useCallback(() => { forced.current = true; setNudge(n => n + 1); }, []);

  useEffect(() => {
    const q = query.trim();
    if (!enabled || (!q && !author.trim())) {
      setResults([]); setLoading(false); setStale(false); setEmpty(false);
      return;
    }
    const final = forced.current;
    forced.current = false;
    const controller = new AbortController();
    const live = (books: Book[]) => { if (!controller.signal.aborted) { setResults(books); setStale(false); setEmpty(false); } };

    // Instant: books already on this device. With none, the old list stays (dimmed) until the first answer.
    const instant = searchLocal(query, author, limit, known);
    if (instant.length) live(instant);
    else setStale(true);
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const finalList = await searchBooksLive(query, {
          author,
          limit,
          final,
          known,
          signal: controller.signal,
          onUpdate: (books, p) => {
            if (books.length) live(books);
            if (p.done) setLoading(false);
          },
        });
        if (controller.signal.aborted) return;
        setLoading(false);
        setStale(false);
        setEmpty(finalList.length === 0);
        if (finalList.length === 0) setResults([]);
        else fillMissingCovers(finalList, r => { if (!controller.signal.aborted) setResults(r); }, controller.signal);
      } catch {
        if (!controller.signal.aborted) { setLoading(false); setStale(false); setEmpty(true); }
      }
    }, final ? 0 : TYPING_DELAY_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, author, limit, enabled, nudge, known]);

  return { results, loading, stale, empty, searchNow };
}
