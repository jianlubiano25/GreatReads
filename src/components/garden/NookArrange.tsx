import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ARTS, ART_TEXT_MAX, CLOCKS, DECOR_AREAS, MUGS, getNookDecor, moveDecor, setNookDecor, toggleDecor, type DecorArea, type DecorId, type NookDecor } from '../../services/nookPrefs';
import type { WeatherData } from '../../services/weather';
import { DECOR_LABEL, DecorItem, useNookDecor } from '../NookDecor';

const PREVIEW_WEATHER: WeatherData = { condition: 'clear', period: 'day', isNight: false, description: 'Sunny Reading Day', source: 'time' };
const AREA_LABEL: Record<DecorArea, string> = { wall: '🖼️ Wall (above the shelves)', shelf: '🪴 Garden shelf (below the bookshelf)' };
const MUG_LABEL = { coffee: '☕ Coffee', tea: '🍵 Tea', cocoa: '🍫 Hot chocolate' } as const;
const CLOCK_LABEL = { digital: 'Digital', analog: 'Round' } as const;
const ART_LABEL = { books: 'Books', moon: 'Moon', sunflower: 'Sunflower', hills: 'Hills', heart: 'Heart', words: 'My words' } as const;

const btn = 'min-h-[40px] px-3 rounded-xl text-xs font-semibold border border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17] flex items-center justify-center gap-1 disabled:opacity-40 active:scale-95 transition-all';
const chip = (on: boolean) => `min-h-[36px] px-3 rounded-full text-xs font-semibold border active:scale-95 transition-all ${on ? 'border-[#2e5934] bg-[#e7f0e3] dark:bg-[#1f2d20] ring-1 ring-[#2e5934]' : 'border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17]'}`;

/**
 * Profile -> Achievements & garden -> Arrange your nook: the wall above the shelves and the garden shelf, like Arrange your garden.
 * Tap a decoration, then move it, take it down (it can be put back), or change which one it is. Saved on this device and in backups.
 */
