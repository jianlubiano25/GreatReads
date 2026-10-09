import React, { useMemo } from 'react';
import { Book, BookStatus, HighlightItem } from '../types';
import { DeviceCard } from './cards';
import { Plus, Smartphone } from 'lucide-react';

const NO_STATUS: BookStatus = 'list';

export type DeviceTabProps = {
  onDeviceBooks: Book[];
  finishedBooks: Book[];
  status: Record<string, BookStatus>;
  highlights: Record<string, HighlightItem[]>;
  onOpen: (book: Book) => void;
  onQuotes: (book: Book) => void;
  onMoveToList: (id: string | number) => void;
  onRemoveFromDevice: (book: Book) => void;
  onRemoveFinished: (book: Book) => void;
  onReadAgain: (id: string | number) => void;
  onAddBook: () => void;
  onPasteList: () => void;
};

/**
 * On my device tab: books marked on-device plus finished books.
 * Page totals and empty state live here; list data and action callbacks come from App.
 */
export function DeviceTab({
  onDeviceBooks,
  finishedBooks,
  status,
  highlights,
  onOpen,
  onQuotes,
  onMoveToList,
  onRemoveFromDevice,
  onRemoveFinished,
  onReadAgain,
  onAddBook,
  onPasteList,
}: DeviceTabProps) {
  const devicePages = useMemo(() => {
    let known = 0;
    let unknown = 0;
    for (const b of [...onDeviceBooks, ...finishedBooks]) {
      if (b.pageCount) known += b.pageCount;
      else unknown++;
    }
    return { known, unknown };
  }, [onDeviceBooks, finishedBooks]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-serif-display text-2xl sm:text-3xl text-[#201a15] dark:text-[#f0e6d6]">
            On my device
          </h2>
          <p className="text-xs sm:text-sm text-[#706256] dark:text-[#a89a8a]">
            Books you keep on your device, plus everything you've finished. A book can be here and in your Library at once.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onAddBook}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#2e5934] text-white hover:bg-[#244729] flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add to Device</span>
          </button>
          <button
            onClick={onPasteList}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-[#e3d7c3] dark:border-[#382f25] text-[#706256] dark:text-[#a89a8a] hover:bg-black/5"
          >
            Paste List
          </button>
        </div>
      </div>

      {/* Total Books on Device counter */}
      <div className="flex items-center gap-2 text-xs text-[#706256] dark:text-[#a89a8a]">
        <span>
          <b>{onDeviceBooks.length + finishedBooks.length}</b> books on device
          {finishedBooks.length > 0 ? ` (${finishedBooks.length} finished)` : ''}
        </span>
        <span>·</span>
        {devicePages.known > 0 && (
          <span>
            <b>{devicePages.known.toLocaleString()}</b> total pages
            {devicePages.unknown > 0
              ? ` (${devicePages.unknown} ${devicePages.unknown === 1 ? 'book' : 'books'} without a page count)`
              : ''}
          </span>
        )}
      </div>

      {onDeviceBooks.length === 0 && finishedBooks.length === 0 ? (
        <div className="p-12 text-center text-[#706256] dark:text-[#a89a8a] bg-[#fbf7ee] dark:bg-[#231d17] rounded-2xl border border-[#e3d7c3] dark:border-[#382f25] flex flex-col items-center gap-3">
          <Smartphone className="w-10 h-10 text-[#2e5934] opacity-70" />
          <div>
            <h4 className="font-serif-display text-lg text-[#201a15] dark:text-[#f0e6d6]">
              Nothing on your device yet
            </h4>
            <p className="text-xs mt-1">
              Tap "Add to Device" or "Paste List" to add books you already own to your device shelf.
            </p>
          </div>
          <button
            onClick={onAddBook}
            className="mt-2 px-4 py-2 rounded-xl text-xs font-semibold bg-[#2e5934] text-white"
          >
            + Add a Book to Device
          </button>
        </div>
      ) : (
        <>
          {onDeviceBooks.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {onDeviceBooks.map(b => (
                <DeviceCard
                  key={b.id}
                  book={b}
                  status={status[String(b.id)] || NO_STATUS}
                  highlightCount={(highlights[String(b.id)] || []).length}
                  onOpen={onOpen}
                  onQuotes={onQuotes}
                  onMoveToList={onMoveToList}
                  onRemoveFromDevice={onRemoveFromDevice}
                  onReadAgain={onReadAgain}
                />
              ))}
            </div>
          )}
          {finishedBooks.length > 0 && (
            <section className="flex flex-col gap-3" aria-label="Finished books">
              <h3 className="font-serif-display text-xl text-[#201a15] dark:text-[#f0e6d6]">
                Finished ({finishedBooks.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {finishedBooks.map(b => (
                  <DeviceCard
                    key={b.id}
                    book={b}
                    finished
                    status="done"
                    highlightCount={(highlights[String(b.id)] || []).length}
                    onOpen={onOpen}
                    onQuotes={onQuotes}
                    onMoveToList={onMoveToList}
                    onRemoveFromDevice={onRemoveFinished}
                    onReadAgain={onReadAgain}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
