import { useRef, useState } from 'react';
import { Check, Pencil, Star, X } from 'lucide-react';
import type { BookHistory } from '../types';
import { formatRating, prettyDate, type HistoryPatch } from '../services/bookHistory';
import { dateKey } from '../services/dates';

const LINE = 'border-[#e3d7c3] dark:border-[#382f25]';
const MUTED = 'text-[#706256] dark:text-[#a89a8a]';

/**
 * "Rate this book", centred. Tap a star for that many stars. Slide a finger (or the arrow keys) for quarter stars, like 4.25.
 * Once rated, the title becomes "Your rating: 4.25 of 5" with an X to take the rating back.
 */
export function RateThisBook({ title, value, onRate }: { title: string; value?: number; onRate: (stars: number) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const [live, setLive] = useState<number | null>(null); // the value shown while a finger is sliding
  const shown = live ?? value ?? 0;

  const at = (clientX: number, whole: boolean) => {
    const r = bar.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    const stars = Math.min(5, Math.max(0, ((clientX - r.left) / r.width) * 5));
    return whole ? Math.max(1, Math.ceil(stars - 1e-9)) : Math.max(0.25, Math.ceil(stars * 4 - 1e-9) / 4);
  };

  return (
    <div className={`px-6 py-5 border-b ${LINE} flex flex-col items-center text-center`}>
      <div className="flex items-center justify-center gap-1.5 min-h-[32px] mb-1">
        <h4 className="font-serif-display text-lg">{value ? `Your rating: ${formatRating(value)} of 5` : 'Rate this book'}</h4>
        {value ? (
          <button type="button" onClick={() => onRate(0)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5" aria-label="Clear your rating" title="Clear your rating">
            <X className={`w-4 h-4 ${MUTED}`} />
          </button>
        ) : null}
      </div>
      <div
        ref={bar}
        role="slider"
        tabIndex={0}
        aria-label={`Your rating of ${title}`}
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuenow={value ?? 0}
        aria-valuetext={value ? `${formatRating(value)} of 5 stars` : 'Not rated'}
        style={{ touchAction: 'pan-y' }}
        className="flex items-center justify-center rounded-xl focus-visible:ring-2 focus-visible:ring-[#2e5934] focus:outline-none select-none cursor-pointer"
        onPointerDown={e => { drag.current = { x: e.clientX, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); }}
        onPointerMove={e => {
          const d = drag.current;
          if (!d) return;
          if (!d.moved && Math.abs(e.clientX - d.x) > 6) d.moved = true;
          if (d.moved) setLive(at(e.clientX, false));
        }}
        onPointerUp={e => {
          const d = drag.current;
          drag.current = null;
          setLive(null);
          if (!d) return;
          const next = d.moved ? at(e.clientX, false) : at(e.clientX, true); // a tap is a whole star; a slide is in quarters
          if (next) onRate(!d.moved && next === value ? 0 : next);
        }}
        onPointerCancel={() => { drag.current = null; setLive(null); }}
        onKeyDown={e => {
          const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.25 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.25 : 0;
          if (!step) return;
          e.preventDefault();
          onRate(Math.min(5, Math.max(0, (value ?? 0) + step)));
        }}
      >
        {[0, 1, 2, 3, 4].map(i => {
          const fill = Math.max(0, Math.min(1, shown - i));
          return (
            <span key={i} className="relative w-11 h-11 flex items-center justify-center" aria-hidden="true">
              <Star className="w-7 h-7 text-[#c9bba4] dark:text-[#5a4d3e]" />
              <span className="absolute inset-y-0 left-0 overflow-hidden flex items-center" style={{ width: fill > 0 ? `${8 + fill * 28}px` : 0 }}>
                <Star className="w-7 h-7 shrink-0 fill-amber-400 text-amber-400 ml-[8px]" />
              </span>
            </span>
          );
        })}
      </div>
      <p className={`mt-1 text-xs ${MUTED}`}>{value ? 'Slide for quarter stars' : 'Tap a star, or slide for quarter stars'}</p>
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
