import React, { useEffect, useRef, useState } from 'react';
import { Book, BookStatus, WordItem } from '../types';
import { DIFFICULTY_LABELS } from '../data/defaultBooks';
import { BUILTIN_DICTIONARY } from '../data/defaultWords';
import { speakWord } from '../services/dictionary';
import { CoverFace, RatingLine, AwardBadges } from './BookMeta';
import { Bookmark, Check, Edit2, Search, Trash2, Volume2 } from 'lucide-react';

/*
 * The cards on the Today, Library, Device and Word Garden screens.
 * Each one is memoized and only receives plain values plus stable callbacks, so changing one book's
 * note or page no longer redraws every other card on the screen.
 */

/** A text box that keeps what you type locally and saves it a moment later (and when you leave the box). */
export function NoteBox({
  value,
  onCommit,
  rows = 2,
  placeholder,
  className,
  ariaLabel,
}: {
  value: string;
  onCommit: (text: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ text, value, onCommit });
  latest.current = { text, value, onCommit };
  const lastCommitted = useRef(value);

  // Follow changes that did not come from typing here (e.g. a restored backup)
  useEffect(() => {
    if (value !== lastCommitted.current) {
      lastCommitted.current = value;
      setText(value);
    }
  }, [value]);

  const commit = () => {
    clearTimeout(timer.current);
    const { text: t, value: v, onCommit: save } = latest.current;
    if (t !== v && t !== lastCommitted.current) {
      lastCommitted.current = t;
      save(t);
    }
  };
  useEffect(() => () => commit(), []);

  return (
    <textarea
      value={text}
      rows={rows}
      aria-label={ariaLabel}
      placeholder={placeholder}
      className={className}
      onChange={e => {
        setText(e.target.value);
        clearTimeout(timer.current);
        timer.current = setTimeout(commit, 500);
      }}
      onBlur={commit}
    />
  );
}

const CARD = 'rounded-2xl bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] border-l-4 shadow-sm';
const LINK_BTN = 'text-left hover:underline focus-visible:underline focus:outline-none';

/* ---------------- Today: the book you are reading ---------------- */

interface NowProps {
  book: Book;
  currentPage: number;
  totalPages: number; // 0 = unknown
  highlightCount: number;
  note: string;
  onOpen: (b: Book) => void;
  onProgress: (id: string | number, page: number, total?: number) => void;
  onStatus: (id: string | number, status: BookStatus) => void;
  onQuotes: (b: Book) => void;
  onNote: (id: string | number, text: string) => void;
}

