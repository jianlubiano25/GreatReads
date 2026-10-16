import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Book } from '../types';
import { fillMissingCovers, getCoverPick, resolveCover, searchBooksLive, searchLocal, type SearchScope } from '../services/books';

/** Wait this long after the last keystroke before asking the network (books already on the device are shown with no wait at all). */
const TYPING_DELAY_MS = 150;
/** One or two letters match half the catalog: while typing, the network is asked from this many characters on (Enter always asks). */
const MIN_NETWORK_CHARS = 3;
/** The books on the first screen: their covers are looked up as soon as the first source answers, not after the last one. */
const EARLY_COVERS = 12;

/**
 * A book with a cover you picked / published (getCoverPick) counts as having a cover: the "With cover" filter keeps it and no lookup is spent on it.
 * The card itself already draws the pick (CoverFace); this only fills the gap for results whose source returned no cover of its own.
 */
const withPicks = (books: Book[]): Book[] => {
  let changed = false;
  const out = books.map(b => {
    if (b.coverId || b.coverUrl || !b.title) return b;
    const url = getCoverPick(b, 'M');
    if (!url) return b;
    changed = true;
    return { ...b, coverUrl: url };
  });
  return changed ? out : books;
};

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
    const live = (raw: Book[]) => { const books = withPicks(raw); if (!controller.signal.aborted) { setResults(books); latest.current = books; setStale(false); setEmpty(false); } };

    // Instant: books already on this device. With none, the old list stays (dimmed) until the first answer.
    const instant = searchLocal(query, author, limit, known, scope);
    const tooShort = !final && !author.trim() && q.length < MIN_NETWORK_CHARS;
    if (instant.length) live(instant);
    else if (tooShort) { setResults([]); latest.current = []; setStale(false); setEmpty(false); }
    else setStale(true);
    if (tooShort) { setLoading(false); return () => controller.abort(); } // a letter or two: the device answers, the network waits for a third letter or Enter
    setLoading(true);
    let earlyCovers = false;

    const timer = setTimeout(async () => {
      try {
        const finalRaw = await searchBooksLive(query, {
          author,
          scope,
          limit,
          final,
          known,
          signal: controller.signal,
          onUpdate: (books, p) => {
            if (!controller.signal.aborted && p.total) setTotal(p.total);
            if (books.length) live(books);
            if (!earlyCovers && books.length && !controller.signal.aborted) { // covers for the first screen start now; the lookups are shared and remembered, so the list is not held up
              earlyCovers = true;
              withPicks(books.slice(0, EARLY_COVERS)).filter(b => b.title && !b.coverId && !b.coverUrl).forEach(b => { void resolveCover(b); });
            }
            if (p.done) setLoading(false);
          },
        });
        if (controller.signal.aborted) return;
        const finalList = withPicks(finalRaw);
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
      if (got.length) { moreRef.current = [...moreRef.current, ...withPicks(got)]; setMore(moreRef.current); } else setExhausted(true);
    } finally {
      if (g === gen.current) { inFlight.current = false; setLoadingMore(false); }
    }
  }, [query, author, scope, limit, enabled, known]);

  return { results, loading, stale, empty, searchNow, total, hasMore, loadingMore, loadMore };
}
