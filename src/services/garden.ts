/**
 * Garden logic. Pure functions only (no React, no storage) so it is easy to test and reuse.
 *
 * Two kinds of progress:
 *  - READING-LOG progress (best streak, 10+ page days, biggest day, best week, total pages) is always worked out
 *    from the pages you have logged. A streak that ended still counts (it is your best), but if you correct a page
 *    count (say a typo of 500 pages) the plants and growth it earned are taken back, because that reading never happened.
 *  - Everything else (books finished, highlights, words) is a high-water mark that only goes up, so removing a
 *    word or a highlight never takes a plant away.
 */
import { dateKey, dayNumber } from './dates';
import type { BookStatus, GardenPeaks, GardenState, HighlightItem, PlantPlacement, WordItem } from '../types';
import { INITIAL_WORDS } from '../data/defaultWords';
import {
  MILESTONES,
  MILESTONE_BY_ID,
  GARDEN_AREAS,
  isLiveMetric,
  canPlaceIn,
  defaultAreaFor,
  getPlantDef,
  metricValue,
  type MilestoneDef,
} from '../data/gardenCatalog';

const MAX_STREAK_DAYS = 3650;
const BASE_GROWTH = 0.2; // a freshly earned plant is never fully grown

export const todayKeyNow = (): string => dateKey();

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function emptyPeaks(): GardenPeaks {
  return { bestStreak: 0, tenPageDays: 0, maxPagesInDay: 0, bestWeekGoalDays: 0, booksFinished: 0, totalPages: 0, highlights: 0, wordsAdded: 0, wordsLearned: 0 };
}

export function emptyGarden(): GardenState {
  return { v: 1, peaks: emptyPeaks(), achievements: {}, plants: {}, placements: {}, celebrated: {}, vine: 0 };
}

// ---------------------------------------------------------------------------------------------
// Reading history -> numbers
// ---------------------------------------------------------------------------------------------

const keyToLocalDate = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

/** Consecutive goal-met days ending today (or yesterday when today is not met yet). */
export function currentStreakFor(dailyLog: Record<string, number>, goal: number, todayKey: string): number {
  let count = 0;
  const check = keyToLocalDate(todayKey);
  if ((dailyLog[todayKey] || 0) < goal) check.setDate(check.getDate() - 1);
  while (count < MAX_STREAK_DAYS) {
    const k = dateKey(check);
    if ((dailyLog[k] || 0) >= goal) {
      count++;
      check.setDate(check.getDate() - 1);
    } else break;
  }
  return count;
}

