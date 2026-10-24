import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, RefreshCw } from 'lucide-react';
import type { Book } from '../../types';
import { BOOK_AWARDS } from '../../data/defaultBooks';
import { useKnownBooks } from '../../hooks/useKnownBooks';
import { DEFAULT_SHELF_ORDER, SHELF_BY_ID, hiddenShelfIds } from '../../services/store/registry';
import { loadStorePrefs, NO_PREFS, orderShelves, saveStorePrefs, toggleShelf, type StorePrefs } from '../../services/store/prefs';
import { milestone } from '../../services/books/perf';
import type { SearchScope } from '../../services/books';
import { BookSearch } from '../BookSearch';
import { StoreShelf } from '../StoreShelf';
import { StoreCustomize } from '../StoreCustomize';
import { useRefreshAll } from '../../services/store/refreshAll';
import { StoreNav } from '../StoreNav';
import { TabPane } from './TabPane';

interface Props {
  active: boolean;
  /** Every book in the library: the "prize winners" and "easy to start" shelves are built from it */
  allBooks: Book[];
  /** Customize Shelves is toggled from the page header and footer, so App owns this flag */
  customizing: boolean;
  setCustomizing: (on: boolean) => void;
  handleOpenCover: (book: Book) => void;
  /** Your own status, pages, dates and stars for a book, shown on its Discover card */
  mine?: (b: Book) => string | undefined;
}

const PRIZE_TITLE = (
  <>
    <Award className="w-5 h-5 text-amber-500" />
    <span>Prize winners from your lists</span>
  </>
);

/** The Discover tab (the Store): search, the shelves in the reader's own order, and Customize Shelves. */
export function StoreTab({ active, allBooks, customizing, setCustomizing, handleOpenCover, mine }: Props) {
  // Store layout: the reader's own shelf order and hidden shelves (prefs only; shelf data is never touched, see services/store/prefs.ts)
  const [storePrefs, setStorePrefs] = useState<StorePrefs>(loadStorePrefs);
  const shelfOrder = useMemo(() => orderShelves(DEFAULT_SHELF_ORDER, storePrefs.order), [storePrefs.order]);
  const hiddenShelves = useMemo(() => hiddenShelfIds(storePrefs), [storePrefs]);
  const updateStorePrefs = useCallback((next: StorePrefs) => { setStorePrefs(next); saveStorePrefs(next); }, []);
  const reorderShelves = useCallback((order: string[]) => updateStorePrefs({ ...storePrefs, order }), [storePrefs, updateStorePrefs]);

  useEffect(() => { milestone('store-mounted'); }, []); // measurement only
  const refreshAll = useRefreshAll(); // "Refresh all shelves" keeps running after Customize Shelves is closed; its progress shows here

  // The search box is the same one the Search tab has (components/BookSearch.tsx); this tab only keeps what is typed
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');

  // The shelves compare their books with yours only to share ratings (see hooks/useKnownBooks.ts)
  const known = useKnownBooks(allBooks);

  // Store shelves built from your own catalog
  const prizeBooks = useMemo(
    () => allBooks.filter(b => typeof b.id === 'number' && (BOOK_AWARDS[b.id] || []).length > 0),
    [allBooks],
  );
  const easyBooks = useMemo(() => allBooks.filter(b => b.difficulty === 1), [allBooks]);

  return (
    <TabPane active={active}>
      <div className="flex flex-col gap-6">
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
          {refreshAll.running ? (
            <p className="text-xs text-[#2e5934] dark:text-[#86b880] flex items-center gap-1.5" role="status" aria-live="polite">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              Refreshing {Math.min(refreshAll.done + 1, refreshAll.total)} of {refreshAll.total}…
            </p>
          ) : refreshAll.noteFresh && refreshAll.note ? (
            <p className="text-xs text-[#2e5934] dark:text-[#86b880]" role="status">{refreshAll.note}</p>
          ) : null}

          <BookSearch active={active} known={known} query={query} setQuery={setQuery} scope={scope} setScope={setScope} handleOpenCover={handleOpenCover} backLabel="Back to the Store" />

          {/* Sticky icon bar (not while searching: results take over the page, and BookSearch has its own sticky header) */}
          {!query.trim() && <StoreNav active={active} order={shelfOrder} />}

          {/* Shelves, in the reader's own order (Customize Shelves). Hidden shelves are not drawn, so they also load nothing. */}
          {shelfOrder.filter(id => !hiddenShelves.includes(id)).map((id, position) => {
            const def = SHELF_BY_ID[id];
            const priority = position < 2; // the first two shelves load their covers at once; the rest as they come near the screen
            if (def.library) {
              const books = def.library === 'prize' ? prizeBooks : easyBooks;
              const title = def.library === 'prize' ? PRIZE_TITLE : def.title;
              return <StoreShelf key={id} id={id} title={title} books={books} known={known} priority={priority} mine={mine} onOpen={handleOpenCover} />;
            }
            return <StoreShelf key={id} id={id} title={def.title} source={def.source} ranked={def.ranked} lazy={def.lazy} hideIfUnavailable={def.hideIfUnavailable} known={known} priority={priority} mine={mine} onOpen={handleOpenCover} />;
          })}
          <p className="text-xs text-[#706256] dark:text-[#a89a8a]">Bestsellers from The New York Times. Covers and ratings from Open Library, Google Books and Apple Books readers.</p>
          </>
        )}
      </div>
    </TabPane>
  );
}
