import React, { useMemo, useState } from 'react';
import { X, Lock, ChevronLeft, ChevronRight } from 'lucide-react';
import type { GardenState } from '../../types';
import { GARDEN_AREAS, MILESTONES, MILESTONE_BY_ID, canPlaceIn, getPlantDef } from '../../data/gardenCatalog';
import { milestoneProgress, plantsByArea } from '../../services/garden';
import { PlantArt } from './PlantArt';

interface Props {
  garden: GardenState;
  onMovePlant: (plantId: string, areaId: string, index: number) => void;
  onClose: () => void;
}

/**
 * Profile -> Achievements & garden.
 *  1. Arrange: tap a plant, then move it left/right or between the hanging rail and the shelf.
 *  2. Every plant milestone, earned or locked, with the real artwork and what earns it.
 * Rearranging only changes WHERE a plant stands. What you have earned never changes.
 */
export function AchievementsModal({ garden, onMovePlant, onClose }: Props) {
  const earnedCount = MILESTONES.filter(m => garden.achievements[m.id]).length;
  const byArea = useMemo(() => plantsByArea(garden), [garden.plants, garden.placements]);
  const [selected, setSelected] = useState<string | null>(null);

  const sel = selected && garden.plants[selected] ? selected : null;
  const selDef = sel ? getPlantDef(sel) : null;
  const selOwned = sel ? garden.plants[sel] : null;
  const selMilestone = selOwned ? MILESTONE_BY_ID[selOwned.milestoneId] : undefined;
  const selArea = sel ? GARDEN_AREAS.find(a => (byArea[a.id] ?? []).some(p => p.plantId === sel)) : undefined;
  const selIndex = sel && selArea ? byArea[selArea.id].findIndex(p => p.plantId === sel) : -1;
  const selCount = selArea ? byArea[selArea.id].length : 0;

  const btn = 'min-h-[40px] px-3 rounded-xl text-xs font-semibold border border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17] flex items-center justify-center gap-1 disabled:opacity-40 active:scale-95 transition-all';

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Achievements and garden"
        className="relative w-full max-w-[520px] max-h-[94dvh] sm:max-h-[90dvh] bg-[#fbf7ee] dark:bg-[#231d17] text-[#201a15] dark:text-[#f0e6d6] rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-y-auto overscroll-contain flex flex-col border border-[#e3d7c3] dark:border-[#382f25]"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-20 px-5 py-4 bg-[#fbf7ee]/95 dark:bg-[#231d17]/95 backdrop-blur-md border-b border-[#e3d7c3] dark:border-[#382f25] flex items-center justify-between">
          <div>
            <h3 className="font-serif-display text-xl">Achievements &amp; garden</h3>
            <p className="text-xs text-[#706256] dark:text-[#a89a8a]">{earnedCount} of {MILESTONES.length} plants earned · they stay in your garden for good</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close achievements" className="p-1.5 rounded-full text-[#706256] dark:text-[#a89a8a] hover:bg-black/10 dark:hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ---------- Arrange ---------- */}
        <section className="px-4 sm:px-5 pt-4" aria-label="Arrange your garden">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a]">Arrange your garden</h4>
          <p className="text-[11px] text-[#706256] dark:text-[#a89a8a] mt-0.5 mb-2">
            Tap a plant, then move it. Where a plant stands never changes whether you earned it.
          </p>

          {GARDEN_AREAS.map(area => {
            const list = byArea[area.id] ?? [];
            return (
              <div key={area.id} className="mb-2.5">
                <div className="text-[11px] font-semibold text-[#706256] dark:text-[#a89a8a] mb-1">
                  {area.kind === 'hanging' ? '🪢 Hanging rail (above the window)' : '🪴 Garden shelf (below the bookshelf)'} · {list.length}
                </div>
                <div
                  className="no-scrollbar overflow-x-auto rounded-xl border border-[#e3d7c3] dark:border-[#382f25] bg-[#f5f0e6] dark:bg-[#181410]"
                  style={{ borderBottom: area.kind === 'shelf' ? '6px solid #8a5a3b' : undefined, borderTop: area.kind === 'hanging' ? '5px solid #8a5a3b' : undefined }}
                >
                  <div className="flex items-end gap-0 px-3 pt-2 pb-1 w-max min-w-full min-h-[84px]" style={area.kind === 'hanging' ? { alignItems: 'flex-start', paddingTop: 8 } : undefined}>
                    {list.length === 0 && (
                      <span className="text-[11px] text-[#706256] dark:text-[#a89a8a] self-center">
                        {area.kind === 'hanging' ? 'Nothing hanging yet. Move a plant here to hang it.' : 'Nothing on the shelf yet.'}
                      </span>
                    )}
                    {list.map(it => {
                      const def = getPlantDef(it.plantId);
                      const on = it.plantId === sel;
                      return (
                        <button
                          key={it.plantId}
                          type="button"
                          aria-pressed={on}
                          aria-label={`${def.name}${on ? ', selected' : ''}`}
                          onClick={() => setSelected(on ? null : it.plantId)}
                          className={`shrink-0 rounded-lg px-0 mx-[-4px] transition-all ${on ? 'ring-2 ring-[#2e5934] dark:ring-[#86b880] bg-white/60 dark:bg-white/10 z-10' : ''}`}
                        >
                          <PlantArt def={def} growth={garden.plants[it.plantId].growth} mount={area.kind} width={44} title={def.name} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}

          {sel && selDef && selOwned && selArea ? (
            <div className="rounded-2xl border border-[#cfe0cd] dark:border-[#34502f] bg-[#eef4ec] dark:bg-[#1d2a1b] p-3 mt-1" role="group" aria-label={`Move ${selDef.name}`}>
              <div className="text-sm font-semibold">{selDef.emoji} {selDef.name}</div>
              <div className="text-[11px] text-[#2e5934] dark:text-[#86b880]">
                Earned from {selMilestone?.earnedLabel ?? 'your reading'} · {selOwned.completedAt ? 'fully grown' : `${Math.round(selOwned.growth * 100)}% grown`}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button type="button" className={btn} disabled={selIndex <= 0} onClick={() => onMovePlant(sel, selArea.id, selIndex - 1)}>
                  <ChevronLeft className="w-4 h-4" /> Move left
                </button>
                <button type="button" className={btn} disabled={selIndex >= selCount - 1} onClick={() => onMovePlant(sel, selArea.id, selIndex + 1)}>
                  Move right <ChevronRight className="w-4 h-4" />
                </button>
                {GARDEN_AREAS.filter(a => a.id !== selArea.id).map(a => (
                  <button
                    key={a.id}
                    type="button"
                    className={`${btn} col-span-2`}
                    disabled={!canPlaceIn(selDef, a.id)}
                    onClick={() => onMovePlant(sel, a.id, (byArea[a.id] ?? []).length)}
                  >
                    {a.kind === 'hanging' ? '🪢 Hang on the rail' : '🪴 Put on the shelf'}
                    {!canPlaceIn(selDef, a.id) && <span className="font-normal opacity-80"> (vines only hang)</span>}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-[#706256] dark:text-[#a89a8a]">Select a plant above to move it.</p>
          )}
        </section>

        {/* ---------- All achievements ---------- */}
        <section className="px-4 sm:px-5 pt-4 pb-5" aria-label="All plant achievements">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a] mb-2">All plants</h4>
          <ul className="grid grid-cols-2 gap-3">
            {MILESTONES.map(m => {
              const def = getPlantDef(m.plantId);
              const owned = garden.plants[m.plantId];
              const earned = !!garden.achievements[m.id] && !!owned;
              const prog = milestoneProgress(m, garden.peaks);
              return (
                <li
                  key={m.id}
                  className={`rounded-2xl border p-3 flex flex-col items-center text-center gap-1 ${
                    earned ? 'border-[#cfe0cd] dark:border-[#34502f] bg-[#eef4ec] dark:bg-[#1d2a1b]' : 'border-[#e3d7c3] dark:border-[#382f25] bg-[#f5f0e6] dark:bg-[#181410]'
                  }`}
                >
                  <div className="h-[92px] flex items-end justify-center" style={earned ? undefined : { opacity: 0.45, filter: 'grayscale(0.85)' }}>
                    <PlantArt def={def} growth={earned ? owned.growth : 0.7} width={60} title={`${def.name}${earned ? '' : ' (locked)'}`} />
                  </div>
                  <div className="text-sm font-semibold leading-tight">{def.emoji} {def.name}</div>
                  {earned ? (
                    <>
                      <div className="text-[11px] leading-snug text-[#2e5934] dark:text-[#86b880]">Earned from {m.earnedLabel}</div>
                      <div className="text-[10px] text-[#706256] dark:text-[#a89a8a]">{owned.completedAt ? 'Fully grown' : `${Math.round(owned.growth * 100)}% grown`}</div>
                    </>
                  ) : (
                    <>
                      <div className="text-[11px] leading-snug text-[#706256] dark:text-[#a89a8a] flex items-center gap-1">
                        <Lock className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span>Unlocks at {m.unlockLabel}</span>
                      </div>
                      <div
                        className="w-full h-1.5 rounded-full bg-[#e3d7c3] dark:bg-[#382f25] overflow-hidden"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={prog.target}
                        aria-valuenow={Math.min(prog.value, prog.target)}
                        aria-label={`Progress to ${m.unlockLabel}`}
                      >
                        <div className="h-full bg-[#2e5934] dark:bg-[#86b880]" style={{ width: `${Math.round(prog.fraction * 100)}%` }} />
                      </div>
                      <div className="text-[10px] text-[#706256] dark:text-[#a89a8a]">{Math.min(prog.value, prog.target).toLocaleString()} / {prog.target.toLocaleString()}</div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
