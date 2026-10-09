import React, { useEffect, useState } from 'react';
import { Book } from '../types';
import { searchBooks, fillMissingCovers } from '../services/books';
import { SHELF_BY_ID } from '../services/store/registry';
import { toggleShelf, type StorePrefs } from '../services/store/prefs';
import { StoreShelf } from './StoreShelf';
import { StoreCustomize } from './StoreCustomize';
import { CoverFace } from './BookMeta';
import { Award, Plus, Search } from 'lucide-react';

export type StoreTabProps = {
  customizing: boolean;
  shelfOrder: string[];
  hiddenShelves: string[];
  storePrefs: StorePrefs;
  prizeBooks: Book[];
  easyBooks: Book[];
  onReorder: (order: string[]) => void;
  onToggleShelf: (id: string) => void;
  onDoneCustomize: () => void;
  onResetLayout: () => void;
  onAddBook: () => void;
  onOpen: (book: Book) => void;
};

/**
 * Book Store tab: search, customize panel, and shelf list.
 * Search state lives here; shelf prefs and catalog lists come from App.
 */
export function StoreTab({
  customizing,
  shelfOrder,
  hiddenShelves,
  storePrefs,
  prizeBooks,
  easyBooks,
  onReorder,
  onToggleShelf,
  onDoneCustomize,
  onResetLayout,
  onAddBook,
  onOpen,
}: StoreTabProps) {
  const [storeSearchQuery, setStoreSearchQuery] = useState('');
  const [storeSearchResults, setStoreSearchResults] = useState<Book[]>([]);
  const [isStoreSearching, setIsStoreSearching] = useState(false);

  // Debounced search; cancelled when the query changes so a slow answer never overwrites a newer one
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
          fillMissingCovers(results, r => {
            if (!controller.signal.aborted) setStoreSearchResults(r);
          }, controller.signal);
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

  return (
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
          onClick={onAddBook}
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
          onReorder={onReorder}
          onToggle={onToggleShelf}
          onDone={onDoneCustomize}
          onResetLayout={onResetLayout}
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
                <div className="text-sm text-[#706256] dark:text-[#a89a8a] py-4">
                  No books found. Check the title spelling or use the Add Book button to add manually.
                </div>
              ) : (
                <div className="flex gap-4 overflow-x-auto pb-3 no-scrollbar">
                  {storeSearchResults.map(b => (
                    <div key={String(b.id)} className="w-[125px] sm:w-[140px] shrink-0 flex flex-col gap-1.5">
                      <button
                        type="button"
                        onClick={() => onOpen(b)}
                        className="relative w-full aspect-[2/3] rounded-md shadow-sm text-left p-2.5 flex flex-col justify-between text-white overflow-hidden"
                        style={{ backgroundColor: b.spineColor || '#2e5934' }}
                      >
                        <CoverFace book={b} size="md" />
                      </button>
                      <h4
                        onClick={() => onOpen(b)}
                        className="font-serif-display text-sm leading-tight text-[#201a15] dark:text-[#f0e6d6] line-clamp-2 hover:underline cursor-pointer"
                      >
                        {b.title}
                      </h4>
                      <div className="text-xs text-[#706256] dark:text-[#a89a8a] truncate">{b.author}</div>
                      <button
                        onClick={() => onOpen(b)}
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
            if (!def) return null;
            if (def.library) {
              const books = def.library === 'prize' ? prizeBooks : easyBooks;
              const title = def.library === 'prize' ? (
                <>
                  <Award className="w-5 h-5 text-amber-500" />
                  <span>Prize winners from your lists</span>
                </>
              ) : def.title;
              return <StoreShelf key={id} id={id} title={title} books={books} onOpen={onOpen} />;
            }
            return (
              <StoreShelf
                key={id}
                id={id}
                title={def.title}
                source={def.source}
                ranked={def.ranked}
                lazy={def.lazy}
                hideIfUnavailable={def.hideIfUnavailable}
                onOpen={onOpen}
              />
            );
          })}
          <p className="text-xs text-[#706256] dark:text-[#a89a8a]">
            Bestsellers from The New York Times. Covers and ratings from Open Library, Google Books and Apple Books readers.
          </p>
        </>
      )}
    </div>
  );
}
