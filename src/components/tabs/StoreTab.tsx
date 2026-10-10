import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Award } from 'lucide-react';
import type { Book } from '../../types';
import { BOOK_AWARDS } from '../../data/defaultBooks';
import { searchBooks, fillMissingCovers } from '../../services/books';
import { DEFAULT_SHELF_ORDER, SHELF_BY_ID, hiddenShelfIds } from '../../services/store/registry';
import { loadStorePrefs, NO_PREFS, orderShelves, saveStorePrefs, toggleShelf, type StorePrefs } from '../../services/store/prefs';
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

/** The Store tab: search, the shelves in the reader's own order, and Customize Store. */
export function StoreTab({ active, allBooks, customizing, setCustomizing, handleOpenCover, onAddBook }: Props) {
  // Store layout: the reader's own shelf order and hidden shelves (prefs only; shelf data is never touched, see services/store/prefs.ts)
  const [storePrefs, setStorePrefs] = useState<StorePrefs>(loadStorePrefs);
  const shelfOrder = useMemo(() => orderShelves(DEFAULT_SHELF_ORDER, storePrefs.order), [storePrefs.order]);
  const hiddenShelves = useMemo(() => hiddenShelfIds(storePrefs), [storePrefs]);
  const updateStorePrefs = useCallback((next: StorePrefs) => { setStorePrefs(next); saveStorePrefs(next); }, []);
  const reorderShelves = useCallback((order: string[]) => updateStorePrefs({ ...storePrefs, order }), [storePrefs, updateStorePrefs]);

  // Store search & shelf data
  const [storeSearchQuery, setStoreSearchQuery] = useState('');
  const [storeSearchResults, setStoreSearchResults] = useState<Book[]>([]);
  const [isStoreSearching, setIsStoreSearching] = useState(false);

  // Handle store search with debounce; superseded requests are cancelled so a slow old answer
  // can never overwrite the results of what you typed last.
  useEffect(() => {
    if (!storeSearchQuery.trim()) {
      setStoreSearchResults([]);
      setIsStoreSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsStoreSearching(true);
      try {
        const results = await searchBooks(storeSearchQuery, '', 10, controller.signal);
        if (!controller.signal.aborted) {
          setStoreSearchResults(results);
          fillMissingCovers(results, r => { if (!controller.signal.aborted) setStoreSearchResults(r); }, controller.signal);
        }
      } catch {
        if (!controller.signal.aborted) setStoreSearchResults([]);
      } finally {
        if (!controller.signal.aborted) setIsStoreSearching(false);
      }
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [storeSearchQuery]);

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
              type="search"
              value={storeSearchQuery}
              onChange={e => setStoreSearchQuery(e.target.value)}
              placeholder="Search by title, author, or keyword in online catalog"
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] text-sm focus:outline-none focus:ring-2 focus:ring-[#2e5934]"
            />
          </div>

          {/* Search Results if query present */}
          {storeSearchQuery.trim() && (
            <div className="flex flex-col gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a]">
                {isStoreSearching ? 'Searching Online…' : `Search Results (${storeSearchResults.length})`}
              </span>

              {storeSearchResults.length === 0 && !isStoreSearching ? (
                <div className="p-8 text-center text-sm text-[#706256] dark:text-[#a89a8a] bg-[#fbf7ee] dark:bg-[#231d17] rounded-xl border border-[#e3d7c3] dark:border-[#382f25]">
                  No books found. Check the title spelling or use the Add Book button to add manually.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {storeSearchResults.map(b => (
                    <div key={b.id} className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenCover(b)}
                        className="book-cover-3d w-full aspect-[2/3] rounded-md text-left p-2.5 flex flex-col justify-between text-white overflow-hidden"
                        style={{ backgroundColor: b.spineColor || '#2e5934' }}
                      >
                        <CoverFace book={b} size="md" />
                      </button>
                      <h4
                        onClick={() => handleOpenCover(b)}
                        className="font-serif-display text-sm leading-tight text-[#201a15] dark:text-[#f0e6d6] line-clamp-2 hover:underline cursor-pointer"
                      >
                        {b.title}
                      </h4>
                      <div className="text-xs text-[#706256] dark:text-[#a89a8a] truncate">{b.author}</div>
                      <button
                        onClick={() => handleOpenCover(b)}
                        className="mt-1 py-1.5 px-3 rounded-lg text-xs font-semibold bg-[#2e5934] text-white hover:bg-[#244729] text-center"
                      >
                        View Details
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Shelves, in the reader's own order (Customize Store). Hidden shelves are not drawn, so they also load nothing. */}
          {shelfOrder.filter(id => !hiddenShelves.includes(id)).map(id => {
            const def = SHELF_BY_ID[id];
            if (def.library) {
              const books = def.library === 'prize' ? prizeBooks : easyBooks;
              const title = def.library === 'prize' ? (
                <>
                  <Award className="w-5 h-5 text-amber-500" />
                  <span>Prize winners from your lists</span>
                </>
              ) : def.title;
              return <StoreShelf key={id} id={id} title={title} books={books} known={allBooks} onOpen={handleOpenCover} />;
            }
            return <StoreShelf key={id} id={id} title={def.title} source={def.source} ranked={def.ranked} lazy={def.lazy} hideIfUnavailable={def.hideIfUnavailable} known={allBooks} onOpen={handleOpenCover} />;
          })}
          <p className="text-xs text-[#706256] dark:text-[#a89a8a]">Bestsellers from The New York Times. Covers and ratings from Open Library, Google Books and Apple Books readers.</p>
          </>
        )}
      </div>
    </TabPane>
  );
}
