import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, Check, Pencil, Plus, Search, X } from 'lucide-react';
import type { Book, BookStatus, ReadingState } from '../../types';
import { BOOK_AWARDS } from '../../data/defaultBooks';
import { bookKind } from '../../services/bookKind';
import { readingNowOrder } from '../../services/bookHistory';
import { booksOf, newCollectionId, type Collection } from '../../services/libraryCollections';
import { LibraryCard } from '../cards';
import { LibraryCollectionModal } from '../LibraryCollectionModal';
import { LibraryListModal } from '../LibraryListModal';
import { TabPane } from './TabPane';

const noStatus: BookStatus = 'list';
/** How many cards a status tab shows before "View all" */
const PREVIEW = 4;

/** The two groups of reading-status tabs. Each shows a few cards sideways; "View all" opens the whole list. */
const GROUP_NOW: Array<{ id: BookStatus; label: string }> = [
  { id: 'now', label: 'Reading now' },
  { id: 'done', label: 'Finished' },
];
const GROUP_NEXT: Array<{ id: BookStatus; label: string }> = [
  { id: 'next', label: 'Up next' },
  { id: 'dnf', label: 'Did not finish' },
  { id: 'skip', label: 'Not for me' },
];

const BUILT_IN_TAGS: Array<[string, string]> = [
  ['all', 'All Books'],
  ['f', 'First 12'],
  ['heal', '🧠 Heal'],
  ['love', '💕 Love'],
  ['life', '🌱 Life at 30'],
  ['joy', '✨ Joy'],
  ['prize', '🌷 Prize winners'],
  ['world', '🌍 World'],
  ['art', '🎵 Art & music'],
  ['aw', '🏆 Prize winners'],
  ['s', 'New suggestions'],
  ['fic', '📖 Fiction'],
  ['nf', '🧭 Non-fiction'],
];

/** How the book lists are ordered. "Smart" is the app's own order (Reading now: latest read first, Finished: latest finished first, the rest as saved). */
type SortKey = 'smart' | 'added' | 'title' | 'author' | 'rating' | 'short';
const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: 'smart', label: 'Smart order' },
  { id: 'added', label: 'Last added' },
  { id: 'title', label: 'Title A–Z' },
  { id: 'author', label: 'Author A–Z' },
  { id: 'rating', label: 'Top rated' },
  { id: 'short', label: 'Shortest first' },
];

/** A sorted copy (the list itself is never touched). Books without a rating / page count / added date go last. */
const sortBooks = (list: Book[], key: SortKey, totalPages: Record<string, number>): Book[] => {
  if (key === 'smart') return list;
  const pages = (b: Book) => totalPages[String(b.id)] || b.pageCount || Infinity;
  const added = (b: Book) => (typeof b.addedAt === 'number' ? b.addedAt : -1);
  const by: Record<Exclude<SortKey, 'smart'>, (a: Book, b: Book) => number> = {
    added: (a, b) => added(b) - added(a), // newest first
    title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
    author: (a, b) => (a.author || '').localeCompare(b.author || '', undefined, { sensitivity: 'base' }) || a.title.localeCompare(b.title),
    rating: (a, b) => (b.ratingAverage ?? 0) - (a.ratingAverage ?? 0),
    short: (a, b) => (pages(a) === pages(b) ? 0 : pages(a) < pages(b) ? -1 : 1),
  };
  return [...list].sort(by[key]);
};

const CHIP_BASE = 'shrink-0 px-3.5 py-1.5 rounded-full border text-xs font-semibold transition-all whitespace-nowrap';
const CHIP_ON = 'bg-[#2e5934] text-white border-[#2e5934]';
const CHIP_OFF = 'bg-[#fbf7ee] dark:bg-[#231d17] border-[#e3d7c3] dark:border-[#382f25] text-[#706256] dark:text-[#a89a8a] hover:text-[#201a15]';

