/**
 * Garden logic. Pure functions only (no React, no storage) so it is easy to test and reuse.
 *
 * The one rule everything here follows: PROGRESS ONLY GOES UP.
 * Plants, achievements, growth and the vine are stored as high-water marks, so a streak reset,
 * an edited day or a deleted book can never take anything away.
 */
import type { BookStatus, GardenPeaks, GardenState, HighlightItem, PlantPlacement, WordItem } from '../types';
import { INITIAL_WORDS } from '../data/defaultWords';
import {
  MILESTONES,
  MILESTONE_BY_ID,
  GARDEN_AREAS,
  canPlaceIn,
  defaultAreaFor,
  getPlantDef,
  metricValue,
  type MilestoneDef,
} from '../data/gardenCatalog';

const MAX_STREAK_DAYS = 3650;
const BASE_GROWTH = 0.2; // a freshly earned plant is never fully grown
const DAY_MS = 86_400_000;

export const todayKeyNow = (): string => new Date().toLocaleDateString('en-CA');

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

/** Consecutive goal-met days ending today (or yesterday when today is not met yet). Same rule the app always used. */
export function currentStreakFor(dailyLog: Record<string, number>, goal: number, todayKey: string): number {
  let count = 0;
  const check = keyToLocalDate(todayKey);
  if ((dailyLog[todayKey] || 0) < goal) check.setDate(check.getDate() - 1);
  while (count < MAX_STREAK_DAYS) {
    const k = check.toLocaleDateString('en-CA');
    if ((dailyLog[k] || 0) >= goal) {
      count++;
      check.setDate(check.getDate() - 1);
    } else break;
  }
  return count;
}

/** Longest run of consecutive goal-met days anywhere in the log. */
export function bestStreakFor(dailyLog: Record<string, number>, goal: number): number {
  const days = Object.keys(dailyLog)
    .filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k) && (dailyLog[k] || 0) >= goal)
    .map(k => Math.round(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) / DAY_MS))
    .sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev = NaN;
  for (const d of days) {
    run = d === prev + 1 ? run + 1 : d === prev ? run : 1;
    prev = d;
    if (run > best) best = run;
  }
  return best;
}

/** Goal-met days among the last 7 days (today included), matching the 7-day dots in the app. */
export function goalDaysInLast7(dailyLog: Record<string, number>, goal: number, todayKey: string): number {
  let n = 0;
  const d = keyToLocalDate(todayKey);
  for (let i = 0; i < 7; i++) {
    if ((dailyLog[d.toLocaleDateString('en-CA')] || 0) >= goal) n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export interface GardenSnapshot {
  streak: number;
  bestStreak: number;
  tenPageDays: number;
  maxPagesInDay: number;
  weekGoalDays: number;
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
    const n = Number(dailyLog[k]) || 0;
    if (n >= 10) tenPageDays++;
    if (n > maxPagesInDay) maxPagesInDay = n;
    totalPages += n;
  }
  return {
    streak: currentStreakFor(dailyLog, goal, todayKey),
    bestStreak: bestStreakFor(dailyLog, goal),
    tenPageDays,
    maxPagesInDay,
    weekGoalDays: goalDaysInLast7(dailyLog, goal, todayKey),
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
 *  - raises the high-water marks, awards every milestone that is now reached (each only once),
 *    grows owned plants, completes them, and grows the vine;
 *  - never removes or lowers anything;
 *  - returns the SAME object when nothing changed, so callers can skip a state update.
 * `silent` awards without queuing the "new plant" prompt (first-time seeding from old data).
 */
export function evaluateGarden(
  garden: GardenState,
  snap: GardenSnapshot,
  now: number = Date.now(),
  opts: { silent?: boolean } = {},
): GardenState {
  const prevPeaks = garden.peaks;
  const peaks: GardenPeaks = {
    bestStreak: Math.max(prevPeaks.bestStreak, snap.bestStreak, snap.streak),
    tenPageDays: Math.max(prevPeaks.tenPageDays, snap.tenPageDays),
    maxPagesInDay: Math.max(prevPeaks.maxPagesInDay, snap.maxPagesInDay),
    bestWeekGoalDays: Math.max(prevPeaks.bestWeekGoalDays, snap.weekGoalDays),
    booksFinished: Math.max(prevPeaks.booksFinished, snap.booksFinished),
    totalPages: Math.max(prevPeaks.totalPages, snap.totalPages),
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

  // 1) award newly reached milestones (idempotent: keyed by milestone id and plant id)
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

  // 2) grow / complete owned plants (monotone)
  for (const [plantId, owned] of Object.entries(plants)) {
    const m = MILESTONE_BY_ID[owned.milestoneId];
    if (!m) continue; // milestone removed from the catalog later: the plant simply stays as it is
    const g = Math.max(owned.growth, growthFor(m, peaks));
    const completeNow = g >= 1 && !owned.completedAt;
    if (g !== owned.growth || completeNow) {
      changed = true;
      plants = { ...plants, [plantId]: { ...owned, growth: g, ...(completeNow ? { completedAt: now } : {}) } };
    }
  }

  // 3) the window vine
  const vine = Math.max(garden.vine, vineFor(peaks));
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

/** The first milestone (by order) that has not been earned yet: its plant is the one "growing" next. */
export function nextMilestone(garden: GardenState): MilestoneDef | undefined {
  return MILESTONES.find(m => !garden.achievements[m.id]);
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
