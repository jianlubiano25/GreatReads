import { useRef, useState } from 'react';
import { Check, Pencil, Star, X } from 'lucide-react';
import type { BookHistory } from '../types';
import { prettyDate, RATING_STEP, snapRating, type HistoryPatch } from '../services/bookHistory';
import { dateKey } from '../services/dates';

const LINE = 'border-[#e3d7c3] dark:border-[#382f25]';
const MUTED = 'text-[#706256] dark:text-[#a89a8a]';

/** How much of star number `index` (0 to 4) is filled for a rating of `value`: 0, 1, or the fraction in between. */
export const starFill = (value: number, index: number): number => Math.min(1, Math.max(0, value - index));

/** The quarter star a pointer at `x` (0 = left edge of the first star, `width` = right edge of the fifth) stands on. Rounds up, so touching a star at all gives at least a quarter. */
export function ratingAt(x: number, width: number): number {
  if (!(width > 0)) return 0;
  const raw = (x / width) * 5;
  return Math.min(5, Math.max(RATING_STEP, Math.ceil(raw / RATING_STEP - 1e-9) * RATING_STEP));
}

/**
 * "Rate this book": five stars in quarter-star steps (0.25 to 5). Tap a spot, swipe across the stars, or press and drag: the stars fill
 * to the exact fraction under your finger while you move, and the rating is saved when you let go. A drag that turns into a scroll is
 * cancelled and saves nothing. Arrow keys move it by a quarter star (Page Up / Down by a whole one) for keyboard and screen reader users.
 */
