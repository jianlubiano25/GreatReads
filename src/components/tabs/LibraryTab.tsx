import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Plus, Search, X } from 'lucide-react';
import type { Book, BookStatus, ReadingState } from '../../types';
import { BOOK_AWARDS } from '../../data/defaultBooks';
import { bookKind } from '../../services/bookKind';
import { readingNowOrder } from '../../services/bookHistory';
import { booksOf, loadCollections, newCollectionId, saveCollections, type Collection } from '../../services/libraryCollections';
import { LibraryCard } from '../cards';
import { LibraryCollectionModal } from '../LibraryCollectionModal';
import { TabPane } from './TabPane';

const noStatus: BookStatus = 'list';

/** The reading-status shelves, top to bottom. Finished books live in On my device, so they are not here. */
const STATUS_SHELVES: Array<{ status: BookStatus; title: string }> = [
  { status: 'now', title: 'Reading now' },
  { status: 'next', title: 'Up next' },
  { status: 'list', title: 'Master list' },
  { status: 'skip', title: 'Skipped' },
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

const CHIP_BASE = 'shrink-0 px-3.5 py-1.5 rounded-full border text-xs font-semibold transition-all whitespace-nowrap';
const CHIP_ON = 'bg-[#2e5934] text-white border-[#2e5934]';
const CHIP_OFF = 'bg-[#fbf7ee] dark:bg-[#231d17] border-[#e3d7c3] dark:border-[#382f25] text-[#706256] dark:text-[#a89a8a] hover:text-[#201a15]';

interface Props {
  active: boolean;
  /** Every library book that is not finished */
  libraryBooks: Book[];
  state: Pick<ReadingState, 'status' | 'highlights' | 'currentPage' | 'totalPages' | 'history'>;
  handleOpenCover: (book: Book) => void;
  handleOpenHighlights: (book: Book) => void;
  setBookStatus: (id: string | number, status: BookStatus) => void;
  confirmRemoveFromLibrary: (book: Book) => void;
  /** Goes up by one each time the header's "Add shelf" is chosen */
  newShelfRequest: number;
}

type Editing = { id?: string; kind: Collection['kind']; name: string; bookIds: string[] };

/** The Library tab: your reading list as shelves you scroll sideways, with tags to narrow them down. */
export function LibraryTab({ active, libraryBooks, state, handleOpenCover, handleOpenHighlights, setBookStatus, confirmRemoveFromLibrary, newShelfRequest }: Props) {
  const [libFilter, setLibFilter] = useState<string>('all');
  const [collections, setCollections] = useState<Collection[]>(() => loadCollections());
  const [editing, setEditing] = useState<Editing | null>(null);
  const [query, setQuery] = useState('');

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
    const list = libraryBooks.filter(passesTag).filter(b => !needle || `${b.title} ${b.author} ${b.genre || ''}`.toLowerCase().includes(needle));
    // "First 12" keeps its own reading order
    return libFilter === 'f' ? list.sort((a, b) => (a.first12Order || 0) - (b.first12Order || 0)) : list;
  }, [libraryBooks, passesTag, libFilter, needle]);

  const statusRows = useMemo(() => {
    const byStatus = new Map<BookStatus, Book[]>();
    for (const b of visibleBooks) {
      const s = state.status[String(b.id)] || noStatus;
      byStatus.set(s, [...(byStatus.get(s) || []), b]);
    }
    return STATUS_SHELVES.map(s => {
      const books = byStatus.get(s.status) || [];
      // Reading now: the book you read most recently comes first
      return { ...s, books: s.status === 'now' ? readingNowOrder(books, state.history) : books };
    }).filter(r => r.books.length > 0);
  }, [visibleBooks, state.status, state.history]);

  const shownIds = useMemo(() => new Set(visibleBooks.map(b => String(b.id))), [visibleBooks]);

  const persist = useCallback((next: Collection[]) => {
    setCollections(next);
    saveCollections(next);
  }, []);

  const saveEditing = (v: { id?: string; kind: Collection['kind']; name: string; bookIds: string[] }) => {
    if (v.id) {
      persist(collections.map(c => (c.id === v.id ? { ...c, name: v.name, bookIds: v.bookIds } : c)));
    } else {
      const id = newCollectionId();
      persist([...collections, { id, kind: v.kind, name: v.name, bookIds: v.bookIds }]);
      if (v.kind === 'tag') setLibFilter(id); // a new tag opens straight away
    }
    setEditing(null);
  };

  const deleteEditing = () => {
    if (!editing?.id) return;
    const id = editing.id;
    if (!confirm(`Delete "${editing.name}"? Your books stay in the Library.`)) return;
    persist(collections.filter(c => c.id !== id));
    if (libFilter === id) setLibFilter('all');
    setEditing(null);
  };

  const renderRow = (key: string, title: string, books: Book[], onEdit?: () => void, emptyHint?: string) => (
    <section key={key} className="flex flex-col gap-3" aria-label={title}>
      <h3 className="font-serif-display text-xl text-[#201a15] dark:text-[#f0e6d6] flex items-center gap-2">
        {title}
        <span className="text-xs font-sans font-medium text-[#706256] dark:text-[#a89a8a]">{books.length}</span>
        {onEdit && (
          <button type="button" onClick={onEdit} className="p-1.5 rounded-lg text-[#706256] dark:text-[#a89a8a] hover:bg-black/5" aria-label={`Edit ${title}`} title="Edit shelf">
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </h3>
      {books.length === 0 ? (
        <p className="text-sm text-[#706256] dark:text-[#a89a8a]">{emptyHint}</p>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-3 no-scrollbar snap-x">
          {books.map(b => (
            <div key={b.id} className="w-[300px] sm:w-[340px] shrink-0 snap-start flex flex-col [&>*]:flex-1">
              <LibraryCard
                book={b}
                status={state.status[String(b.id)] || noStatus}
                highlightCount={(state.highlights[String(b.id)] || []).length}
                currentPage={state.currentPage[String(b.id)] || 0}
                totalPages={state.totalPages[String(b.id)] || b.pageCount || 0}
                onOpen={handleOpenCover}
                onQuotes={handleOpenHighlights}
                onStatus={setBookStatus}
                onRemove={confirmRemoveFromLibrary}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );

  const selectedOwn = collections.find(c => c.id === libFilter && c.kind === 'tag');

  return (
    <TabPane active={active}>
      <div className="flex flex-col gap-6">
        {/* Search the Library */}
        <div className="relative">
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

        {statusRows.map(r => renderRow(r.status, r.title, r.books))}
        {customShelves.map(c =>
          renderRow(
            c.id,
            c.name,
            booksOf(c, libraryBooks).filter(b => shownIds.has(String(b.id))),
            () => setEditing({ id: c.id, kind: 'shelf', name: c.name, bookIds: c.bookIds }),
            libFilter === 'all' && !needle ? 'No books here yet. Tap the pencil to add some.' : needle ? 'None of this shelf\u2019s books match your search.' : 'None of this shelf\u2019s books have this tag.',
          ),
        )}

        {statusRows.length === 0 && customShelves.length === 0 && (
          <p className="text-sm text-[#706256] dark:text-[#a89a8a]">
            {libraryBooks.length === 0 ? 'Your Library is empty. Use + at the top to add a book.' : needle ? 'No books match your search.' : 'No books have this tag yet.'}
          </p>
        )}
      </div>

      {editing && (
        <LibraryCollectionModal
          initial={editing}
          books={libraryBooks}
          onSave={saveEditing}
          onDelete={editing.id ? deleteEditing : undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </TabPane>
  );
}
