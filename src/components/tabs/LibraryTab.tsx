import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Book, BookStatus, ReadingState } from '../../types';
import { BOOK_AWARDS } from '../../data/defaultBooks';
import { bookKind } from '../../services/bookKind';
import { LibraryCard } from '../cards';
import { TabPane } from './TabPane';

const noStatus: BookStatus = 'list';

interface Props {
  active: boolean;
  /** Every library book that is not finished */
  libraryBooks: Book[];
  state: Pick<ReadingState, 'status' | 'highlights'>;
  handleOpenCover: (book: Book) => void;
  handleOpenHighlights: (book: Book) => void;
  setBookStatus: (id: string | number, status: BookStatus) => void;
  confirmRemoveFromLibrary: (book: Book) => void;
  onAddBook: () => void;
}

/** The Library tab: your reading list, filtered by shelf. */
export function LibraryTab({ active, libraryBooks, state, handleOpenCover, handleOpenHighlights, setBookStatus, confirmRemoveFromLibrary, onAddBook }: Props) {
  // Library filters
  const [libFilter, setLibFilter] = useState<string>('f');

  // Library filtered books (includes all catalog challenge books + custom books)
  const filteredLibraryBooks = useMemo(() => {
    const list = libraryBooks;
    if (libFilter === 'f') {
      return list.filter(b => b.first12Order && b.first12Order > 0).sort((a, b) => (a.first12Order || 0) - (b.first12Order || 0));
    }
    if (libFilter === 's') {
      return list.filter(b => b.isNew);
    }
    if (libFilter === 'aw') {
      return list.filter(b => typeof b.id === 'number' && (BOOK_AWARDS[b.id] || []).length > 0);
    }
    if (libFilter === 'fic' || libFilter === 'nf') {
      const expected = libFilter === 'fic' ? 'fiction' : 'nonfiction';
      return list.filter(b => bookKind(b) === expected);
    }
    if (libFilter === 'all') {
      return list;
    }
    return list.filter(b => b.shelf === libFilter);
  }, [libraryBooks, libFilter]);

  return (
    <TabPane active={active}>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-serif-display text-2xl sm:text-3xl text-[#201a15] dark:text-[#f0e6d6]">
              Library
            </h2>
            <p className="text-xs sm:text-sm text-[#706256] dark:text-[#a89a8a]">
              Your reading list. Finished books move to On my device. Tap any cover to see author, year &amp; page count.
            </p>
          </div>

          <button
            onClick={() => onAddBook()}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#2e5934] text-white hover:bg-[#244729] flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Add Book</span>
          </button>
        </div>

        {/* Filter Chips */}
        <div className="flex flex-wrap gap-2 text-xs">
          {[
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
            ['all', 'All Books'],
          ].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setLibFilter(k)}
              className={`px-3.5 py-1.5 rounded-full border text-xs font-semibold transition-all ${
                libFilter === k
                  ? 'bg-[#2e5934] text-white border-[#2e5934]'
                  : 'bg-[#fbf7ee] dark:bg-[#231d17] border-[#e3d7c3] dark:border-[#382f25] text-[#706256] dark:text-[#a89a8a] hover:text-[#201a15]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Book Cards Grid - Responsive for iPad and iPhone */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredLibraryBooks.map(b => (
            <LibraryCard
              key={b.id}
              book={b}
              status={state.status[String(b.id)] || noStatus}
              highlightCount={(state.highlights[String(b.id)] || []).length}
              onOpen={handleOpenCover}
              onQuotes={handleOpenHighlights}
              onStatus={setBookStatus}
              onRemove={confirmRemoveFromLibrary}
            />
          ))}
        </div>
      </div>
    </TabPane>
  );
}