export function RateThisBook({ title, value, onRate }: { title: string; value?: number; onRate: (stars: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<number | null>(null); // the rating under the finger while it is down (not saved yet)
  const shown = live ?? value ?? 0;

  const at = (clientX: number): number => {
    const r = track.current?.getBoundingClientRect();
    return r ? ratingAt(clientX - r.left, r.width) : 0;
  };
  const step = (delta: number) => onRate(snapRating((value ?? 0) + delta));
  const text = (n: number) => `${n} of 5`;

  return (
    <div className={`px-6 py-5 border-b ${LINE}`}>
      <h4 className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a] mb-2">Rate this book</h4>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label={`Your rating of ${title}`}
          aria-valuemin={0}
          aria-valuemax={5}
          aria-valuenow={value ?? 0}
          aria-valuetext={value ? `${value} stars` : 'Not rated'}
          // pan-y: swiping across the stars is ours, swiping up or down still scrolls the page
          style={{ touchAction: 'pan-y' }}
          className="flex h-11 items-center select-none cursor-pointer rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2e5934]"
          onPointerDown={e => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            e.currentTarget.setPointerCapture?.(e.pointerId); // keep following the finger if it slides above or below the stars
            setLive(at(e.clientX));
          }}
          onPointerMove={e => { if (live !== null) setLive(at(e.clientX)); }}
          onPointerUp={e => {
            if (live === null) return;
            const n = at(e.clientX);
            setLive(null);
            if (n !== (value ?? 0)) onRate(n);
          }}
          onPointerCancel={() => setLive(null)}
          // The sheet behind closes on a pull-down: a swipe that starts on the stars must not count as one
          onTouchStart={e => e.stopPropagation()}
          onTouchMove={e => e.stopPropagation()}
          onTouchEnd={e => e.stopPropagation()}
          onKeyDown={e => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); step(RATING_STEP); }
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); step(-RATING_STEP); }
            else if (e.key === 'PageUp') { e.preventDefault(); step(1); }
            else if (e.key === 'PageDown') { e.preventDefault(); step(-1); }
            else if (e.key === 'Home') { e.preventDefault(); onRate(0); }
            else if (e.key === 'End') { e.preventDefault(); onRate(5); }
          }}
        >
          {[0, 1, 2, 3, 4].map(i => (
            <span key={i} aria-hidden="true" className="relative inline-block w-9 h-9 shrink-0">
              <Star className="absolute inset-0 w-9 h-9 text-[#c9bba4] dark:text-[#5a4d3e]" />
              {starFill(shown, i) > 0 && (
                <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${starFill(shown, i) * 100}%` }}>
                  <Star className="w-9 h-9 max-w-none shrink-0 fill-amber-400 text-amber-400" />
                </span>
              )}
            </span>
          ))}
        </div>
        <span className={`text-sm ${MUTED}`} aria-live="polite">
          {shown ? `Your rating: ${text(shown)}` : 'Tap, swipe or drag across the stars'}
        </span>
        {!!value && live === null && (
          <button type="button" onClick={() => onRate(0)} className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${LINE} ${MUTED} hover:bg-black/5`}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

type DateField = 'added' | 'started' | 'finished';

function DateRow({ label, value, min, emptyText, onSave }: {
  label: string;
  value?: string;
  /** Earliest date allowed (finished cannot be before started) */
  min?: string;
  emptyText: string;
  onSave: (v: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const today = dateKey();
  const bad = !!draft && (draft > today || (!!min && draft < min));

  const open = () => { setDraft(value || ''); setEditing(true); };
  return (
    <div className={`py-2.5 border-b ${LINE}/70 last:border-0`}>
      <div className="flex items-center justify-between gap-3">
        <span className={MUTED}>{label}</span>
        {!editing && (
          <span className="flex items-center gap-2">
            <b className={`font-semibold ${value ? '' : MUTED}`}>{value ? prettyDate(value) : emptyText}</b>
            <button type="button" onClick={open} className="p-1.5 rounded-lg hover:bg-black/5" aria-label={`${value ? 'Edit' : 'Set'} ${label.toLowerCase()} date`}>
              <Pencil className={`w-3.5 h-3.5 ${MUTED}`} />
            </button>
          </span>
        )}
      </div>
      {editing && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={draft}
            min={min}
            max={today}
            onChange={e => setDraft(e.target.value)}
            aria-label={`${label} date`}
            className={`py-1.5 px-2.5 rounded-lg text-sm bg-[#f5f0e6] dark:bg-[#181410] border ${LINE} focus:outline-none`}
          />
          <button
            type="button"
            disabled={!draft || bad}
            onClick={() => { onSave(draft); setEditing(false); }}
            className="p-2 rounded-lg bg-[#2e5934] text-white disabled:opacity-40"
            aria-label="Save date"
          >
            <Check className="w-4 h-4" />
          </button>
          {value && (
            <button type="button" onClick={() => { onSave(null); setEditing(false); }} className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${LINE} ${MUTED}`}>
              Clear
            </button>
          )}
          <button type="button" onClick={() => setEditing(false)} className="p-2 rounded-lg hover:bg-black/5" aria-label="Cancel">
            <X className="w-4 h-4" />
          </button>
          {bad && <span className="basis-full text-xs text-red-600 dark:text-red-400">{draft > today ? 'That date is in the future.' : 'Finished cannot be before you started.'}</span>}
        </div>
      )}
    </div>
  );
}

/** "Your reading": when you added, started and finished the book (all editable) and how many pages you have read. */
export function YourReading({ title, history, status, currentPage, totalPages, onEdit, onProgress }: {
  title: string;
  history?: BookHistory;
  status?: string;
  currentPage: number;
  totalPages: number;
  onEdit: (patch: HistoryPatch) => void;
  onProgress?: (page: number, total?: number) => void;
}) {
  const known = totalPages > 0;
  const pct = known ? Math.min(100, Math.round((currentPage / totalPages) * 100)) : 0;
  const finished = !!history?.finished;
  const set = (f: DateField) => (v: string | null) => onEdit({ [f]: v });

  return (
    <div className={`px-6 py-5 border-b ${LINE}`}>
      <h4 className="font-serif-display text-lg mb-1">Your reading</h4>
      <div className="text-base">
        <DateRow label="Added to list" value={history?.added} emptyText="No date" onSave={set('added')} />
        <DateRow label="Started reading" value={history?.started} emptyText="Not yet" onSave={set('started')} />
        <DateRow label="Finished" value={history?.finished} min={history?.started} emptyText="Not yet" onSave={set('finished')} />
      </div>

      {onProgress && (
        <div className="mt-3 flex flex-col gap-1.5">
          <div className="w-full h-2 rounded-full bg-[#e3d7c3] dark:bg-[#382f25] overflow-hidden">
            <div className="h-full bg-[#2e5934] dark:bg-[#86b880] rounded-full transition-all duration-300" style={{ width: `${finished && known ? 100 : pct}%` }} />
          </div>
          <div className={`flex items-center justify-between text-xs ${MUTED}`}>
            <div className="flex items-center gap-1.5">
              <span>Pages read</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max={known ? totalPages : undefined}
                aria-label={`Pages read of ${title}`}
                key={`p-${currentPage}`}
                defaultValue={currentPage}
                onBlur={e => {
                  const v = Math.max(0, Math.round(Number(e.target.value)) || 0);
                  const clamped = known ? Math.min(totalPages, v) : v;
                  if (clamped !== currentPage) onProgress(clamped, totalPages || undefined);
                }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className={`w-20 px-2 py-1 rounded border ${LINE} bg-transparent text-center font-bold text-[#201a15] dark:text-[#f0e6d6]`}
              />
              {known ? (
                <span>of {totalPages}</span>
              ) : (
                <label className="flex items-center gap-1.5">
                  <span>of</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    placeholder="total"
                    aria-label={`Total pages of ${title}`}
                    onBlur={e => { const n = Math.round(Number(e.target.value)); if (n > 0) onProgress(currentPage, n); }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className={`w-20 px-2 py-1 rounded border ${LINE} bg-transparent text-center text-[#201a15] dark:text-[#f0e6d6]`}
                  />
                </label>
              )}
            </div>
            <span className="font-bold">{known ? `${finished ? 100 : pct}%` : ''}</span>
          </div>
          {known && currentPage >= totalPages && !finished && status !== 'done' && (
            <button
              type="button"
              onClick={() => onEdit({ finished: dateKey() })}
              className="self-start mt-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#2e5934] text-[#2e5934] dark:text-[#86b880] hover:bg-[#2e5934]/10"
            >
              You reached the last page: mark finished today
            </button>
          )}
        </div>
      )}
    </div>
  );
}
