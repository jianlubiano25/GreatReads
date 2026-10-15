import React, { useMemo } from 'react';
import type { GardenState } from '../../types';
import { GARDEN_AREAS, MILESTONE_BY_ID, defaultAreaFor, getPlantDef } from '../../data/gardenCatalog';
import { growingMilestones, milestoneProgress, plantsByArea } from '../../services/garden';
import { PlantArt } from './PlantArt';
import { PlantShell } from './PlantShell';
import { DecorItem, useNookDecor } from '../NookDecor';
import { visibleDecor } from '../../services/nookPrefs';
import type { WeatherData } from '../../services/weather';

/**
 * One garden area, drawn from data: the hanging rail above the window and bookshelf, or the shelf below them.
 * Each area scrolls sideways on its own, so the page never gets wider and any number of plants fits.
 * Plants are small memoised SVGs and nothing animates until it is tapped.
 */
export function GardenArea({ garden, night, areaId, weather, live = true }: { garden: GardenState; night: boolean; areaId: string; weather?: WeatherData; live?: boolean }) {
  const decor = useNookDecor();
  const area = GARDEN_AREAS.find(a => a.id === areaId);
  const byArea = useMemo(() => plantsByArea(garden), [garden.plants, garden.placements]);
  const items = byArea[areaId] ?? [];
  const hanging = area?.kind === 'hanging';
  const growing = useMemo(
    () => growingMilestones(garden)
      .map(milestone => ({ milestone, def: getPlantDef(milestone.plantId), progress: milestoneProgress(milestone, garden.peaks) }))
      .filter(item => item.def && defaultAreaFor(item.def) === area?.id),
    [garden.achievements, garden.peaks, area?.id],
  );
  if (!area) return null;

  // Keep the scene clean: the rail only appears once something hangs from it
  if (hanging && items.length === 0 && growing.length === 0) return null;

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

  for (const { milestone, def, progress } of growing) {
    cells.push(
      <PlantShell
        key={`next-${milestone.id}`}
        night={night}
        hanging={hanging}
        label={`${def.emoji} ${def.name} · ${Math.min(progress.value, progress.target).toLocaleString()}/${progress.target.toLocaleString()}`}
        ariaLabel={`${def.name} is growing. Unlocks at ${milestone.unlockLabel}.`}
        title={`${def.name}: unlocks at ${milestone.unlockLabel}`}
      >
        <div style={{ opacity: 0.55 + 0.4 * progress.fraction }}>
          <PlantArt def={def} growth={0.2} mount={area.kind} seedling badge={milestone.badge} title={`${def.name} (growing)`} />
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
            {weather && visibleDecor(decor, 'shelf').map(id => <DecorItem key={id} id={id} decor={decor} weather={weather} dark={night} large={false} live={live} />)}
            {cells}
          </div>
        </div>
      )}
    </div>
  );
}
