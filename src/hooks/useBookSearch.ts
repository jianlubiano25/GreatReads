import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Book } from '../types';
import { fillMissingCovers, searchBooksLive, searchLocal, type SearchScope } from '../services/books';

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
  /** How many books the catalog says match in all (0 until a source has said); results holds the best of them loaded so far */
  total: number;
  /** More matches exist beyond what is loaded */
  hasMore: boolean;
  loadingMore: boolean;
  /** Ask the sources for their next batch; resolves when it is added to `results` */
  loadMore: () => Promise<void>;
}

/**
 * Live book search: as the reader types, books already on the device appear in the same frame, then the merged list improves as each source answers.
 * A newer keystroke cancels the older request, so a slow old answer can never replace the results of what was typed last.
 * Covers the search did not return are filled in quietly after the list is on screen.
 */
export function useBookSearch(query: string, opts: { author?: string; limit?: number; enabled?: boolean; known?: readonly Book[]; scope?: SearchScope } = {}): BookSearchState {
  const { author = '', limit = 10, enabled = true, known, scope = 'all' } = opts;
  const [first, setResults] = useState<Book[]>([]);
  const [more, setMore] = useState<Book[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const page = useRef(1);
  const inFlight = useRef(false);
  const latest = useRef<Book[]>([]);
  const moreRef = useRef<Book[]>([]);
  const gen = useRef(0); // bumped by every new search: an answer for an older one is dropped
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [nudge, setNudge] = useState(0);
  const forced = useRef(false);

  const searchNow = useCallback(() => { forced.current = true; setNudge(n => n + 1); }, []);

  useEffect(() => {
    const q = query.trim();
    gen.current++; page.current = 1; inFlight.current = false;
    moreRef.current = []; setMore([]); setExhausted(false); setLoadingMore(false);
    if (!enabled || (!q && !author.trim())) {
      setResults([]); setLoading(false); setStale(false); setEmpty(false); setTotal(0);
      return;
    }
    const final = forced.current;
    forced.current = false;
    const controller = new AbortController();
    const live = (books: Book[]) => { if (!controller.signal.aborted) { setResults(books); latest.current = books; setStale(false); setEmpty(false); } };

    // Instant: books already on this device. With none, the old list stays (dimmed) until the first answer.
    const instant = searchLocal(query, author, limit, known, scope);
    if (instant.length) live(instant);
    else setStale(true);
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const finalList = await searchBooksLive(query, {
          author,
          scope,
          limit,
          final,
          known,
          signal: controller.signal,
          onUpdate: (books, p) => {
            if (!controller.signal.aborted && p.total) setTotal(p.total);
            if (books.length) live(books);
            if (p.done) setLoading(false);
          },
        });
        if (controller.signal.aborted) return;
        setLoading(false);
        setStale(false);
        setEmpty(finalList.length === 0);
        if (finalList.length === 0) { setResults([]); latest.current = []; }
        else fillMissingCovers(finalList, r => { if (!controller.signal.aborted) { setResults(r); latest.current = r; } }, controller.signal);
      } catch {
        if (!controller.signal.aborted) { setLoading(false); setStale(false); setEmpty(true); }
      }
    }, final ? 0 : TYPING_DELAY_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, author, limit, enabled, nudge, known, scope]);

  const results = useMemo(() => (more.length ? [...first, ...more] : first), [first, more]);
  const loaded = results.length;
  const hasMore = !exhausted && !loading && loaded > 0 && total > loaded;

  const loadMore = useCallback(async () => {
    if (inFlight.current || !enabled) return;
    inFlight.current = true;
    setLoadingMore(true);
    const g = gen.current;
    const next = page.current + 1;
    try {
      const got = await searchBooksLive(query, { author, scope, limit, page: next, final: true, known, local: false, exclude: [...latest.current, ...moreRef.current] });
      if (g !== gen.current) return; // a newer search started while this was in flight: the answer belongs to the old query
      page.current = next;
      if (got.length) { moreRef.current = [...moreRef.current, ...got]; setMore(moreRef.current); } else setExhausted(true);
    } finally {
      if (g === gen.current) { inFlight.current = false; setLoadingMore(false); }
    }
  }, [query, author, scope, limit, enabled, known]);

  return { results, loading, stale, empty, searchNow, total, hasMore, loadingMore, loadMore };
}