/** Sorted day numbers of every day that met the goal. A goal change applies to every day, past and present. */
function metDays(dailyLog: Record<string, number>, goal: number): number[] {
  return Object.keys(dailyLog)
    .filter(k => (Number(dailyLog[k]) || 0) >= goal)
    .map(dayNumber)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

/** Longest run of consecutive goal-met days anywhere in the log. */
export function bestStreakFor(dailyLog: Record<string, number>, goal: number): number {
  let best = 0;
  let run = 0;
  let prev = NaN;
  for (const d of metDays(dailyLog, goal)) {
    run = d === prev + 1 ? run + 1 : d === prev ? run : 1;
    prev = d;
    if (run > best) best = run;
  }
  return best;
}

/** Most goal-met days inside any 7-day window of the log (so it reflects real history, not only this week). */
export function bestWeekFor(dailyLog: Record<string, number>, goal: number): number {
  const days = metDays(dailyLog, goal);
  let best = 0;
  let lo = 0;
  for (let hi = 0; hi < days.length; hi++) {
    while (days[hi] - days[lo] > 6) lo++;
    if (hi - lo + 1 > best) best = hi - lo + 1;
  }
  return best;
}

export interface GardenSnapshot {
  streak: number;
  bestStreak: number;
  tenPageDays: number;
  maxPagesInDay: number;
  weekGoalDays: number; // best 7-day window in the whole log
  booksFinished: number;
  totalPages: number;
  highlights: number;
  wordsAdded: number;
  wordsLearned: number;
}

// The three starter words that ship with the app do not count as words you added or learned.
const BUILTIN_WORD_IDS = new Set(INITIAL_WORDS.map(w => w.id));

export function computeSnapshot(input: {
  dailyLog: Record<string, number>;
  goal: number;
  status: Record<string, BookStatus>;
  todayKey: string;
  highlights?: Record<string, HighlightItem[]>;
  words?: WordItem[];
}): GardenSnapshot {
  const { dailyLog, goal, status, todayKey } = input;
  let highlights = 0;
  for (const list of Object.values(input.highlights ?? {})) if (Array.isArray(list)) highlights += list.length;
  const mine = (input.words ?? []).filter(w => !BUILTIN_WORD_IDS.has(w.id));
  let tenPageDays = 0;
  let maxPagesInDay = 0;
  let totalPages = 0;
  for (const k of Object.keys(dailyLog)) {
    const n = Math.max(0, Number(dailyLog[k]) || 0);
    if (n >= 10) tenPageDays++;
    if (n > maxPagesInDay) maxPagesInDay = n;
    totalPages += n;
  }
  return {
    streak: currentStreakFor(dailyLog, goal, todayKey),
    bestStreak: bestStreakFor(dailyLog, goal),
    tenPageDays,
    maxPagesInDay,
    weekGoalDays: bestWeekFor(dailyLog, goal),
    booksFinished: Object.values(status).filter(s => s === 'done').length,
    totalPages,
    highlights,
    wordsAdded: mine.length,
    wordsLearned: mine.filter(w => w.isLearned).length,
  };
}

// ---------------------------------------------------------------------------------------------
// Growth + awarding
// ---------------------------------------------------------------------------------------------

export const vineFor = (peaks: GardenPeaks): number =>
  Math.min(1, 0.12 + (peaks.bestStreak + peaks.booksFinished * 0.7) / 12);

/** Growth (0.2..1) of an earned plant for the given peaks. */
export function growthFor(m: MilestoneDef, peaks: GardenPeaks): number {
  const { metric, from, to } = m.grow;
  const v = metricValue(peaks, metric);
  if (to <= from) return v >= from ? 1 : BASE_GROWTH;
  return clamp01(BASE_GROWTH + (1 - BASE_GROWTH) * ((v - from) / (to - from)));
}

export function milestoneProgress(m: MilestoneDef, peaks: GardenPeaks): { value: number; target: number; fraction: number } {
  const target = m.unlock.at;
  const value = metricValue(peaks, m.unlock.metric);
  return { value, target, fraction: target <= 0 ? 1 : clamp01(value / target) };
}

/** Next free slot in an area (used when a plant is first placed). */
function nextSlot(placements: Record<string, PlantPlacement>, areaId: string): number {
  let max = -1;
  for (const p of Object.values(placements)) if (p.areaId === areaId && p.slot > max) max = p.slot;
  return max + 1;
}

/**
 * Bring the garden up to date with the reading history.
 *  - reading-log numbers are taken as they are NOW (so fixing a typo'd page count takes its plants and growth back);
 *    book / highlight / word numbers are high-water marks that only go up;
 *  - awards every milestone that is reached (each once), and removes a plant ONLY when the logged pages that
 *    earned it no longer exist;
 *  - returns the SAME object when nothing changed, so callers can skip a state update.
 * `silent` awards without queuing the "new plant" prompt (first-time seeding, restoring a backup).
 */
export function evaluateGarden(
  garden: GardenState,
  snap: GardenSnapshot,
  now: number = Date.now(),
  opts: { silent?: boolean } = {},
): GardenState {
  const prevPeaks = garden.peaks;
  const peaks: GardenPeaks = {
    // from the reading log: exactly what the log says today
    bestStreak: Math.max(snap.bestStreak, snap.streak),
    tenPageDays: snap.tenPageDays,
    maxPagesInDay: snap.maxPagesInDay,
    bestWeekGoalDays: snap.weekGoalDays,
    totalPages: snap.totalPages,
    // everything else only goes up
    booksFinished: Math.max(prevPeaks.booksFinished, snap.booksFinished),
    highlights: Math.max(prevPeaks.highlights, snap.highlights),
    wordsAdded: Math.max(prevPeaks.wordsAdded, snap.wordsAdded),
    wordsLearned: Math.max(prevPeaks.wordsLearned, snap.wordsLearned),
  };
  const peaksChanged = (Object.keys(peaks) as (keyof GardenPeaks)[]).some(k => peaks[k] !== prevPeaks[k]);

  let achievements = garden.achievements;
  let plants = garden.plants;
  let placements = garden.placements;
  let celebrated = garden.celebrated;
  let changed = peaksChanged;

  // 1) take back plants whose reading-log milestone is no longer reached (a corrected page count)
  for (const [mid, award] of Object.entries(achievements)) {
    const m = MILESTONE_BY_ID[mid];
    if (!m || !isLiveMetric(m.unlock.metric)) continue; // unknown or sticky milestone: it stays
    if (metricValue(peaks, m.unlock.metric) >= m.unlock.at) continue;
    changed = true;
    const { [mid]: _gone, ...rest } = achievements;
    achievements = rest;
    const stillOwned = Object.values(achievements).some(a => a.plantId === award.plantId);
    if (!stillOwned && plants[award.plantId]) {
      const { [award.plantId]: _p, ...restPlants } = plants;
      plants = restPlants;
      const { [award.plantId]: _pl, ...restPlacements } = placements;
      placements = restPlacements;
      const { [award.plantId]: _c, ...restCelebrated } = celebrated;
      celebrated = restCelebrated;
    }
  }

  // 2) award newly reached milestones (idempotent: keyed by milestone id and plant id)
  for (const m of MILESTONES) {
    if (achievements[m.id]) continue;
    if (metricValue(peaks, m.unlock.metric) < m.unlock.at) continue;
    changed = true;
    achievements = { ...achievements, [m.id]: { earnedAt: now, plantId: m.plantId } };
    if (!plants[m.plantId]) {
      plants = { ...plants, [m.plantId]: { milestoneId: m.id, earnedAt: now, growth: BASE_GROWTH } };
      if (!placements[m.plantId]) {
        const areaId = defaultAreaFor(getPlantDef(m.plantId));
        placements = { ...placements, [m.plantId]: { areaId, slot: nextSlot(placements, areaId) } };
      }
      if (m.silent || opts.silent) celebrated = { ...celebrated, [m.plantId]: true };
    }
  }

  // 3) grow / shrink / complete owned plants. Growth that comes from the reading log follows the log;
  //    growth that comes from books, highlights or words never goes down.
  for (const [plantId, owned] of Object.entries(plants)) {
    const m = MILESTONE_BY_ID[owned.milestoneId];
    if (!m) continue; // milestone removed from the catalog later: the plant simply stays as it is
    const target = growthFor(m, peaks);
    const g = isLiveMetric(m.grow.metric) ? target : Math.max(owned.growth, target);
    const completeNow = g >= 1 && !owned.completedAt;
    const reopen = g < 1 && !!owned.completedAt && isLiveMetric(m.grow.metric);
    if (g !== owned.growth || completeNow || reopen) {
      changed = true;
      const { completedAt: _done, ...base } = owned;
      const keepDone = owned.completedAt && !reopen ? { completedAt: owned.completedAt } : {};
      plants = { ...plants, [plantId]: { ...base, growth: g, ...keepDone, ...(completeNow ? { completedAt: now } : {}) } };
    }
  }

  // 4) the window vine follows the same rules (log-based part is live)
  const vine = vineFor(peaks);
  if (vine !== garden.vine) changed = true;

  if (!changed) return garden;
  return { ...garden, peaks, achievements, plants, placements, celebrated, vine };
}

/** Build a garden from existing history without any celebration (old saves, old backups, fresh installs). */
export function seedGarden(input: Parameters<typeof computeSnapshot>[0]): GardenState {
  return evaluateGarden(emptyGarden(), computeSnapshot(input), Date.now(), { silent: true });
}

// ---------------------------------------------------------------------------------------------
// Celebrations and "what is growing next"
// ---------------------------------------------------------------------------------------------

/** Owned plants whose "new plant" prompt has not been shown yet, oldest first. */
export function pendingCelebrations(garden: GardenState): string[] {
  return Object.entries(garden.plants)
    .filter(([id]) => !garden.celebrated[id])
    .sort((a, b) => a[1].earnedAt - b[1].earnedAt)
    .map(([id]) => id);
}

export function markCelebrated(garden: GardenState, plantIds: string[]): GardenState {
  const fresh = plantIds.filter(id => !garden.celebrated[id]);
  if (!fresh.length) return garden;
  const celebrated = { ...garden.celebrated };
  for (const id of fresh) celebrated[id] = true;
  return { ...garden, celebrated };
}

export function growingMilestones(garden: GardenState): MilestoneDef[] {
  const seen = new Set<string>();
  const milestones: MilestoneDef[] = [];
  for (const milestone of MILESTONES) {
    if (garden.achievements[milestone.id] || seen.has(milestone.unlock.metric)) continue;
    seen.add(milestone.unlock.metric);
    milestones.push(milestone);
  }
  return milestones
    .map(milestone => ({ milestone, fraction: milestoneProgress(milestone, garden.peaks).fraction }))
    .sort((a, b) => b.fraction - a.fraction || a.milestone.order - b.milestone.order)
    .map(entry => entry.milestone);
}

export interface PlacedPlant {
  plantId: string;
  areaId: string;
  slot: number;
  earnedAt: number;
}

/** Owned plants grouped by area, in display order. A missing/unknown placement falls back to the plant's default area. */
export function plantsByArea(garden: GardenState): Record<string, PlacedPlant[]> {
  const out: Record<string, PlacedPlant[]> = {};
  for (const a of GARDEN_AREAS) out[a.id] = [];
  const fallbackArea = GARDEN_AREAS[GARDEN_AREAS.length - 1].id;
  for (const [plantId, owned] of Object.entries(garden.plants)) {
    const def = getPlantDef(plantId);
    const pl = garden.placements[plantId];
    const valid = !!pl && !!out[pl.areaId] && canPlaceIn(def, pl.areaId);
    const areaId = valid ? pl.areaId : out[defaultAreaFor(def)] ? defaultAreaFor(def) : fallbackArea;
    out[areaId].push({ plantId, areaId, slot: valid ? pl.slot : Number.MAX_SAFE_INTEGER, earnedAt: owned.earnedAt });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.slot - b.slot || a.earnedAt - b.earnedAt);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Arranging (Placement only: never touches achievements, growth or what you own)
// ---------------------------------------------------------------------------------------------

/**
 * Move an owned plant to `index` in `areaId` (0 = first). Everything else keeps its relative order.
 * Returns the same object when the move is not allowed or changes nothing.
 */
export function movePlant(garden: GardenState, plantId: string, areaId: string, index: number): GardenState {
  if (!garden.plants[plantId]) return garden;
  if (!canPlaceIn(getPlantDef(plantId), areaId)) return garden;
  const lists = plantsByArea(garden);
  const from = Object.values(lists).flat().find(p => p.plantId === plantId);
  if (!from) return garden;

  const target = lists[areaId].filter(p => p.plantId !== plantId);
  const at = Math.max(0, Math.min(target.length, Math.round(index)));
  const sameArea = from.areaId === areaId;
  if (sameArea && lists[areaId][at]?.plantId === plantId) return garden;

  const placements: Record<string, PlantPlacement> = { ...garden.placements };
  const renumber = (area: string, ids: string[]) => ids.forEach((id, slot) => { placements[id] = { areaId: area, slot }; });
  target.splice(at, 0, from);
  renumber(areaId, target.map(p => p.plantId));
  if (!sameArea) renumber(from.areaId, lists[from.areaId].filter(p => p.plantId !== plantId).map(p => p.plantId));
  return { ...garden, placements };
}
