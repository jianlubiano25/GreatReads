import React, { useState } from 'react';

export interface DayInfo { letter: string; pages: number; isGoalMet: boolean; key: string; isToday: boolean }

interface Props { days: DayInfo[]; onSetPages: (dateKey: string, pages: number) => void }

/** Last 7 days. Goal days are filled with a check; tap any day to correct its page count. */
export function DayStrip({ days, onSetPages }: Props) {
  const [sel, setSel] = useState<DayInfo | null>(null);
  const [val, setVal] = useState('');
  const fmt = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <div className="pt-3 border-t border-[#e3d7c3] dark:border-[#382f25]">
      <div className="flex justify-between items-start">
        {days.map(d => (
          <button key={d.key} type="button" onClick={() => { setSel(d); setVal(String(d.pages)); }} className="day flex flex-col items-center gap-1" aria-label={`${fmt(d.key)}: ${d.pages} pages${d.isGoalMet ? ', goal met' : ''}`}>
            <span
              className={`day-dot w-10 h-10 rounded-full border-2 text-sm font-bold flex items-center justify-center ${
                d.isGoalMet ? 'bg-[#2e5934] border-[#2e5934] text-white shadow'
                : d.pages > 0 ? 'border-[#2e5934] text-[#2e5934] dark:text-[#86b880] dark:border-[#86b880]'
                : 'border-[#e3d7c3] dark:border-[#382f25] text-[#706256] dark:text-[#a89a8a]'
              } ${d.isToday ? 'day-today' : ''}`}
            >
              {d.letter}
            </span>
            <span className={`text-xs font-semibold whitespace-nowrap ${d.isGoalMet ? 'text-[#2e5934] dark:text-[#86b880]' : 'text-[#706256] dark:text-[#a89a8a]'}`}>
              {d.isGoalMet ? '✓ ' : ''}{d.pages}
            </span>
          </button>
        ))}
      </div>
      {sel && (
        <div className="mt-3 p-3 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] flex items-center gap-2 flex-wrap">
          <span className="text-sm flex-1 min-w-[140px]">Pages read on {fmt(sel.key)}</span>
          <input type="number" inputMode="numeric" min={0} max={5000} aria-label={`Pages read on ${fmt(sel.key)}`} value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { onSetPages(sel.key, Math.min(5000, Math.max(0, parseInt(val, 10) || 0))); setSel(null); } }} className="w-20 px-2 py-2 rounded-lg border border-[#e3d7c3] dark:border-[#382f25] bg-transparent text-center font-bold" />
          <button type="button" className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#2e5934] text-white" onClick={() => { onSetPages(sel.key, Math.min(5000, Math.max(0, parseInt(val, 10) || 0))); setSel(null); }}>Save</button>
          <button type="button" className="px-3 py-2 rounded-lg text-sm text-[#706256] dark:text-[#a89a8a]" onClick={() => setSel(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