interface Props {
  active: boolean;
  /** Every book in My Library, whatever its status (finished ones too) */
  myBooks: Book[];
  state: Pick<ReadingState, 'status' | 'highlights' | 'currentPage' | 'totalPages' | 'history'>;
  handleOpenCover: (book: Book) => void;
  handleOpenHighlights: (book: Book) => void;
  setBookStatus: (id: string | number, status: BookStatus) => void;
  confirmRemoveFromLibrary: (book: Book) => void;
  /** Goes up by one each time the header's "Add shelf" is chosen */
  newShelfRequest: number;
  /** Your own shelves and tags (kept by the app, shared with the Add to My Library sheet) */
  collections: Collection[];
  onCollectionsChange: (change: (prev: Collection[]) => Collection[]) => void;
  /** Open the Add to My Library sheet (status, shelves, tags) for a book */
  onOpenSheet: (book: Book) => void;
}

type Editing = { id?: string; kind: Collection['kind']; name: string; bookIds: string[] };

/** A row of tabs with counts that scrolls sideways when there are many. */
function TabStrip({ label, tabs, value, onChange, trailing }: {
  label: string;
  tabs: Array<{ id: string; label: string; count: number }>;
  value: string;
  onChange: (id: string) => void;
  trailing?: React.ReactNode;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex items-baseline gap-5 overflow-x-auto no-scrollbar">
      {tabs.map(t => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          // The same titles as before (serif, large, a small count). The tab that is not open is a little greyed out.
          className={`shrink-0 whitespace-nowrap font-serif-display text-xl flex items-baseline gap-2 py-1 transition-colors ${value === t.id ? 'text-[#201a15] dark:text-[#f0e6d6]' : 'text-[#201a15]/40 dark:text-[#f0e6d6]/40 hover:text-[#201a15]/70 dark:hover:text-[#f0e6d6]/70'}`}
        >
          {t.label}
          <span className="text-xs font-sans font-medium opacity-80">{t.count}</span>
        </button>
      ))}
      {trailing}
    </div>
  );
}

