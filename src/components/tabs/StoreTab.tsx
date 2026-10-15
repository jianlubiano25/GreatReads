import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Award } from 'lucide-react';
import type { Book } from '../../types';
import { BOOK_AWARDS } from '../../data/defaultBooks';
import { useBookSearch } from '../../hooks/useBookSearch';
import { DEFAULT_SHELF_ORDER, SHELF_BY_ID, hiddenShelfIds } from '../../services/store/registry';
import { loadStorePrefs, NO_PREFS, orderShelves, saveStorePrefs, toggleShelf, type StorePrefs } from '../../services/store/prefs';
import { milestone } from '../../services/books/perf';
import { applySearchView, DEFAULT_SEARCH_VIEW, genreOptions, isDefaultView, SEARCH_SORT_LABEL, type SearchSort, type SearchView } from '../../services/books/searchView';
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

/** Search shows three rows of three at first; "View more" adds three more rows, "View all" shows the lot. */
const SEARCH_STEP = 9;
/** How many results one search asks for (the list is ranked, then cut to this) */
const SEARCH_LIMIT = 36;

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
  // A new query starts from the first rows, and a genre picked for the old results may not exist in the new ones
  useEffect(() => { setVisibleCount(SEARCH_STEP); setView(v => (v.genre ? { ...v, genre: '' } : v)); }, [storeSearchQuery]);

  // The shelves compare their books with yours only to share ratings. A new array for every reading-progress change would redraw every
  // shelf (and rebuild the rating index), so `known` changes only when something a rating match depends on does.
  const knownSig = allBooks.map(b => `${b.id}|${b.title}|${b.ratingAverage ?? ''}|${b.ratingCount ?? ''}|${b.ratingSource ?? ''}|${b.identity?.olWork ?? ''}|${b.identity?.isbn13 ?? ''}`).join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const known = useMemo(() => allBooks, [knownSig]);
  const { results: storeSearchResults, loading: isStoreSearching, stale: storeSearchStale, empty: storeSearchEmpty, searchNow: searchStoreNow } = useBookSearch(storeSearchQuery, { known, limit: SEARCH_LIMIT });
  const genres = useMemo(() => genreOptions(storeSearchResults), [storeSearchResults]);
  const shownResults = useMemo(() => applySearchView(storeSearchResults, view), [storeSearchResults, view]);

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
          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 text-[#706256] dark:text-[#a89a8a] absolute left-3.5 top-3.5 pointer-events-none" />
            <input
              ref={searchInput}
              type="search"
              value={storeSearchQuery}
              onChange={e => setStoreSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') searchStoreNow(); }}
              placeholder="Search by title, author, or keyword in online catalog"
              className="rl-search w-full pl-10 pr-10 py-3 rounded-xl bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] text-sm focus:outline-none focus:ring-2 focus:ring-[#2e5934]"
            />
            <ClearButton show={!!storeSearchQuery} onClear={() => { setStoreSearchQuery(''); searchInput.current?.focus(); }} />
          </div>

          {/* Search Results if query present */}
          {storeSearchQuery.trim() && (
            <div className="flex flex-col gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a]">
                {storeSearchResults.length
                  ? `Search Results (${shownResults.length}${shownResults.length !== storeSearchResults.length ? ` of ${storeSearchResults.length}` : ''})${isStoreSearching ? ' · searching…' : ''}`
                  : isStoreSearching ? 'Searching…' : 'Search Results (0)'}
              </span>

              {storeSearchResults.length > 1 && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <select
                    aria-label="Sort results"
                    value={view.sort}
                    onChange={e => { setView({ ...view, sort: e.target.value as SearchSort }); setVisibleCount(SEARCH_STEP); }}
                    className="px-2.5 py-1.5 rounded-lg bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] text-[#201a15] dark:text-[#f0e6d6]"
                  >
                    {(Object.keys(SEARCH_SORT_LABEL) as SearchSort[]).map(k => <option key={k} value={k}>{SEARCH_SORT_LABEL[k]}</option>)}
                  </select>
                  {genres.length > 1 && (
                    <select
                      aria-label="Filter by genre"
                      value={view.genre}
                      onChange={e => { setView({ ...view, genre: e.target.value }); setVisibleCount(SEARCH_STEP); }}
                      className="px-2.5 py-1.5 rounded-lg bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] text-[#201a15] dark:text-[#f0e6d6] max-w-[9rem]"
                    >
                      <option value="">All genres</option>
                      {genres.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  )}
                  {([['coverOnly', 'With cover'], ['ratedOnly', 'Rated']] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={view[key]}
                      onClick={() => { setView({ ...view, [key]: !view[key] }); setVisibleCount(SEARCH_STEP); }}
                      className={`px-2.5 py-1.5 rounded-lg border font-semibold ${view[key] ? 'bg-[#2e5934] text-white border-[#2e5934]' : 'bg-[#fbf7ee] dark:bg-[#231d17] border-[#e3d7c3] dark:border-[#382f25] text-[#706256] dark:text-[#a89a8a]'}`}
                    >
                      {label}
                    </button>
                  ))}
                  {!isDefaultView(view) && (
                    <button type="button" onClick={() => setView(DEFAULT_SEARCH_VIEW)} className="px-2 py-1.5 font-semibold text-[#2e5934] dark:text-[#9ed0a6] underline">
                      Reset
                    </button>
                  )}
                </div>
              )}

              {storeSearchResults.length === 0 && storeSearchEmpty ? (
                <div className="p-8 text-center text-sm text-[#706256] dark:text-[#a89a8a] bg-[#fbf7ee] dark:bg-[#231d17] rounded-xl border border-[#e3d7c3] dark:border-[#382f25]">
                  No books found. Check the title spelling or use the Add Book button to add manually.
                </div>
              ) : storeSearchResults.length > 0 && shownResults.length === 0 ? (
                <div className="p-6 text-center text-sm text-[#706256] dark:text-[#a89a8a] bg-[#fbf7ee] dark:bg-[#231d17] rounded-xl border border-[#e3d7c3] dark:border-[#382f25]">
                  No results match these filters.{' '}
                  <button type="button" onClick={() => setView(DEFAULT_SEARCH_VIEW)} className="font-semibold text-[#2e5934] dark:text-[#9ed0a6] underline">Reset filters</button>
                </div>
              ) : (
                <>
                  <div className={`grid grid-cols-3 gap-3 transition-opacity ${storeSearchStale ? 'opacity-50' : ''}`}>
                    {shownResults.slice(0, visibleCount).map(b => (
                      <div key={b.id} className="flex flex-col gap-1.5 min-w-0">
                        <button
                          type="button"
                          onClick={() => handleOpenCover(b)}
                          className="book-cover-3d w-full aspect-[2/3] rounded-md text-left p-2 flex flex-col justify-between text-white overflow-hidden"
                          style={{ backgroundColor: b.spineColor || '#2e5934' }}
                        >
                          <CoverFace book={b} size="md" />
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
                    step={SEARCH_STEP}
                    onMore={() => setVisibleCount(n => n + SEARCH_STEP)}
                    onAll={() => setVisibleCount(shownResults.length)}
                    onLess={() => setVisibleCount(SEARCH_STEP)}
                  />
                </>
              )}
            </div>
          )}

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
