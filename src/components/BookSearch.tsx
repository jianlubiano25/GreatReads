import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, ArrowLeft, SlidersHorizontal, Loader2 } from 'lucide-react';
import type { Book } from '../types';
import { useBookSearch } from '../hooks/useBookSearch';
import { lockBodyScroll } from '../hooks/bodyScrollLock';
import { activeFilterCount, applySearchView, DEFAULT_SEARCH_VIEW, genreOptions, getCoverPick, ownCoverUrl, isDefaultView, SEARCH_PUBLISHED_LABEL, SEARCH_SORT_LABEL, type SearchScope, type SearchSort, type SearchView } from '../services/books';
import { sameWork } from '../services/books/identity';
import { didYouMean, suggestionVocab } from '../services/books/suggest';
import { SEARCH_KIND_LABEL, SEARCH_LENGTH_LABEL } from '../services/books/searchView';
import { ClearButton } from './ClearButton';
import { ViewMoreBar } from './ViewMoreBar';
import { CoverFace } from './BookMeta';

/** Search shows 20 results (rows of three) at first; "View more" adds 20 more, "View all" shows everything loaded, "Load more results" asks the catalog for its next batch. */
const SEARCH_STEP = 20;
/** How many results one search asks for (the list is ranked, then cut to this) */
const SEARCH_LIMIT = 100;

const SCOPES: { id: SearchScope; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'title', label: 'Title' },
  { id: 'author', label: 'Author' },
  { id: 'keywords', label: 'Keywords' },
];
/** An ISBN is found from any scope, and Keywords take topics and moods ("cozy", "dragons"), so the box says all of it whichever button is on */
const SEARCH_PLACEHOLDER = 'Title, Author, ISBN, or Keywords';

interface Props {
  /** The tab this sits in is the one on screen (another tab hides it, and then the page must scroll again) */
  active: boolean;
  /** Your books, so a result you own shows your rating */
  known: Book[];
  /** What is typed and which button (All / Title / Author / Keywords) is on: kept by the tab, so it can also fill the box (a tapped genre) */
  query: string;
  setQuery: (q: string) => void;
  scope: SearchScope;
  setScope: (s: SearchScope) => void;
  handleOpenCover: (book: Book) => void;
  /** Spoken name of the arrow that leaves the results ("Back to the Store") */
  backLabel: string;
  /** Shown at the top of the results (a genre's page puts its sub-genres and hand-picked books here) */
  aboveResults?: React.ReactNode;
  /** A search the reader used (Enter pressed, or a result opened): the tab keeps it for its list of recent searches */
  recordSearch?: (q: string) => void;
}

/**
 * The book search used by Discover and by the Search tab: the box, the All / Title / Author / Keywords buttons, the filter icon and, once something is typed, the results
 * over the whole screen. Books already on the device show with each keystroke, then the list improves as each source answers (hooks/useBookSearch.ts).
 */