/** My Library: what you are reading and what is next (sideways), then everything you own and your shelves (scrolling down). */
export function LibraryTab({ active, myBooks, state, handleOpenCover, handleOpenHighlights, setBookStatus, confirmRemoveFromLibrary, newShelfRequest, collections, onCollectionsChange, onOpenSheet }: Props) {
  const [libFilter, setLibFilter] = useState<string>('all');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [query, setQuery] = useState('');
  const [nowTab, setNowTab] = useState<string>('now');
  const [nextTab, setNextTab] = useState<string>('next');
  const [masterTab, setMasterTab] = useState<string>('master');
  const [viewAll, setViewAll] = useState<{ title: string; books: Book[] } | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('smart');
  const [sortOpen, setSortOpen] = useState(false);

  // The header's "Add shelf" opens the new-shelf dialog (each new request opens it once)
  const handledRequest = useRef(newShelfRequest);
  useEffect(() => {
    if (newShelfRequest === handledRequest.current) return;
    handledRequest.current = newShelfRequest;
    setEditing({ kind: 'shelf', name: '', bookIds: [] });
  }, [newShelfRequest]);

  const customTags = useMemo(() => collections.filter(c => c.kind === 'tag'), [collections]);
  const customShelves = useMemo(() => collections.filter(c => c.kind === 'shelf'), [collections]);

  /** Does a book pass the tag that is selected? */
  const passesTag = useMemo<(b: Book) => boolean>(() => {
    switch (libFilter) {
      case 'all': return () => true;
      case 'f': return b => !!b.first12Order && b.first12Order > 0;
      case 's': return b => !!b.isNew;
      case 'aw': return b => typeof b.id === 'number' && (BOOK_AWARDS[b.id] || []).length > 0;
      case 'fic': return b => bookKind(b) === 'fiction';
      case 'nf': return b => bookKind(b) === 'nonfiction';
      default: {
        const own = collections.find(c => c.id === libFilter);
        if (own) { const ids = new Set(own.bookIds); return b => ids.has(String(b.id)); }
        return b => b.shelf === libFilter;
      }
    }
  }, [libFilter, collections]);

  const needle = query.trim().toLowerCase();
  const visibleBooks = useMemo(() => {
    const list = myBooks.filter(passesTag).filter(b => !needle || `${b.title} ${b.author} ${b.genre || ''}`.toLowerCase().includes(needle));
    // "First 12" keeps its own reading order
    return libFilter === 'f' ? list.sort((a, b) => (a.first12Order || 0) - (b.first12Order || 0)) : list;
  }, [myBooks, passesTag, libFilter, needle]);

  /** The books of each status. Reading now: latest read first. Finished: latest finished first. */
  const byStatus = useMemo(() => {
    const map = new Map<BookStatus, Book[]>();
    for (const b of visibleBooks) {
      const s = state.status[String(b.id)] || noStatus;
      map.set(s, [...(map.get(s) || []), b]);
    }
    map.set('now', readingNowOrder(map.get('now') || [], state.history));
    map.set('done', (map.get('done') || []).slice().sort((a, b) => (state.history[String(b.id)]?.finished ?? '').localeCompare(state.history[String(a.id)]?.finished ?? '')));
    if (sortKey !== 'smart') for (const [k, list] of map) map.set(k, sortBooks(list, sortKey, state.totalPages));
    return map;
  }, [visibleBooks, state.status, state.history, state.totalPages, sortKey]);

  const shownIds = useMemo(() => new Set(visibleBooks.map(b => String(b.id))), [visibleBooks]);

  const saveEditing = (v: { id?: string; kind: Collection['kind']; name: string; bookIds: string[] }) => {
    if (v.id) {
      onCollectionsChange(prev => prev.map(c => (c.id === v.id ? { ...c, name: v.name, bookIds: v.bookIds } : c)));
    } else {
      const id = newCollectionId();
      onCollectionsChange(prev => [...prev, { id, kind: v.kind, name: v.name, bookIds: v.bookIds }]);
      if (v.kind === 'tag') setLibFilter(id); // a new tag opens straight away
      else setMasterTab(id); // a new shelf opens straight away
    }
    setEditing(null);
  };

  const deleteEditing = () => {
    if (!editing?.id) return;
    const id = editing.id;
    if (!confirm(`Delete "${editing.name}"? Your books stay in My Library.`)) return;
    onCollectionsChange(prev => prev.filter(c => c.id !== id));
    if (libFilter === id) setLibFilter('all');
    if (masterTab === id) setMasterTab('master');
    setEditing(null);
  };

  const card = (b: Book) => (
    <LibraryCard
      book={b}
      status={state.status[String(b.id)] || noStatus}
      highlightCount={(state.highlights[String(b.id)] || []).length}
      currentPage={state.currentPage[String(b.id)] || 0}
      totalPages={state.totalPages[String(b.id)] || b.pageCount || 0}
      onOpen={handleOpenCover}
      onQuotes={handleOpenHighlights}
      onStatus={setBookStatus}
      onShelf={onOpenSheet}
      onRemove={confirmRemoveFromLibrary}
    />
  );

  /** Two or three status tabs: a few cards sideways, "View all" for the rest */
  const statusGroup = (name: string, defs: Array<{ id: BookStatus; label: string }>, value: string, setValue: (v: string) => void) => {
    const tabs = defs.map(d => ({ id: d.id, label: d.label, count: (byStatus.get(d.id) || []).length }));
    const current = defs.find(d => d.id === value) ?? defs[0];
    const books = byStatus.get(current.id) || [];
    return (
      <section className="flex flex-col gap-3" aria-label={name}>
        <TabStrip label={name} tabs={tabs} value={current.id} onChange={setValue} />
        {books.length === 0 ? (
          <p className="text-sm text-[#706256] dark:text-[#a89a8a]">Nothing here yet.</p>
        ) : (
          <>
            <div className="flex gap-4 overflow-x-auto pb-3 no-scrollbar snap-x">
              {books.slice(0, PREVIEW).map(b => (
                <div key={b.id} className="w-[300px] sm:w-[340px] shrink-0 snap-start flex flex-col [&>*]:flex-1">{card(b)}</div>
              ))}
            </div>
            {books.length > PREVIEW && (
              <button
                type="button"
                onClick={() => setViewAll({ title: current.label, books })}
                className="self-start min-h-[40px] px-4 rounded-full border border-[#2e5934] dark:border-[#86b880] text-xs font-semibold text-[#2e5934] dark:text-[#86b880] hover:bg-[#2e5934]/10"
              >
                View all {books.length}
              </button>
            )}
          </>
        )}
      </section>
    );
  };

  // Master list + your shelves: tabs, the open one scrolls down and shows every book at once
  const shelfBooks = (c: Collection) => booksOf(c, myBooks).filter(b => shownIds.has(String(b.id)));
  const masterTabs = [
    { id: 'master', label: 'Master list', count: visibleBooks.length },
    ...customShelves.map(c => ({ id: c.id, label: c.name, count: shelfBooks(c).length })),
  ];
  const openShelf = customShelves.find(c => c.id === masterTab);
  const masterValue = openShelf ? openShelf.id : 'master';
  const masterBooks = useMemo(() => sortBooks(openShelf ? shelfBooks(openShelf) : visibleBooks, sortKey, state.totalPages), [openShelf, visibleBooks, myBooks, shownIds, sortKey, state.totalPages]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedOwn = collections.find(c => c.id === libFilter && c.kind === 'tag');

  return (
    <TabPane active={active}>
      <div className="flex flex-col gap-6">
        {/* Pinned while the list scrolls (same pattern as the Store's jump bar): search + sort chip and the tags, tightly spaced */}
        <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 md:-mx-8 px-4 sm:px-6 md:px-8 pt-[max(env(safe-area-inset-top),0.25rem)] pb-1 bg-[#f5f0e6] dark:bg-[#181410] flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#706256] dark:text-[#a89a8a] pointer-events-none" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search your library"
              aria-label="Search your library"
              className="w-full py-2.5 pl-10 pr-10 rounded-full text-sm bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] text-[#201a15] dark:text-[#f0e6d6] placeholder:text-[#706256] dark:placeholder:text-[#a89a8a] focus:outline-none focus:border-[#2e5934]"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full hover:bg-black/5" aria-label="Clear search">
                <X className="w-4 h-4 text-[#706256] dark:text-[#a89a8a]" />
              </button>
            )}
          </div>
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setSortOpen(o => !o)}
              aria-label={`Sort books: ${SORTS.find(x => x.id === sortKey)?.label}`}
              aria-haspopup="menu"
              aria-expanded={sortOpen}
              className={`flex items-center gap-1.5 h-[42px] px-3.5 rounded-full border text-xs font-semibold transition-all ${sortKey === 'smart' ? CHIP_OFF : CHIP_ON}`}
            >
              <ArrowUpDown className="w-4 h-4" aria-hidden="true" />
              {sortKey !== 'smart' && <span className="whitespace-nowrap">{SORTS.find(x => x.id === sortKey)?.label}</span>}
            </button>
            {sortOpen && (
              <>
                <button type="button" aria-label="Close sort menu" className="fixed inset-0 z-30 cursor-default" onClick={() => setSortOpen(false)} />
                <div role="menu" className="absolute right-0 top-full mt-1.5 z-40 w-44 rounded-2xl border border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17] shadow-lg py-1">
                  {SORTS.map(o => (
                    <button
                      key={o.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={sortKey === o.id}
                      onClick={() => { setSortKey(o.id); setSortOpen(false); }}
                      className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-xs font-semibold text-left text-[#201a15] dark:text-[#f0e6d6] hover:bg-[#2e5934]/10"
                    >
                      {o.label}
                      {sortKey === o.id && <Check className="w-4 h-4 text-[#2e5934] dark:text-[#86b880]" aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Tags: scroll sideways; the + makes a new one */}
        <div className="flex items-center gap-2 text-xs overflow-x-auto no-scrollbar -mx-1 px-1 py-0.5">
          <button
            type="button"
            onClick={() => setEditing({ kind: 'tag', name: '', bookIds: [] })}
            className={`${CHIP_BASE} ${CHIP_OFF} flex items-center gap-1 !px-2.5`}
            aria-label="Add tag"
            title="Add a tag"
          >
            <Plus className="w-4 h-4" />
          </button>
          {BUILT_IN_TAGS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setLibFilter(k)} aria-pressed={libFilter === k} className={`${CHIP_BASE} ${libFilter === k ? CHIP_ON : CHIP_OFF}`}>
              {label}
            </button>
          ))}
          {customTags.map(c => (
            <button key={c.id} type="button" onClick={() => setLibFilter(c.id)} aria-pressed={libFilter === c.id} className={`${CHIP_BASE} ${libFilter === c.id ? CHIP_ON : CHIP_OFF}`}>
              {c.name}
            </button>
          ))}
          {selectedOwn && (
            <button
              type="button"
              onClick={() => setEditing({ id: selectedOwn.id, kind: 'tag', name: selectedOwn.name, bookIds: selectedOwn.bookIds })}
              className={`${CHIP_BASE} ${CHIP_OFF} !px-2.5`}
              aria-label={`Edit tag ${selectedOwn.name}`}
              title="Edit tag"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        </div>

        {statusGroup('Reading', GROUP_NOW, nowTab, setNowTab)}
        {statusGroup('Up next and set aside', GROUP_NEXT, nextTab, setNextTab)}

        <section className="flex flex-col gap-3" aria-label="Master list and shelves">
          <TabStrip
            label="Master list and shelves"
            tabs={masterTabs}
            value={masterValue}
            onChange={setMasterTab}
            trailing={
              <button type="button" onClick={() => setEditing({ kind: 'shelf', name: '', bookIds: [] })} className="shrink-0 p-2 rounded-lg text-[#2e5934] dark:text-[#86b880] hover:bg-black/5" aria-label="Add shelf" title="Add a shelf">
                <Plus className="w-4 h-4" />
              </button>
            }
          />
          {openShelf && (
            <button
              type="button"
              onClick={() => setEditing({ id: openShelf.id, kind: 'shelf', name: openShelf.name, bookIds: openShelf.bookIds })}
              className="self-start flex items-center gap-1.5 text-xs font-semibold text-[#706256] dark:text-[#a89a8a] hover:text-[#201a15] dark:hover:text-[#f0e6d6]"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit shelf
            </button>
          )}
          {masterBooks.length === 0 ? (
            <p className="text-sm text-[#706256] dark:text-[#a89a8a]">
              {myBooks.length === 0
                ? 'My Library is empty. Use + at the top to add a book.'
                : needle ? 'No books match your search.'
                : openShelf ? (libFilter === 'all' ? 'No books on this shelf yet. Tap Edit shelf to add some.' : 'None of this shelf’s books have this tag.')
                : 'No books have this tag yet.'}
            </p>
          ) : (
            // Every book is drawn at once, but the browser skips painting the ones that are off screen, so it stays light
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {masterBooks.map(b => (
                <div key={b.id} className="flex flex-col [&>*]:flex-1" style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 200px' }}>
                  {card(b)}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {editing && (
        <LibraryCollectionModal
          initial={editing}
          books={myBooks}
          onSave={saveEditing}
          onDelete={editing.id ? deleteEditing : undefined}
          onClose={() => setEditing(null)}
        />
      )}
      {viewAll && <LibraryListModal title={viewAll.title} books={viewAll.books} renderCard={card} onClose={() => setViewAll(null)} />}
    </TabPane>
  );
}
