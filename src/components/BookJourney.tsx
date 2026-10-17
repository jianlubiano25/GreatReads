import { useState } from 'react';
import { Check, Pencil, Star, X } from 'lucide-react';
import type { BookHistory } from '../types';
import { prettyDate, type HistoryPatch } from '../services/bookHistory';
import { dateKey } from '../services/dates';

const LINE = 'border-[#e3d7c3] dark:border-[#382f25]';
const MUTED = 'text-[#706256] dark:text-[#a89a8a]';

/** "Rate this book": five stars; tap the one you already chose to take the rating back. */
export function RateThisBook({ title, value, onRate }: { title: string; value?: number; onRate: (stars: number) => void }) {
  return (
    <div className={`px-6 py-5 border-b ${LINE}`}>
      <h4 className="font-serif-display text-lg mb-2">Rate this book</h4>
      <div className="flex items-center gap-1" role="group" aria-label={`Your rating of ${title}`}>
        {[1, 2, 3, 4, 5].map(n => {
          const on = !!value && n <= value;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onRate(value === n ? 0 : n)}
              aria-label={`${n} ${n === 1 ? 'star' : 'stars'}${value === n ? ' (tap to clear)' : ''}`}
              aria-pressed={value === n}
              className="w-11 h-11 flex items-center justify-center rounded-full active:scale-90 transition-transform"
            >
              <Star className={`w-7 h-7 ${on ? 'fill-amber-400 text-amber-400' : 'text-[#c9bba4] dark:text-[#5a4d3e]'}`} />
            </button>
          );
        })}
        <span className={`ml-2 text-sm ${MUTED}`}>{value ? `Your rating: ${value} of 5` : 'Tap a star'}</span>
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
