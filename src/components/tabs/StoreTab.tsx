import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Award, ArrowLeft, SlidersHorizontal, Loader2 } from 'lucide-react';
import type { Book } from '../../types';
import { BOOK_AWARDS } from '../../data/defaultBooks';
import { useBookSearch } from '../../hooks/useBookSearch';
import { lockBodyScroll } from '../../hooks/bodyScrollLock';
import { DEFAULT_SHELF_ORDER, SHELF_BY_ID, hiddenShelfIds } from '../../services/store/registry';
import { loadStorePrefs, NO_PREFS, orderShelves, saveStorePrefs, toggleShelf, type StorePrefs } from '../../services/store/prefs';
import { milestone } from '../../services/books/perf';
import { activeFilterCount, applySearchView, DEFAULT_SEARCH_VIEW, genreOptions, getCoverUrl, isDefaultView, SEARCH_PUBLISHED_LABEL, SEARCH_SORT_LABEL, type SearchScope, type SearchSort, type SearchView } from '../../services/books';
import { ClearButton } from '../ClearButton';
import { ViewMoreBar } from '../ViewMoreBar';
import { CoverFace } from '../BookMeta';
import { StoreShelf } from '../StoreShelf';
import { StoreCustomize } from '../StoreCustomize';
import { TabPane } from './TabPane';

interface Props {
  active: boolean;
  /** Every book in the library: the "prize winners" and "easy to start" shelves are built from it */
  allBooks: Book[];
  /** Customize Store is toggled from the page header and footer, so App owns this flag */
  customizing: boolean;
  setCustomizing: (on: boolean) => void;
  handleOpenCover: (book: Book) => void;
  onAddBook: () => void;
}

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

const PRIZE_TITLE = (
  <>
    <Award className="w-5 h-5 text-amber-500" />
    <span>Prize winners from your lists</span>
  </>
);