export const NowReadingCard = React.memo(function NowReadingCard({
  book: b, currentPage: currentP, totalPages: totalP, highlightCount: hlCount, note, onOpen, onProgress, onStatus, onQuotes, onNote,
}: NowProps) {
  const known = totalP > 0;
  const pct = known ? Math.min(100, Math.round((currentP / totalP) * 100)) : 0;
  const clamp = (n: number) => (known ? Math.min(totalP, Math.max(0, n)) : Math.max(0, n));

  return (
    <div className={`p-5 ${CARD} flex flex-col gap-4`} style={{ borderLeftColor: b.spineColor || '#2e5934' }}>
      <div className="flex items-start gap-4">
        <button
          type="button"
          onClick={() => onOpen(b)}
          className="book-cover-3d w-[92px] h-[135px] sm:w-[105px] sm:h-[152px] shrink-0 text-left p-3 flex flex-col justify-between text-white overflow-hidden shadow-md"
          style={{ backgroundColor: b.spineColor || '#2e5934' }}
          title="Tap to see author, year, pages & info"
          aria-label={`${b.title}: details`}
        >
          <CoverFace book={b} size="lg" eager />
        </button>

        <div className="flex-1 min-w-0">
          <h3 className="font-serif-display text-lg sm:text-xl text-[#201a15] dark:text-[#f0e6d6] line-clamp-2">
            <button type="button" onClick={() => onOpen(b)} className={LINK_BTN}>{b.title}</button>
          </h3>
          <div className="text-xs text-[#2e5934] dark:text-[#86b880] font-medium mb-1">{b.author}</div>
          <div className="text-xs text-[#706256] dark:text-[#a89a8a]">
            {b.year ? `${b.year} · ` : ''}{b.genre} · {DIFFICULTY_LABELS[b.difficulty]}
          </div>
          <RatingLine book={b} className="mt-0.5" />
        </div>
      </div>
      <AwardBadges book={b} />

      {/* Progress */}
      <div className="flex flex-col gap-1.5">
        <div className="w-full h-2 rounded-full bg-[#e3d7c3] dark:bg-[#382f25] overflow-hidden">
          <div className="h-full bg-[#2e5934] dark:bg-[#86b880] rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between text-xs text-[#706256] dark:text-[#a89a8a]">
          <div className="flex items-center gap-1.5">
            <span>Page</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              max={known ? totalP : undefined}
              aria-label={`Current page of ${b.title}`}
              key={`${b.id}-${currentP}`}
              defaultValue={currentP}
              onBlur={e => {
                const v = clamp(Math.round(Number(e.target.value)) || 0);
                if (v !== currentP) onProgress(b.id, v, totalP || undefined);
              }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="w-20 px-2 py-1 rounded border border-[#e3d7c3] dark:border-[#382f25] bg-transparent text-center font-bold text-[#201a15] dark:text-[#f0e6d6]"
            />
            {known ? (
              <span>of {totalP}</span>
            ) : (
              <label className="flex items-center gap-1.5">
                <span>of</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  placeholder="total"
                  aria-label={`Total pages of ${b.title}`}
                  onBlur={e => {
                    const n = Math.round(Number(e.target.value));
                    if (n > 0) onProgress(b.id, currentP, n);
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  className="w-20 px-2 py-1 rounded border border-[#e3d7c3] dark:border-[#382f25] bg-transparent text-center text-[#201a15] dark:text-[#f0e6d6]"
                />
              </label>
            )}
          </div>
          <span className="font-bold">{known ? `${pct}%` : ''}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[#e3d7c3] dark:border-[#382f25]">
        <button
          onClick={() => onProgress(b.id, clamp(currentP + 10), totalP || undefined)}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#2e5934] text-white hover:bg-[#244729] shadow-sm"
        >
          +10 pages
        </button>
        <button
          onClick={() => onStatus(b.id, 'done')}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#2e5934] text-[#2e5934] dark:text-[#86b880] hover:bg-[#2e5934]/10"
        >
          I finished it
        </button>
        <button
          onClick={() => onStatus(b.id, 'skip')}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#e3d7c3] dark:border-[#382f25] text-[#706256] dark:text-[#a89a8a] hover:bg-black/5"
        >
          Not for me
        </button>
        <button
          onClick={() => onQuotes(b)}
          className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#e3d7c3] dark:border-[#382f25] text-[#706256] dark:text-[#a89a8a] flex items-center gap-1.5 hover:bg-black/5"
        >
          <Bookmark className="w-3.5 h-3.5 text-[#925838]" />
          <span>Quotes {hlCount > 0 ? `(${hlCount})` : ''}</span>
        </button>
      </div>

      <NoteBox
        value={note}
        onCommit={t => onNote(b.id, t)}
        placeholder="A line or thought worth keeping…"
        ariaLabel={`Notes on ${b.title}`}
        className="w-full p-2.5 rounded-xl bg-[#f5f0e6]/70 dark:bg-[#181410]/70 border border-[#e3d7c3] dark:border-[#382f25] text-xs italic text-[#201a15] dark:text-[#f0e6d6] focus:outline-none"
      />
    </div>
  );
});

/* ---------------- Today: up next ---------------- */

export const UpNextCard = React.memo(function UpNextCard({
  book: b, onOpen, onStart,
}: { book: Book; onOpen: (b: Book) => void; onStart: (id: string | number) => void }) {
  return (
    <div className="p-3 rounded-xl bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] flex items-center gap-3">
      <button
        type="button"
        onClick={() => onOpen(b)}
        className="book-cover-3d w-14 h-20 shrink-0 rounded text-[9px] p-1.5 text-white flex flex-col justify-between overflow-hidden shadow"
        style={{ backgroundColor: b.spineColor || '#2e5934' }}
        aria-label={`${b.title}: details`}
      >
        <CoverFace book={b} size="xs" />
      </button>

      <div className="flex-1 min-w-0">
        <h4 className="font-serif-display text-sm font-semibold truncate">
          <button type="button" onClick={() => onOpen(b)} className={`${LINK_BTN} max-w-full truncate`}>{b.title}</button>
        </h4>
        <p className="text-xs text-[#706256] dark:text-[#a89a8a] truncate">{b.author}</p>
        <button
          onClick={() => onStart(b.id)}
          className="mt-1 text-xs font-semibold text-[#2e5934] dark:text-[#86b880] hover:underline"
        >
          Start reading →
        </button>
      </div>
    </div>
  );
});

/* ---------------- Library + Device cards ---------------- */

interface ShelfCardProps {
  book: Book;
  highlightCount: number;
  onOpen: (b: Book) => void;
  onQuotes: (b: Book) => void;
}

function ShelfCardTop({ book: b, onOpen }: { book: Book; onOpen: (b: Book) => void }) {
  return (
    <>
      <div className="flex items-start gap-3.5">
        <button
          type="button"
          onClick={() => onOpen(b)}
          className="book-cover-3d w-[86px] h-[126px] sm:w-[94px] sm:h-[138px] shrink-0 text-left p-2.5 flex flex-col justify-between text-white overflow-hidden shadow-md"
          style={{ backgroundColor: b.spineColor || '#2e5934' }}
          title="Tap to see author, year & page info"
          aria-label={`${b.title}: details`}
        >
          <CoverFace book={b} size="md" />
        </button>

        <div className="flex-1 min-w-0">
          <h3 className="font-serif-display text-base text-[#201a15] dark:text-[#f0e6d6] line-clamp-2 leading-snug">
            <button type="button" onClick={() => onOpen(b)} className={LINK_BTN}>{b.title}</button>
          </h3>
          <p className="text-xs text-[#2e5934] dark:text-[#86b880] font-medium mt-0.5 truncate">{b.author}</p>
          <div className="text-[11px] text-[#706256] dark:text-[#a89a8a] mt-1">
            {b.year ? `${b.year} · ` : ''}{b.pageCount ? `${b.pageCount} p. · ` : ''}{b.genre}
          </div>
          <RatingLine book={b} className="mt-0.5" />
        </div>
      </div>
      <AwardBadges book={b} />
    </>
  );
}

const ICON_BTN = 'p-1.5 rounded-lg border border-[#e3d7c3] dark:border-[#382f25] hover:bg-black/5 text-[#706256] dark:text-[#a89a8a]';

export const LibraryCard = React.memo(function LibraryCard({
  book: b, status, highlightCount, onOpen, onQuotes, onStatus, onRemove,
}: ShelfCardProps & {
  status: BookStatus;
  onStatus: (id: string | number, status: BookStatus) => void;
  onRemove: (b: Book) => void;
}) {
  return (
    <div className={`p-4 ${CARD} flex flex-col justify-between gap-3`} style={{ borderLeftColor: b.spineColor || '#2e5934' }}>
      <ShelfCardTop book={b} onOpen={onOpen} />

      {b.notes && (
        <p className="text-xs text-[#706256] dark:text-[#a89a8a] italic line-clamp-2">“{b.notes}”</p>
      )}

      <div className="flex items-center gap-2 pt-2 border-t border-[#e3d7c3] dark:border-[#382f25]">
        <select
          value={status}
          aria-label={`Reading status of ${b.title}`}
          onChange={e => onStatus(b.id, e.target.value as BookStatus)}
          className="flex-1 py-1.5 px-2.5 rounded-lg text-xs bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-[#201a15] dark:text-[#f0e6d6] font-medium focus:outline-none"
        >
          <option value="list">Master list</option>
          <option value="next">Next</option>
          <option value="now">Reading now</option>
          <option value="done">Finished</option>
          <option value="skip">Skipped</option>
        </select>

        <button onClick={() => onQuotes(b)} className={ICON_BTN} title="View quotes & highlights" aria-label={`Quotes${highlightCount ? ` (${highlightCount})` : ''}`}>
          <Bookmark className="w-4 h-4 text-[#925838]" />
        </button>

        <button
          onClick={() => onRemove(b)}
          className="p-1.5 rounded-lg text-[#706256] dark:text-[#a89a8a] hover:text-red-500"
          title="Remove book"
          aria-label={`Remove ${b.title}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
});

export const DeviceCard = React.memo(function DeviceCard({
  book: b, status, finished, highlightCount, onOpen, onQuotes, onMoveToList, onRemoveFromDevice, onReadAgain,
}: ShelfCardProps & {
  status: BookStatus;
  finished?: boolean;
  onMoveToList: (id: string | number) => void;
  onRemoveFromDevice: (b: Book) => void;
  onReadAgain: (id: string | number) => void;
}) {
  const inList = status === 'next' || status === 'now';
  return (
    <div className={`p-4 ${CARD} flex flex-col justify-between gap-3`} style={{ borderLeftColor: b.spineColor || '#2e5934' }}>
      <ShelfCardTop book={b} onOpen={onOpen} />

      <div className="flex items-center gap-2 pt-2 border-t border-[#e3d7c3] dark:border-[#382f25]">
        {finished ? (
          <button onClick={() => onReadAgain(b.id)} className="flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold bg-[#2e5934] text-white hover:bg-[#244729] text-center">
            Read again
          </button>
        ) : inList ? (
          <span className="flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold text-center text-[#2e5934] dark:text-[#86b880] bg-[#2e5934]/10">
            {status === 'now' ? 'Reading now' : 'In your reading list'}
          </span>
        ) : (
          <button onClick={() => onMoveToList(b.id)} className="flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold bg-[#2e5934] text-white hover:bg-[#244729] text-center">
            Add to reading list
          </button>
        )}

        <button onClick={() => onQuotes(b)} className={ICON_BTN} title="View quotes & highlights" aria-label={`Quotes${highlightCount ? ` (${highlightCount})` : ''}`}>
          <Bookmark className="w-4 h-4 text-[#925838]" />
        </button>

        <button
          onClick={() => onRemoveFromDevice(b)}
          className="p-1.5 rounded-lg text-[#706256] dark:text-[#a89a8a] hover:text-red-500"
          title={finished ? 'Remove from my books' : 'Remove from device (stays in Library)'}
          aria-label={finished ? `Remove ${b.title} from my books` : `Remove ${b.title} from device`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
});

/* ---------------- Word Garden ---------------- */

export const WordCard = React.memo(function WordCard({
  word: w, onEdit, onLookup, onToggleLearned, onDelete,
}: {
  word: WordItem;
  onEdit: (w: WordItem) => void;
  onLookup: (word: string) => void;
  onToggleLearned: (id: string) => void;
  onDelete: (w: WordItem) => void;
}) {
  const lowerWord = (w.word || '').toLowerCase();
  const built = Object.hasOwn(BUILTIN_DICTIONARY, lowerWord) ? BUILTIN_DICTIONARY[lowerWord] : undefined;
  const phonetic = w.phonetic || built?.phonetic;
  const pos = w.partOfSpeech || built?.partOfSpeech;

  return (
    <div className={`p-5 rounded-2xl bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] shadow-sm flex flex-col justify-between gap-3 border-l-4 ${w.isLearned ? 'border-l-[#2e5934]' : 'border-l-[#925838]'}`}>
      <div>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => onEdit(w)}
            className="font-serif-display text-2xl sm:text-3xl text-[#201a15] dark:text-[#f0e6d6] hover:underline text-left cursor-pointer"
          >
            {w.word}
          </button>

          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              speakWord(w.word, w.audioUrl);
            }}
            className="p-2 sm:p-2.5 rounded-full text-[#706256] dark:text-[#a89a8a] bg-black/5 dark:bg-white/5 hover:bg-[#e8efe7] hover:text-[#2e5934] active:scale-95 transition-all"
            title="Hear pronunciation"
            aria-label={`Hear pronunciation of ${w.word}`}
          >
            <Volume2 className="w-5 h-5" />
          </button>
        </div>

        {(phonetic || pos) && (
          <div className="text-xs sm:text-sm font-sans text-[#706256] dark:text-[#a89a8a] mt-1 flex items-center gap-1.5">
            {phonetic && <span className="font-mono text-[#2e5934] dark:text-[#86b880]">{phonetic}</span>}
            {pos && <span>· {pos}</span>}
          </div>
        )}

        <p className="text-sm sm:text-base leading-relaxed text-[#201a15] dark:text-[#f0e6d6] mt-2.5">
          {w.definition || built?.definition}
        </p>

        {w.example && (
          <p className="text-xs text-[#706256] dark:text-[#a89a8a] italic mt-1.5">“{w.example}”</p>
        )}

        {(w.quoteSentence || w.bookTitle) && (
          <div className="mt-2.5 pt-2 border-t border-[#e3d7c3] dark:border-[#382f25] text-xs text-[#706256] dark:text-[#a89a8a]">
            {w.quoteSentence && <p className="italic text-[#925838] dark:text-[#d89e70] mb-1">“{w.quoteSentence}”</p>}
            {w.bookTitle && <span className="font-sans font-medium text-[#2e5934] dark:text-[#86b880]">📖 {w.bookTitle}</span>}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-[#e3d7c3] dark:border-[#382f25]">
        <button
          onClick={() => onToggleLearned(w.id)}
          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-all ${
            w.isLearned
              ? 'bg-[#e8efe7] dark:bg-[#243422] text-[#2e5934] dark:text-[#86b880]'
              : 'border border-[#2e5934] text-[#2e5934] dark:text-[#86b880] hover:bg-[#2e5934]/10'
          }`}
        >
          {w.isLearned ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>Learned</span>
            </>
          ) : (
            <span>Mark Learned</span>
          )}
        </button>

        <button
          onClick={() => onEdit(w)}
          className="p-1.5 rounded-lg border border-[#e3d7c3] dark:border-[#382f25] text-[#706256] dark:text-[#a89a8a] hover:text-[#2e5934] dark:hover:text-[#86b880] hover:bg-black/5 flex items-center gap-1"
          title="Edit word, definition or context quote"
          aria-label="Edit word"
        >
          <Edit2 className="w-3.5 h-3.5" />
          <span className="text-[11px] font-medium hidden sm:inline">Edit</span>
        </button>

        <button
          onClick={() => onLookup(w.word)}
          className="p-1.5 rounded-lg border border-[#e3d7c3] dark:border-[#382f25] text-[#706256] dark:text-[#a89a8a] hover:text-[#2e5934] dark:hover:text-[#86b880] hover:bg-black/5"
          title="Apple Look Up & Dictionary"
          aria-label="Look up dictionary"
        >
          <Search className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => onDelete(w)}
          className="p-1.5 rounded-lg text-[#706256] dark:text-[#a89a8a] hover:text-red-500"
          title="Delete word"
          aria-label={`Delete ${w.word}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
});
