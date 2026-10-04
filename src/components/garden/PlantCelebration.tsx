import React, { useEffect, useRef } from 'react';
import { getPlantDef, MILESTONE_BY_ID } from '../../data/gardenCatalog';
import type { GardenState } from '../../types';
import { PlantArt } from './PlantArt';

const withArticle = (name: string) => `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;

/** Small prompt shown once, when a plant is newly earned. Reloading or restoring a backup never brings it back. */
export function PlantCelebration({ plantId, garden, onClose }: { plantId: string; garden: GardenState; onClose: () => void }) {
  const def = getPlantDef(plantId);
  const owned = garden.plants[plantId];
  const m = owned ? MILESTONE_BY_ID[owned.milestoneId] : undefined;
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    btn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, plantId]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-plant-title"
        className="plant-arrive w-full max-w-[320px] rounded-2xl border border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17] text-[#201a15] dark:text-[#f0e6d6] shadow-2xl p-5 text-center"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-center mb-2">
          <PlantArt def={def} growth={owned?.growth ?? 0.2} width={84} title={def.name} />
        </div>
        <h3 id="new-plant-title" className="font-serif-display text-xl leading-snug">
          🎉 Congratulations!
        </h3>
        <p className="font-serif-display text-lg text-[#2e5934] dark:text-[#86b880] mt-0.5">{def.name}</p>
        <p className="text-sm text-[#706256] dark:text-[#a89a8a] mt-1.5">
          You got {withArticle(def.name)}{m ? ` for achieving ${m.reason}` : ''}.
        </p>
        <button
          ref={btn}
          type="button"
          onClick={onClose}
          className="mt-4 w-full min-h-[44px] rounded-xl text-sm font-semibold bg-[#2e5934] text-white hover:bg-[#244729] active:scale-95 transition-all"
        >
          Lovely!
        </button>
      </div>
    </div>
  );
}