/** The Store tab: search, the shelves in the reader's own order, and Customize Store. */
export function StoreTab({ active, allBooks, customizing, setCustomizing, handleOpenCover, onAddBook }: Props) {
  // Store layout: the reader's own shelf order and hidden shelves (prefs only; shelf data is never touched, see services/store/prefs.ts)
  const [storePrefs, setStorePrefs] = useState<StorePrefs>(loadStorePrefs);
  const shelfOrder = useMemo(() => orderShelves(DEFAULT_SHELF_ORDER, storePrefs.order), [storePrefs.order]);
  const hiddenShelves = useMemo(() => hiddenShelfIds(storePrefs), [storePrefs]);
  const updateStorePrefs = useCallback((next: StorePrefs) => { setStorePrefs(next); saveStorePrefs(next); }, []);
  const reorderShelves = useCallback((order: string[]) => updateStorePrefs({ ...storePrefs, order }), [storePrefs, updateStorePrefs]);

  useEffect(() => { milestone('store-mounted'); }, []); // measurement only

  // Store search: books already on the device show with each keystroke, then the list improves as each source answers (hooks/useBookSearch.ts)
  const [storeSearchQuery, setStoreSearchQuery] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const [visibleCount, setVisibleCount] = useState(SEARCH_STEP);
  const [view, setView] = useState<SearchView>(DEFAULT_SEARCH_VIEW);
  const [scope, setScope] = useState<SearchScope>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const searching = !!storeSearchQuery.trim();
  // Tapping the box shows the scope buttons before anything is typed. They stay while focus is in the search block; a short delay on leaving lets a tap on
  // one of them land (a phone blurs the box the moment a button is touched) and tapping a button cancels the hide.
  const [barOpen, setBarOpen] = useState(false);
  const barTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openBar = useCallback(() => { clearTimeout(barTimer.current); setBarOpen(true); }, []);
  const closeBarSoon = useCallback(() => { clearTimeout(barTimer.current); barTimer.current = setTimeout(() => setBarOpen(false), 250); }, []);
  useEffect(() => () => clearTimeout(barTimer.current), []);
  const showBar = searching || barOpen;
  // A new query (or scope) starts from the first rows, and a genre picked for the old results may not exist in the new ones
  useEffect(() => { setVisibleCount(SEARCH_STEP); setView(v => (v.genre ? { ...v, genre: '' } : v)); }, [storeSearchQuery, scope]);
  const clearSearch = useCallback(() => { setStoreSearchQuery(''); setFilterOpen(false); setBarOpen(false); }, []);
  // Results take over the whole screen: the page behind must not scroll with them
  useEffect(() => {
    if (!searching || !active) return; // another tab hides this one: the page must scroll again there
    return lockBodyScroll(); // shared with the modals: a book's details opened over the results can be closed before or after the search, either order
  }, [searching, active]);

  // The shelves compare their books with yours only to share ratings. A new array for every reading-progress change would redraw every
  // shelf (and rebuild the rating index), so `known` changes only when something a rating match depends on does.
  const knownSig = allBooks.map(b => `${b.id}|${b.title}|${b.ratingAverage ?? ''}|${b.ratingCount ?? ''}|${b.ratingSource ?? ''}|${b.identity?.olWork ?? ''}|${b.identity?.isbn13 ?? ''}`).join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const known = useMemo(() => allBooks, [knownSig]);
  const { results: storeSearchResults, loading: isStoreSearching, stale: storeSearchStale, empty: storeSearchEmpty, searchNow: searchStoreNow, total: storeSearchTotal, hasMore: storeSearchHasMore, loadingMore: storeSearchLoadingMore, loadMore: loadMoreStoreSearch } = useBookSearch(storeSearchQuery, { known, limit: SEARCH_LIMIT, scope });
  const genres = useMemo(() => genreOptions(storeSearchResults), [storeSearchResults]);
  const shownResults = useMemo(() => applySearchView(storeSearchResults, view), [storeSearchResults, view]);
  const filtersOn = !isDefaultView(view);
  // Covers are drawn at once (not lazily) and the next batch is fetched into the browser's cache before "View more" is tapped
  const coverSize = typeof window !== 'undefined' && window.innerWidth >= 768 ? 'L' : 'M';
  useEffect(() => {
    if (!searching) return;
    for (const b of shownResults.slice(visibleCount, visibleCount + SEARCH_STEP)) {
      const url = getCoverUrl(b.coverId, coverSize, b.coverUrl);
      if (url) new Image().src = url;
    }
  }, [searching, shownResults, visibleCount, coverSize]);

  // Store shelves built from your own catalog
  const prizeBooks = useMemo(
    () => allBooks.filter(b => typeof b.id === 'number' && (BOOK_AWARDS[b.id] || []).length > 0),
    [allBooks],
  );
  const easyBooks = useMemo(() => allBooks.filter(b => b.difficulty === 1), [allBooks]);

  return (
    <TabPane active={active}>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-serif-display text-2xl sm:text-3xl text-[#201a15] dark:text-[#f0e6d6]">
              Book Store
            </h2>
            <p className="text-xs sm:text-sm text-[#706256] dark:text-[#a89a8a]">
              Browse popular works, prize winners, and discover new books. Tap any cover to see author, year &amp; page details.
            </p>
          </div>

          <button
            onClick={() => onAddBook()}
            className="flex px-4 py-2 rounded-xl text-xs font-semibold bg-[#2e5934] text-white hover:bg-[#244729] items-center gap-1.5 shadow-sm shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Book</span>
          </button>
        </div>

        {customizing ? (
          <StoreCustomize
            order={shelfOrder}
            hidden={hiddenShelves}
            onReorder={reorderShelves}
            onToggle={id => updateStorePrefs(toggleShelf(storePrefs, id, !!SHELF_BY_ID[id]?.defaultHidden))}
            onDone={() => { updateStorePrefs({ ...storePrefs, order: shelfOrder }); setCustomizing(false); }}
            onResetLayout={() => updateStorePrefs(NO_PREFS)}
          />
        ) : (
          <>
          {/* Search: the box, the Title / Author selector and the filter icon. While a query is typed this whole block fills the screen (same elements, so the keyboard stays up). */}
          <div
            className={searching ? 'fixed inset-0 z-[55] overflow-y-auto overscroll-contain bg-[#f5f0e6] dark:bg-[#181410]' : 'flex flex-col gap-2'}
            // The filter panel sits in the sticky header and would cover the results as they scroll under it: scrolling the list closes it
            onScroll={searching && filterOpen ? e => { if (e.currentTarget.scrollTop > 8) setFilterOpen(false); } : undefined}
          >
            <div onFocus={openBar} onBlur={closeBarSoon} className={searching ? 'sticky top-0 z-30 bg-[#f5f0e6] dark:bg-[#181410] px-3 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2 flex flex-col gap-2 border-b border-[#e3d7c3] dark:border-[#382f25]' : 'flex flex-col gap-2'}>
              <div className="flex items-center gap-2">
                {searching && (
                  <button type="button" aria-label="Back to the Store" onClick={clearSearch} className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-[#2e5934] dark:text-[#9ed0a6] hover:bg-[#e3d7c3]/60 dark:hover:bg-[#382f25]">
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                )}
                <div className="relative flex-1 min-w-0">
                  <Search className="w-4 h-4 text-[#706256] dark:text-[#a89a8a] absolute left-3.5 top-3.5 pointer-events-none" />
                  <input
                    ref={searchInput}
                    type="search"
                    value={storeSearchQuery}
                    onChange={e => setStoreSearchQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { setFilterOpen(false); searchStoreNow(); } else if (e.key === 'Escape') { if (filterOpen) setFilterOpen(false); else { clearSearch(); searchInput.current?.blur(); } } }}
                    placeholder={SEARCH_PLACEHOLDER}
                    className="rl-search w-full pl-10 pr-10 py-3 rounded-xl bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] text-sm focus:outline-none focus:ring-2 focus:ring-[#2e5934]"
                  />
                  <ClearButton show={!!storeSearchQuery} onClear={() => { setStoreSearchQuery(''); searchInput.current?.focus(); }} />
                </div>
              </div>

              {/* The scope buttons and the filter icon appear once the box is tapped (or something is typed), centered under it */}
              {showBar && (
                <div className="flex items-center justify-center gap-2" onPointerDown={openBar}>
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
                <span className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a]">
                  {storeSearchResults.length
                    ? `${filtersOn ? `${shownResults.length} of ${storeSearchResults.length} loaded match your filters` : `Results 1–${Math.min(visibleCount, shownResults.length)} of ${Math.max(storeSearchTotal, storeSearchResults.length)}`}${isStoreSearching ? ' · searching…' : ''}`
                    : isStoreSearching ? 'Searching…' : 'Results 0'}
                </span>

                {storeSearchResults.length === 0 && storeSearchEmpty ? (
                  <div className="p-8 text-center text-sm text-[#706256] dark:text-[#a89a8a] bg-[#fbf7ee] dark:bg-[#231d17] rounded-xl border border-[#e3d7c3] dark:border-[#382f25]">
                    No books found{scope === 'all' ? '' : ` by ${scope}`}. Check the spelling, try All, or use the Add Book button to add manually.
                  </div>
                ) : storeSearchResults.length > 0 && shownResults.length === 0 ? (
                  <div className="p-6 text-center text-sm text-[#706256] dark:text-[#a89a8a] bg-[#fbf7ee] dark:bg-[#231d17] rounded-xl border border-[#e3d7c3] dark:border-[#382f25]">
                    No results match these filters.{' '}
                    <button type="button" onClick={() => setView(DEFAULT_SEARCH_VIEW)} className="font-semibold text-[#2e5934] dark:text-[#9ed0a6] underline">Reset filters</button>
                  </div>
                ) : (
                  <>
                    <div className={`grid grid-cols-3 gap-3 sm:gap-4 transition-opacity ${storeSearchStale ? 'opacity-50' : ''}`}>
                      {shownResults.slice(0, visibleCount).map(b => (
                        <div key={b.id} className="flex flex-col gap-1.5 min-w-0">
                          <button
                            type="button"
                            onClick={() => handleOpenCover(b)}
                            className="book-cover-3d w-full aspect-[2/3] rounded-md text-left p-2 flex flex-col justify-between text-white overflow-hidden"
                            style={{ backgroundColor: b.spineColor || '#2e5934' }}
                          >
                            <CoverFace book={b} size="md" imgSize={coverSize} eager />
                          </button>
                          <h4
                            onClick={() => handleOpenCover(b)}
                            className="font-serif-display text-xs sm:text-sm leading-tight text-[#201a15] dark:text-[#f0e6d6] line-clamp-2 hover:underline cursor-pointer"
                          >
                            {b.title}
                          </h4>
                          <div className="text-[11px] sm:text-xs text-[#706256] dark:text-[#a89a8a] truncate">{b.author}</div>
                          <button
                            onClick={() => handleOpenCover(b)}
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
                      outOf={filtersOn ? undefined : storeSearchTotal}
                      step={SEARCH_STEP}
                      onMore={() => setVisibleCount(n => n + SEARCH_STEP)}
                      onAll={() => setVisibleCount(shownResults.length)}
                      onLess={() => setVisibleCount(SEARCH_STEP)}
                    />
                    {storeSearchHasMore && visibleCount >= shownResults.length && (
                      <button
                        type="button"
                        disabled={storeSearchLoadingMore}
                        onClick={async () => { await loadMoreStoreSearch(); setVisibleCount(n => n + SEARCH_STEP); }}
                        className="self-center px-4 py-2 rounded-xl text-xs font-semibold bg-[#2e5934] text-white hover:bg-[#244729] disabled:opacity-60 flex items-center gap-2"
                      >
                        {storeSearchLoadingMore ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Loading…</span></> : <span>Load more results</span>}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Shelves, in the reader's own order (Customize Store). Hidden shelves are not drawn, so they also load nothing. */}
          {shelfOrder.filter(id => !hiddenShelves.includes(id)).map((id, position) => {
            const def = SHELF_BY_ID[id];
            const priority = position < 2; // the first two shelves load their covers at once; the rest as they come near the screen
            if (def.library) {
              const books = def.library === 'prize' ? prizeBooks : easyBooks;
              const title = def.library === 'prize' ? PRIZE_TITLE : def.title;
              return <StoreShelf key={id} id={id} title={title} books={books} known={known} priority={priority} onOpen={handleOpenCover} />;
            }
            return <StoreShelf key={id} id={id} title={def.title} source={def.source} ranked={def.ranked} lazy={def.lazy} hideIfUnavailable={def.hideIfUnavailable} known={known} priority={priority} onOpen={handleOpenCover} />;
          })}
          <p className="text-xs text-[#706256] dark:text-[#a89a8a]">Bestsellers from The New York Times. Covers and ratings from Open Library, Google Books and Apple Books readers.</p>
          </>
        )}
      </div>
    </TabPane>
  );
}