export function BookSearch({ active, known, query, setQuery, scope, setScope, handleOpenCover, backLabel, aboveResults, recordSearch }: Props) {
  const searchInput = useRef<HTMLInputElement>(null);
  const [visibleCount, setVisibleCount] = useState(SEARCH_STEP);
  const [view, setView] = useState<SearchView>(DEFAULT_SEARCH_VIEW);
  const [filterOpen, setFilterOpen] = useState(false);
  const searching = !!query.trim();
  // Focusing the box shows the scope buttons and the filter icon. Tapping anywhere OUTSIDE the search header closes them AND the filter panel; the query and the
  // chosen filters are kept, so tapping the box again brings the buttons back with the filter icon still lit (and counted) when a filter is applied.
  // The buttons open from the box's FOCUS, never from the pointer-down of the tap: on iPhone / iPad, changing the page in the middle of a tap makes Safari drop the
  // tap's own focus, which is why the box needed two taps before the keyboard came up.
  const [barOpen, setBarOpen] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const openBar = useCallback(() => setBarOpen(true), []);
  const showBar = barOpen;
  useEffect(() => {
    if (!barOpen && !filterOpen) return;
    const onDown = (e: PointerEvent) => {
      if (headerRef.current?.contains(e.target as Node)) return;
      setFilterOpen(false);
      setBarOpen(false);
      searchInput.current?.blur(); // the next tap on the box then really re-focuses it (and re-opens the buttons)
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [barOpen, filterOpen]);
  // A new query (or scope) starts from the first rows, and a genre picked for the old results may not exist in the new ones
  useEffect(() => { setVisibleCount(SEARCH_STEP); setView(v => (v.genre ? { ...v, genre: '' } : v)); }, [query, scope]);
  const clearSearch = useCallback(() => { setQuery(''); setFilterOpen(false); setBarOpen(false); }, [setQuery]);
  // Results take over the whole screen: the page behind must not scroll with them
  useEffect(() => {
    if (!searching || !active) return; // another tab hides this one: the page must scroll again there
    return lockBodyScroll(); // shared with the modals: a book's details opened over the results can be closed before or after the search, either order
  }, [searching, active]);

  const { results: searchResults, loading: isSearching, stale: searchStale, empty: searchEmpty, searchNow, total: searchTotal, hasMore: searchHasMore, loadingMore: searchLoadingMore, loadMore: loadMoreResults } = useBookSearch(query, { known, limit: SEARCH_LIMIT, scope });
  const genres = useMemo(() => genreOptions(searchResults), [searchResults]);
  const shownResults = useMemo(() => applySearchView(searchResults, view), [searchResults, view]);
  const filtersOn = !isDefaultView(view);
  // "Did you mean": only once the search has finished with next to nothing, and only from words we know (genres, hand-picked books, your own books)
  const suggestion = useMemo(() => (searching && !isSearching && searchResults.length < 3 ? didYouMean(query, suggestionVocab(known)) : null), [searching, isSearching, searchResults.length, query, known]);
  // Results you already own are marked, so you do not add a book twice
  const owned = useMemo(() => {
    const own = new Set<string | number>();
    if (!searching) return own;
    for (const b of shownResults.slice(0, visibleCount)) if (known.some(k => k === b || sameWork(k, b))) own.add(b.id);
    return own;
  }, [searching, shownResults, visibleCount, known]);
  const openResult = useCallback((b: Book) => { recordSearch?.(query); handleOpenCover(b); }, [recordSearch, query, handleOpenCover]);
  // Covers are drawn at once (not lazily) and the next batch is fetched into the browser's cache before "View more" is tapped
  const coverSize = typeof window !== 'undefined' && window.innerWidth >= 768 ? 'L' : 'M';
  useEffect(() => {
    if (!searching) return;
    for (const b of shownResults.slice(visibleCount, visibleCount + SEARCH_STEP)) {
      const url = getCoverPick(b, coverSize) || ownCoverUrl(b, coverSize);
      if (url) new Image().src = url;
    }
  }, [searching, shownResults, visibleCount, coverSize]);

  return (
    // Search: the box, the Title / Author selector and the filter icon. While a query is typed this whole block fills the screen (same elements, so the keyboard stays up).
    <div
      className={searching ? 'fixed inset-0 z-[45] overflow-y-auto overscroll-contain bg-[#f5f0e6] dark:bg-[#181410]' : 'flex flex-col gap-2'}
      // The filter panel sits in the sticky header and would cover the results as they scroll under it: scrolling the list closes it
      onScroll={searching && filterOpen ? e => { if (e.currentTarget.scrollTop > 8) setFilterOpen(false); } : undefined}
    >
      <div ref={headerRef} onFocus={openBar} className={searching ? 'sticky top-0 z-30 bg-[#f5f0e6] dark:bg-[#181410] px-3 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2 flex flex-col gap-2 border-b border-[#e3d7c3] dark:border-[#382f25]' : 'flex flex-col gap-2'}>
        <div className="flex items-center gap-2">
          {searching && (
            <button type="button" aria-label={backLabel} onClick={clearSearch} className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-[#2e5934] dark:text-[#9ed0a6] hover:bg-[#e3d7c3]/60 dark:hover:bg-[#382f25]">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-[#706256] dark:text-[#a89a8a] absolute left-3.5 top-3.5 pointer-events-none" />
            <input
              ref={searchInput}
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setFilterOpen(false); searchNow(); recordSearch?.(query); } else if (e.key === 'Escape') { if (filterOpen) setFilterOpen(false); else { clearSearch(); searchInput.current?.blur(); } } }}
              placeholder={SEARCH_PLACEHOLDER}
              className="rl-search w-full pl-10 pr-10 py-3 rounded-xl bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] text-sm focus:outline-none focus:ring-2 focus:ring-[#2e5934]"
            />
            <ClearButton show={!!query} onClear={() => { setQuery(''); searchInput.current?.focus(); }} />
          </div>
        </div>

        {/* The scope buttons and the filter icon appear once the box is tapped (or something is typed), centered under it */}
        {showBar && (
          <div className="flex items-center justify-center gap-2">
            <div role="tablist" aria-label="Search in" className="flex rounded-xl overflow-hidden border border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17]">
              {SCOPES.map(sc => (
                <button
                  key={sc.id}
                  type="button"
                  role="tab"
                  aria-selected={scope === sc.id}
                  onClick={() => { setScope(sc.id); searchInput.current?.focus(); }}
                  className={`px-3 py-2 text-xs font-semibold transition-colors ${scope === sc.id ? 'bg-[#2e5934] text-white' : 'text-[#706256] dark:text-[#a89a8a] hover:bg-[#e3d7c3]/50 dark:hover:bg-[#382f25]'}`}
                >
                  {sc.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label="Filters and sorting"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen(o => !o)}
              className={`relative w-10 h-9 shrink-0 rounded-xl border flex items-center justify-center transition-colors ${filterOpen || filtersOn ? 'bg-[#2e5934] text-white border-[#2e5934]' : 'bg-[#fbf7ee] dark:bg-[#231d17] border-[#e3d7c3] dark:border-[#382f25] text-[#2e5934] dark:text-[#9ed0a6]'}`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              {filtersOn && <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">{activeFilterCount(view)}</span>}
            </button>
          </div>
        )}

        {filterOpen && (
          <div className="rounded-xl border border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17] p-3 flex flex-col gap-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 font-semibold text-[#706256] dark:text-[#a89a8a]">
                Sort by
                <select
                  value={view.sort}
                  onChange={e => { setView({ ...view, sort: e.target.value as SearchSort }); setVisibleCount(SEARCH_STEP); }}
                  className="px-2.5 py-2 rounded-lg bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-[#201a15] dark:text-[#f0e6d6] font-normal"
                >
                  {(Object.keys(SEARCH_SORT_LABEL) as SearchSort[]).map(k => <option key={k} value={k}>{SEARCH_SORT_LABEL[k]}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 font-semibold text-[#706256] dark:text-[#a89a8a]">
                Published
                <select
                  value={view.years}
                  onChange={e => { setView({ ...view, years: Number(e.target.value) }); setVisibleCount(SEARCH_STEP); }}
                  className="px-2.5 py-2 rounded-lg bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-[#201a15] dark:text-[#f0e6d6] font-normal"
                >
                  {Object.entries(SEARCH_PUBLISHED_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 font-semibold text-[#706256] dark:text-[#a89a8a]">
                Type
                <select
                  value={view.kind}
                  onChange={e => { setView({ ...view, kind: e.target.value as SearchView['kind'] }); setVisibleCount(SEARCH_STEP); }}
                  className="px-2.5 py-2 rounded-lg bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-[#201a15] dark:text-[#f0e6d6] font-normal"
                >
                  {Object.entries(SEARCH_KIND_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 font-semibold text-[#706256] dark:text-[#a89a8a]">
                Length
                <select
                  value={view.length}
                  onChange={e => { setView({ ...view, length: e.target.value as SearchView['length'] }); setVisibleCount(SEARCH_STEP); }}
                  className="px-2.5 py-2 rounded-lg bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-[#201a15] dark:text-[#f0e6d6] font-normal"
                >
                  {Object.entries(SEARCH_LENGTH_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </label>
              {genres.length > 1 && (
                <label className="flex flex-col gap-1 font-semibold text-[#706256] dark:text-[#a89a8a] col-span-2">
                  Genre
                  <select
                    value={view.genre}
                    onChange={e => { setView({ ...view, genre: e.target.value }); setVisibleCount(SEARCH_STEP); }}
                    className="px-2.5 py-2 rounded-lg bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-[#201a15] dark:text-[#f0e6d6] font-normal"
                  >
                    <option value="">All genres</option>
                    {genres.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {([['coverOnly', 'With cover'], ['ratedOnly', 'Rated']] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view[key]}
                  onClick={() => { setView({ ...view, [key]: !view[key] }); setVisibleCount(SEARCH_STEP); }}
                  className={`px-3 py-1.5 rounded-lg border font-semibold ${view[key] ? 'bg-[#2e5934] text-white border-[#2e5934]' : 'bg-[#f5f0e6] dark:bg-[#181410] border-[#e3d7c3] dark:border-[#382f25] text-[#706256] dark:text-[#a89a8a]'}`}
                >
                  {label}
                </button>
              ))}
              <span className="flex-1" />
              {filtersOn && <button type="button" onClick={() => setView(DEFAULT_SEARCH_VIEW)} className="px-2 py-1.5 font-semibold text-[#2e5934] dark:text-[#9ed0a6] underline">Reset</button>}
              <button type="button" onClick={() => setFilterOpen(false)} className="px-3 py-1.5 rounded-lg bg-[#2e5934] text-white font-semibold">Done</button>
            </div>
          </div>
        )}
      </div>

      {/* Search Results if query present */}
      {searching && (
        <div className="px-3 pt-3 pb-28 flex flex-col gap-3">
          {aboveResults}
          {suggestion && (
            <p className="text-sm text-[#706256] dark:text-[#a89a8a]">
              Did you mean{' '}
              <button type="button" onClick={() => setQuery(suggestion)} className="font-semibold text-[#2e5934] dark:text-[#9ed0a6] underline">{suggestion}</button>?
            </p>
          )}
          <span className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a]">
            {searchResults.length
              ? `${filtersOn ? `${shownResults.length} of ${searchResults.length} loaded match your filters` : `Results 1–${Math.min(visibleCount, shownResults.length)} of ${Math.max(searchTotal, searchResults.length)}`}${isSearching ? ' · searching…' : ''}`
              : isSearching ? 'Searching…' : 'Results 0'}
          </span>

          {searchResults.length === 0 && searchEmpty ? (
            <div className="p-8 text-center text-sm text-[#706256] dark:text-[#a89a8a] bg-[#fbf7ee] dark:bg-[#231d17] rounded-xl border border-[#e3d7c3] dark:border-[#382f25]">
              No books found{scope === 'all' ? '' : ` by ${scope}`}. Check the spelling, try All, or use the + button at the top to add it manually.
            </div>
          ) : searchResults.length > 0 && shownResults.length === 0 ? (
            <div className="p-6 text-center text-sm text-[#706256] dark:text-[#a89a8a] bg-[#fbf7ee] dark:bg-[#231d17] rounded-xl border border-[#e3d7c3] dark:border-[#382f25]">
              No results match these filters.{' '}
              <button type="button" onClick={() => setView(DEFAULT_SEARCH_VIEW)} className="font-semibold text-[#2e5934] dark:text-[#9ed0a6] underline">Reset filters</button>
            </div>
          ) : (
            <>
              <div className={`grid grid-cols-3 gap-3 sm:gap-4 transition-opacity ${searchStale ? 'opacity-50' : ''}`}>
                {shownResults.slice(0, visibleCount).map(b => (
                  <div key={b.id} className="flex flex-col gap-1.5 min-w-0">
                    <button
                      type="button"
                      onClick={() => openResult(b)}
                      className="book-cover-3d w-full aspect-[2/3] rounded-md text-left p-2 flex flex-col justify-between text-white overflow-hidden"
                      style={{ backgroundColor: b.spineColor || '#2e5934' }}
                    >
                      <CoverFace book={b} size="md" imgSize={coverSize} eager />
                    </button>
                    <h4
                      onClick={() => openResult(b)}
                      className="font-serif-display text-xs sm:text-sm leading-tight text-[#201a15] dark:text-[#f0e6d6] line-clamp-2 hover:underline cursor-pointer"
                    >
                      {b.title}
                    </h4>
                    <div className="text-[11px] sm:text-xs text-[#706256] dark:text-[#a89a8a] truncate">{b.author}</div>
                    {owned.has(b.id) && <div className="text-[11px] font-semibold text-[#2e5934] dark:text-[#86b880]">✓ In your library</div>}
                    <button
                      onClick={() => openResult(b)}
                      className="mt-0.5 py-1.5 px-2 rounded-lg text-[11px] sm:text-xs font-semibold bg-[#2e5934] text-white hover:bg-[#244729] text-center"
                    >
                      View Details
                    </button>
                  </div>
                ))}
              </div>
              <ViewMoreBar
                shown={visibleCount}
                total={shownResults.length}
                outOf={filtersOn ? undefined : searchTotal}
                step={SEARCH_STEP}
                onMore={() => setVisibleCount(n => n + SEARCH_STEP)}
                onAll={() => setVisibleCount(shownResults.length)}
                onLess={() => setVisibleCount(SEARCH_STEP)}
              />
              {searchHasMore && visibleCount >= shownResults.length && (
                <button
                  type="button"
                  disabled={searchLoadingMore}
                  onClick={async () => { await loadMoreResults(); setVisibleCount(n => n + SEARCH_STEP); }}
                  className="self-center px-4 py-2 rounded-xl text-xs font-semibold bg-[#2e5934] text-white hover:bg-[#244729] disabled:opacity-60 flex items-center gap-2"
                >
                  {searchLoadingMore ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Loading…</span></> : <span>Load more results</span>}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