export function NookArrange() {
  const decor = useNookDecor();
  const [selected, setSelected] = useState<DecorId | null>(null);
  const update = (fn: (d: NookDecor) => NookDecor) => setNookDecor(fn(getNookDecor()));
  const sel = selected;
  const selArea = sel ? DECOR_AREAS.find(a => decor.order[a].includes(sel)) : undefined;
  const selIndex = sel && selArea ? decor.order[selArea].indexOf(sel) : -1;
  const selHidden = !!sel && decor.hidden.includes(sel);

  return (
    <section className="px-4 sm:px-5 pt-4" aria-label="Arrange your nook">
      <h4 className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a]">Arrange your nook</h4>
      <p className="text-[11px] text-[#706256] dark:text-[#a89a8a] mt-0.5 mb-2">Tap a decoration, then move it, take it down or change it.</p>

      {DECOR_AREAS.map(area => (
        <div key={area} className="mb-2.5">
          <div className="text-[11px] font-semibold text-[#706256] dark:text-[#a89a8a] mb-1">{AREA_LABEL[area]} · {decor.order[area].filter(id => !decor.hidden.includes(id)).length}</div>
          <div className="no-scrollbar overflow-x-auto rounded-xl border border-[#e3d7c3] dark:border-[#382f25] bg-[#f5f0e6] dark:bg-[#181410]" style={{ borderBottom: area === 'shelf' ? '6px solid #8a5a3b' : undefined }}>
            <div className="flex items-end gap-2 px-3 py-2 w-max min-w-full min-h-[84px]">
              {decor.order[area].length === 0 && <span className="text-[11px] text-[#706256] dark:text-[#a89a8a] self-center">Nothing here. Move a decoration here.</span>}
              {decor.order[area].map(id => {
                const on = id === sel, down = decor.hidden.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${DECOR_LABEL[id]}${down ? ', taken down' : ''}${on ? ', selected' : ''}`}
                    onClick={() => setSelected(on ? null : id)}
                    className={`shrink-0 rounded-lg p-1 transition-all ${on ? 'ring-2 ring-[#2e5934] dark:ring-[#86b880] bg-white/60 dark:bg-white/10' : ''}`}
                    style={{ opacity: down ? 0.35 : 1 }}
                  >
                    <span className="pointer-events-none block"><DecorItem id={id} decor={decor} weather={PREVIEW_WEATHER} dark={false} large={false} live={false} /></span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ))}

      {sel && selArea ? (
        <div className="rounded-2xl border border-[#cfe0cd] dark:border-[#34502f] bg-[#eef4ec] dark:bg-[#1d2a1b] p-3 mt-1" role="group" aria-label={`Change ${DECOR_LABEL[sel]}`}>
          <div className="text-sm font-semibold">{DECOR_LABEL[sel]}{selHidden ? ' · taken down' : ''}</div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button type="button" className={btn} disabled={selIndex <= 0} onClick={() => update(d => moveDecor(d, sel, selArea, selIndex - 1))}><ChevronLeft className="w-4 h-4" /> Move left</button>
            <button type="button" className={btn} disabled={selIndex >= decor.order[selArea].length - 1} onClick={() => update(d => moveDecor(d, sel, selArea, selIndex + 1))}>Move right <ChevronRight className="w-4 h-4" /></button>
            {DECOR_AREAS.filter(a => a !== selArea).map(a => (
              <button key={a} type="button" className={`${btn} col-span-2`} onClick={() => update(d => moveDecor(d, sel, a, d.order[a].length))}>
                {a === 'wall' ? '🖼️ Hang on the wall' : '🪴 Put on the shelf'}
              </button>
            ))}
            <button type="button" className={`${btn} col-span-2`} onClick={() => update(d => toggleDecor(d, sel))}>{selHidden ? 'Put it back' : 'Take it down'}</button>
          </div>

          {sel === 'mug' && <Choices label="Drink" value={decor.mug} items={MUGS} names={MUG_LABEL} onPick={mug => update(d => ({ ...d, mug }))} />}
          {sel === 'clock' && <Choices label="Clock" value={decor.clock} items={CLOCKS} names={CLOCK_LABEL} onPick={clock => update(d => ({ ...d, clock }))} />}
          {sel === 'frame-art' && (
            <>
              <Choices label="Artwork" value={decor.art} items={ARTS} names={ART_LABEL} onPick={art => update(d => ({ ...d, art }))} />
              {decor.art === 'words' && (
                <label className="block mt-2 text-[11px] text-[#706256] dark:text-[#a89a8a]">
                  Words in the frame
                  <input
                    type="text"
                    value={decor.artText}
                    maxLength={ART_TEXT_MAX}
                    onChange={e => update(d => ({ ...d, artText: e.target.value }))}
                    className="mt-1 w-full min-h-[40px] px-3 rounded-xl border border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17] text-sm text-[#201a15] dark:text-[#f0e6d6]"
                  />
                </label>
              )}
            </>
          )}
          {sel === 'frame-thanks' && <p className="mt-2 text-[11px] text-[#706256] dark:text-[#a89a8a]">Always reads “Thank You God”.</p>}
        </div>
      ) : (
        <p className="text-[11px] text-[#706256] dark:text-[#a89a8a]">Select a decoration above to change it.</p>
      )}
    </section>
  );
}

function Choices<T extends string>({ label, value, items, names, onPick }: { label: string; value: T; items: readonly T[]; names: Record<T, string>; onPick: (v: T) => void }) {
  return (
    <div className="mt-2" role="radiogroup" aria-label={label}>
      <div className="text-[11px] font-semibold text-[#706256] dark:text-[#a89a8a] mb-1">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map(v => <button key={v} type="button" role="radio" aria-checked={value === v} className={chip(value === v)} onClick={() => onPick(v)}>{names[v]}</button>)}
      </div>
    </div>
  );
}
