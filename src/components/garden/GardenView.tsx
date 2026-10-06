import React, { useMemo } from 'react';
import type { GardenState } from '../../types';
import { GARDEN_AREAS, MILESTONE_BY_ID, defaultAreaFor, getPlantDef } from '../../data/gardenCatalog';
import { milestoneProgress, nextMilestone, plantsByArea } from '../../services/garden';
import { PlantArt } from './PlantArt';
import { PlantShell } from './PlantShell';

function Coffee() {
  return (
    <div className="flex flex-col items-center shrink-0 cursor-default select-none" title="A warm cup of coffee" style={{ marginRight: 4 }}>
      <svg width={30} height={18} viewBox="0 0 30 18" aria-hidden="true">
        {[6, 13, 20].map((x, i) => (
          <path key={i} d={`M${x} 16 q-3 -5 0 -9 q3 -4 0 -7`} stroke="#a89a8a" strokeWidth={1.4} fill="none" strokeLinecap="round" opacity={0.7} className={`steam-${i}`} />
        ))}
      </svg>
      <div style={{ width: 30, height: 22, background: '#fbf7ee', border: '2px solid #cfbe9f', borderRadius: '2px 2px 12px 12px', position: 'relative' }}>
        <div style={{ position: 'absolute', right: -9, top: 3, width: 9, height: 11, border: '2px solid #cfbe9f', borderLeft: 0, borderRadius: '0 8px 8px 0' }} />
        <div style={{ margin: '2px 3px', height: 4, background: '#523724', borderRadius: 4 }} />
      </div>
    </div>
  );
}

/**
 * One garden area, drawn from data: the hanging rail above the window and bookshelf, or the shelf below them.
 * Each area scrolls sideways on its own, so the page never gets wider and any number of plants fits.
 * Plants are small memoised SVGs and nothing animates until it is tapped.
 */
export function GardenArea({ garden, night, areaId }: { garden: GardenState; night: boolean; areaId: string }) {
  const area = GARDEN_AREAS.find(a => a.id === areaId);
  const byArea = useMemo(() => plantsByArea(garden), [garden.plants, garden.placements]);
  if (!area) return null;

  const items = byArea[area.id] ?? [];
  const hanging = area.kind === 'hanging';

  // The plant that is "growing" next stands (as a seedling) in the area it will live in
  const next = nextMilestone(garden);
  const nextDef = next ? getPlantDef(next.plantId) : undefined;
  const showSeedling = !!next && !!nextDef && defaultAreaFor(nextDef) === area.id;
  const progress = next ? milestoneProgress(next, garden.peaks) : undefined;

  // Keep the scene clean: the rail only appears once something hangs from it
  if (hanging && items.length === 0 && !showSeedling) return null;

  const cells = items.map(it => {
    const def = getPlantDef(it.plantId);
    const owned = garden.plants[it.plantId];
    const m = MILESTONE_BY_ID[owned.milestoneId];
    const done = !!owned.completedAt;
    return (
      <PlantShell
        key={it.plantId}
        night={night}
        hanging={hanging}
        label={`${def.emoji} ${def.name}`}
        ariaLabel={`${def.name}${done ? ', fully grown' : ''}. Tap to sway.`}
        title={`${def.name}${m ? ` · ${m.earnedLabel}` : ''}`}
      >
        <PlantArt def={def} growth={owned.growth} mount={area.kind} title={def.name} />
      </PlantShell>
    );
  });

  if (showSeedling && next && nextDef && progress) {
    cells.push(
      <PlantShell
        key={`next-${next.id}`}
        night={night}
        hanging={hanging}
        label={`${nextDef.emoji} ${nextDef.name} · ${Math.min(progress.value, progress.target).toLocaleString()}/${progress.target.toLocaleString()}`}
        ariaLabel={`${nextDef.name} is growing. Unlocks at ${next.unlockLabel}.`}
        title={`${nextDef.name}: unlocks at ${next.unlockLabel}`}
      >
        <div style={{ opacity: 0.55 + 0.4 * progress.fraction }}>
          <PlantArt def={nextDef} growth={0.2} mount={area.kind} seedling badge={next.badge} title={`${nextDef.name} (growing)`} />
        </div>
      </PlantShell>,
    );
  }

  return (
    <div
      className={`garden-scroll no-scrollbar ${hanging ? 'garden-scroll-top' : 'garden-scroll-bottom'}`}
      role="region"
      aria-label={`${area.label}. Scroll sideways to see all your plants.`}
      tabIndex={0}
    >
      {hanging ? (
        <div className="garden-rows garden-hang">
          <div className="garden-rail" />
          <div className="garden-row garden-row-hang">{cells}</div>
        </div>
      ) : (
        <div className="garden-rows">
          <div className="garden-row garden-row-shelf">
            <Coffee />
            {cells}
          </div>
        </div>
      )}
    </div>
  );
}
