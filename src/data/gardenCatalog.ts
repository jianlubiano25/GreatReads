/**
 * Garden catalog: everything that is DATA about the garden lives here.
 * To add a plant: add one entry to PLANTS (pick an art family + colours).
 * To award it: add one entry to MILESTONES. Nothing else needs to change.
 *
 *   Milestone (achievement)  ->  Plant (what you own)  ->  Placement (where it stands)
 */
import type { GardenPeaks } from '../types';

/** Where a plant stands by default: on a shelf plank, or hanging from a rail. */
export type PlantMount = 'shelf' | 'hanging';

export type ArtFamily =
  | 'sprout' | 'blossom' | 'sunflower' | 'rose'
  | 'spears' | 'fan' | 'fern' | 'bush' | 'trailing' | 'spider'
  | 'daisy' | 'tulip' | 'hibiscus' | 'lavender' | 'poppy' | 'orchid' | 'lily'
  | 'clover' | 'mushroom' | 'bamboo' | 'cactus' | 'jade' | 'bonsai';

export interface PotStyle {
  shape: 'taper' | 'cylinder' | 'bowl';
  body: string;
  rim: string;
  stroke?: string;
  text?: string; // colour of the seedling badge text
}

export interface PlantDef {
  id: string;
  name: string;
  emoji: string; // used in names/labels only; the artwork is always SVG
  family: ArtFamily;
  mount: PlantMount; // default area kind
  /** Plants that only make sense hanging (trailing vines). Everything else can stand on the shelf or hang in a basket. */
  hangOnly?: boolean;
  leaf: string;
  leaf2: string;
  bloom?: string;
  bloom2?: string;
  pot: PotStyle;
  /** Small per-family switches, e.g. { shape: 'needle' } for rosemary. */
  opt?: Record<string, string | number | boolean>;
}

const TERRA: PotStyle = { shape: 'taper', body: '#c26d45', rim: '#ad5933' };
const CREAM: PotStyle = { shape: 'taper', body: '#e2d3b6', rim: '#3a7d80', stroke: '#b5a17d', text: '#5c4a35' };
const IVORY: PotStyle = { shape: 'cylinder', body: '#ebe2cf', rim: '#4a7c59', stroke: '#b5a17d', text: '#335940' };
const BASKET: PotStyle = { shape: 'bowl', body: '#b88c5a', rim: '#8a5a3b' };

export const PLANTS: PlantDef[] = [
  // ---- starters ----
  { id: 'streak-sprout', name: 'Streak Sprout', emoji: '🌱', family: 'sprout', mount: 'shelf', leaf: '#4e7f55', leaf2: '#2e5934', bloom: '#e7a1b4', pot: TERRA },
  { id: 'pink-blossom', name: 'Pink Blossom', emoji: '🌸', family: 'blossom', mount: 'shelf', leaf: '#5b9363', leaf2: '#2e5934', bloom: '#e7a1b4', bloom2: '#f6cfd9', pot: CREAM },
  // ---- leafy ----
  { id: 'fern', name: 'Fern', emoji: '🌿', family: 'fern', mount: 'hanging', leaf: '#4f9a5c', leaf2: '#2f6b3d', pot: BASKET },
  { id: 'monstera', name: 'Monstera', emoji: '🌿', family: 'fan', mount: 'shelf', leaf: '#2f7a4a', leaf2: '#1f5634', pot: IVORY, opt: { shape: 'split' } },
  { id: 'philodendron', name: 'Philodendron', emoji: '🌿', family: 'fan', mount: 'shelf', leaf: '#3f8f55', leaf2: '#27633a', pot: TERRA, opt: { shape: 'heart' } },
  { id: 'calathea', name: 'Calathea', emoji: '🌿', family: 'fan', mount: 'shelf', leaf: '#55916a', leaf2: '#2b5d44', bloom: '#b9d8bf', pot: { shape: 'cylinder', body: '#d9c7ad', rim: '#7d5a8a', stroke: '#bda78a', text: '#5c4a35' }, opt: { shape: 'stripe' } },
  { id: 'snake-plant', name: 'Snake Plant', emoji: '🪴', family: 'spears', mount: 'shelf', leaf: '#3b7a4e', leaf2: '#2d5e3b', bloom: '#e0c753', pot: IVORY, opt: { trim: true } },
  { id: 'aloe', name: 'Aloe', emoji: '🌿', family: 'spears', mount: 'shelf', leaf: '#6fb08a', leaf2: '#4d8f6c', pot: { shape: 'taper', body: '#c9825a', rim: '#a8603c' }, opt: { fat: true } },
  { id: 'peace-lily', name: 'Peace Lily', emoji: '🤍', family: 'lily', mount: 'shelf', leaf: '#2f7a4a', leaf2: '#1f5634', bloom: '#fbfaf2', bloom2: '#f2d96b', pot: CREAM },
  { id: 'basil', name: 'Basil', emoji: '🌿', family: 'bush', mount: 'shelf', leaf: '#3f9a4c', leaf2: '#2b6e35', pot: TERRA, opt: { shape: 'round' } },
  { id: 'rosemary', name: 'Rosemary', emoji: '🌿', family: 'bush', mount: 'shelf', leaf: '#5d8a63', leaf2: '#3d6444', pot: IVORY, opt: { shape: 'needle' } },
  { id: 'mint', name: 'Mint', emoji: '🌿', family: 'bush', mount: 'shelf', leaf: '#6cc07a', leaf2: '#3f8f50', pot: { shape: 'taper', body: '#8fb3c2', rim: '#5f8797' }, opt: { shape: 'oval' } },
  { id: 'pothos', name: 'Pothos', emoji: '🌿', family: 'trailing', mount: 'hanging', hangOnly: true, leaf: '#4fa35e', leaf2: '#2f7440', pot: BASKET, opt: { shape: 'heart' } },
  { id: 'string-of-pearls', name: 'String of Pearls', emoji: '🌿', family: 'trailing', mount: 'hanging', hangOnly: true, leaf: '#7cc08a', leaf2: '#4d8f5b', pot: { shape: 'bowl', body: '#e8dcc6', rim: '#3a7d80', stroke: '#cfbe9f' }, opt: { shape: 'pearl' } },
  { id: 'english-ivy', name: 'English Ivy', emoji: '🍃', family: 'trailing', mount: 'hanging', hangOnly: true, leaf: '#3f8a52', leaf2: '#27633a', pot: { shape: 'bowl', body: '#d9c7ad', rim: '#7d5a8a', stroke: '#bda78a' }, opt: { shape: 'ivy' } },
  { id: 'spider-plant', name: 'Spider Plant', emoji: '🌿', family: 'spider', mount: 'hanging', hangOnly: true, leaf: '#7fc16f', leaf2: '#3f8f45', bloom: '#f4f1d8', pot: BASKET },
  // ---- succulents & little trees ----
  { id: 'cactus', name: 'Cactus', emoji: '🌵', family: 'cactus', mount: 'shelf', leaf: '#4f9a62', leaf2: '#2f6e43', bloom: '#ff7aa8', pot: { shape: 'taper', body: '#d58a5c', rim: '#b86a3c' } },
  { id: 'jade-plant', name: 'Jade Plant', emoji: '🪴', family: 'jade', mount: 'shelf', leaf: '#4aa05f', leaf2: '#2f6e43', bloom: '#8b5a3c', pot: { shape: 'cylinder', body: '#e3eef0', rim: '#6aa3ad', stroke: '#b8cfd3', text: '#335940' } },
  { id: 'bonsai', name: 'Bonsai', emoji: '🌳', family: 'bonsai', mount: 'shelf', leaf: '#3f8f4f', leaf2: '#2b6e3a', bloom: '#6b4a33', pot: { shape: 'bowl', body: '#3c5a6e', rim: '#2b4251' } },
  // ---- flowers ----
  { id: 'velvet-rose', name: 'Velvet Rose', emoji: '🌹', family: 'rose', mount: 'shelf', leaf: '#3d7345', leaf2: '#2a5430', bloom: '#b81d3f', pot: { shape: 'taper', body: '#755047', rim: '#b81d3f' } },
  { id: 'golden-sunflower', name: 'Golden Sunflower', emoji: '🌻', family: 'sunflower', mount: 'shelf', leaf: '#4d8c56', leaf2: '#33663a', bloom: '#f5b722', pot: { shape: 'taper', body: '#c06d3d', rim: '#f5b722' } },
  { id: 'tulip', name: 'Tulip', emoji: '🌷', family: 'tulip', mount: 'shelf', leaf: '#4a9a58', leaf2: '#2f6e3c', bloom: '#e8567a', bloom2: '#f08ba6', pot: CREAM },
  { id: 'daisy', name: 'Daisy', emoji: '🌼', family: 'daisy', mount: 'shelf', leaf: '#4f9a5a', leaf2: '#2f6e3c', bloom: '#fffdf5', bloom2: '#f5c542', pot: TERRA },
  { id: 'lavender', name: 'Lavender', emoji: '💜', family: 'lavender', mount: 'shelf', leaf: '#6f9a78', leaf2: '#4a7556', bloom: '#9b7fd1', bloom2: '#7d5fb8', pot: IVORY },
  { id: 'hibiscus', name: 'Hibiscus', emoji: '🌺', family: 'hibiscus', mount: 'shelf', leaf: '#3f8a4f', leaf2: '#27633a', bloom: '#ec4f6a', bloom2: '#f7c948', pot: { shape: 'taper', body: '#2f6d73', rim: '#4a9aa1' } },
  { id: 'poppy', name: 'Poppy', emoji: '🏵️', family: 'poppy', mount: 'shelf', leaf: '#5a9a5a', leaf2: '#34703f', bloom: '#e8402f', bloom2: '#2b1d1a', pot: { shape: 'cylinder', body: '#d9c7ad', rim: '#e8402f', stroke: '#bda78a', text: '#5c4a35' } },
  { id: 'orchid', name: 'Orchid', emoji: '🪷', family: 'orchid', mount: 'shelf', leaf: '#3f8f55', leaf2: '#2b6e3a', bloom: '#f4e9f7', bloom2: '#c45bb5', pot: { shape: 'cylinder', body: '#f4efe6', rim: '#c45bb5', stroke: '#cfbe9f', text: '#6b3a63' } },
  // ---- unusual / cute ----
  { id: 'lucky-clover', name: 'Lucky Clover', emoji: '🍀', family: 'clover', mount: 'shelf', leaf: '#4cae5e', leaf2: '#2f7d41', pot: BASKET },
  { id: 'mushroom-cluster', name: 'Mushroom Cluster', emoji: '🍄', family: 'mushroom', mount: 'shelf', leaf: '#d9453d', leaf2: '#f4ecd8', bloom: '#d9453d', pot: { shape: 'bowl', body: '#7a5a46', rim: '#5a402f' } },
  { id: 'lucky-bamboo', name: 'Lucky Bamboo', emoji: '🎍', family: 'bamboo', mount: 'shelf', leaf: '#7cb665', leaf2: '#4f8f45', pot: { shape: 'cylinder', body: '#e3eef0', rim: '#6aa3ad', stroke: '#b8cfd3', text: '#335940' } },
];

export const PLANT_BY_ID: Record<string, PlantDef> = Object.fromEntries(PLANTS.map(p => [p.id, p]));

/** Shown for a plant id that is no longer in the catalog, so owned plants never silently vanish. */
export const FALLBACK_PLANT: PlantDef = {
  id: 'mystery', name: 'Mystery Plant', emoji: '🪴', family: 'bush', mount: 'shelf',
  leaf: '#5b9363', leaf2: '#2e5934', pot: TERRA, opt: { shape: 'round' },
};

export const getPlantDef = (id: string): PlantDef => PLANT_BY_ID[id] ?? FALLBACK_PLANT;

// ---------------------------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------------------------

/** Every metric is read from the persisted high-water marks, never from the live streak. */
export type MetricKey = 'consistency' | 'pagesInDay' | 'bestWeek' | 'books' | 'totalPages' | 'highlights' | 'wordsAdded' | 'wordsLearned';

export const metricValue = (peaks: GardenPeaks, metric: MetricKey): number => {
  switch (metric) {
    case 'consistency': return Math.max(peaks.bestStreak, peaks.tenPageDays); // streak OR days with 10+ pages
    case 'pagesInDay': return peaks.maxPagesInDay;
    case 'bestWeek': return peaks.bestWeekGoalDays;
    case 'books': return peaks.booksFinished;
    case 'totalPages': return peaks.totalPages;
    case 'highlights': return peaks.highlights;
    case 'wordsAdded': return peaks.wordsAdded;
    case 'wordsLearned': return peaks.wordsLearned;
  }
};

/**
 * Reading-log metrics are worked out fresh from the pages you logged, so correcting a page count takes back what it
 * earned. The other metrics (books, highlights, words) are high-water marks that only go up.
 */
export const isLiveMetric = (metric: MetricKey): boolean =>
  metric === 'consistency' || metric === 'pagesInDay' || metric === 'bestWeek' || metric === 'totalPages';

export interface MilestoneDef {
  id: string;
  plantId: string;
  order: number; // the first unearned milestone (lowest order) is the plant that is "growing" next
  unlock: { metric: MetricKey; at: number };
  /** How the plant keeps growing after it is earned: growth 0.2 at `from`, fully grown (completed) at `to`. */
  grow: { metric: MetricKey; from: number; to: number };
  badge: string; // short text on the seedling pot, e.g. "7d"
  earnedLabel: string; // "Earned from {earnedLabel}"
  unlockLabel: string; // "Unlocks at {unlockLabel}"
  reason: string; // "You received a Fern for achieving {reason}."
  silent?: boolean; // starter plants: awarded without the celebration prompt
}

const MILESTONE_LIST: MilestoneDef[] = [
  // Starters (always owned; they keep growing with your reading history)
  { id: 'welcome-sprout', plantId: 'streak-sprout', order: 1, silent: true, unlock: { metric: 'consistency', at: 0 }, grow: { metric: 'consistency', from: 0, to: 7 }, badge: '', earnedLabel: 'your first day in the garden', unlockLabel: 'the start', reason: 'your first day in the garden' },
  { id: 'welcome-blossom', plantId: 'pink-blossom', order: 2, silent: true, unlock: { metric: 'consistency', at: 0 }, grow: { metric: 'bestWeek', from: 0, to: 7 }, badge: '', earnedLabel: 'your first day in the garden', unlockLabel: 'the start', reason: 'your first day in the garden' },
  // Reading milestones. Total pages count everything you have ever read, streak or not.
  { id: 'pages-10', plantId: 'fern', order: 10, unlock: { metric: 'pagesInDay', at: 10 }, grow: { metric: 'pagesInDay', from: 10, to: 30 }, badge: '10p', earnedLabel: '10-page milestone', unlockLabel: '10 pages in a day', reason: 'your first 10-page reading day' },
  { id: 'total-20', plantId: 'lucky-clover', order: 11, unlock: { metric: 'totalPages', at: 20 }, grow: { metric: 'totalPages', from: 20, to: 60 }, badge: '20', earnedLabel: '20-pages-read milestone', unlockLabel: '20 pages read in total', reason: 'your 20-pages-read milestone' },
  { id: 'total-30', plantId: 'daisy', order: 12, unlock: { metric: 'totalPages', at: 30 }, grow: { metric: 'totalPages', from: 30, to: 80 }, badge: '30', earnedLabel: '30-pages-read milestone', unlockLabel: '30 pages read in total', reason: 'your 30-pages-read milestone' },
  { id: 'highlight-1', plantId: 'tulip', order: 13, unlock: { metric: 'highlights', at: 1 }, grow: { metric: 'highlights', from: 1, to: 5 }, badge: '1💬', earnedLabel: 'first saved quote', unlockLabel: '1 saved quote or highlight', reason: 'your first saved quote' },
  { id: 'total-50', plantId: 'cactus', order: 14, unlock: { metric: 'totalPages', at: 50 }, grow: { metric: 'totalPages', from: 50, to: 120 }, badge: '50', earnedLabel: '50-pages-read milestone', unlockLabel: '50 pages read in total', reason: 'your 50-pages-read milestone' },
  { id: 'words-1', plantId: 'mint', order: 15, unlock: { metric: 'wordsAdded', at: 1 }, grow: { metric: 'wordsAdded', from: 1, to: 5 }, badge: '1w', earnedLabel: 'first word added', unlockLabel: '1 word added to your Word Garden', reason: 'your first word added' },
  { id: 'learned-1', plantId: 'basil', order: 16, unlock: { metric: 'wordsLearned', at: 1 }, grow: { metric: 'wordsLearned', from: 1, to: 5 }, badge: '1✓', earnedLabel: 'first word learned', unlockLabel: '1 word learned', reason: 'your first word learned' },
  { id: 'total-100', plantId: 'jade-plant', order: 17, unlock: { metric: 'totalPages', at: 100 }, grow: { metric: 'totalPages', from: 100, to: 250 }, badge: '100', earnedLabel: '100-pages-read milestone', unlockLabel: '100 pages read in total', reason: 'your 100-pages-read milestone' },
  { id: 'streak-7', plantId: 'golden-sunflower', order: 20, unlock: { metric: 'consistency', at: 7 }, grow: { metric: 'consistency', from: 7, to: 16 }, badge: '7d', earnedLabel: '7-day streak milestone', unlockLabel: '7-day streak', reason: 'your 7-day reading streak' },
  { id: 'pages-30', plantId: 'aloe', order: 22, unlock: { metric: 'pagesInDay', at: 30 }, grow: { metric: 'pagesInDay', from: 30, to: 60 }, badge: '30p', earnedLabel: '30-page day milestone', unlockLabel: '30 pages in a single day', reason: 'a 30-page reading day' },
  { id: 'books-1', plantId: 'pothos', order: 24, unlock: { metric: 'books', at: 1 }, grow: { metric: 'books', from: 1, to: 3 }, badge: '1📖', earnedLabel: 'your first finished book', unlockLabel: 'your first finished book', reason: 'your first finished book' },
  { id: 'words-10', plantId: 'spider-plant', order: 26, unlock: { metric: 'wordsAdded', at: 10 }, grow: { metric: 'wordsAdded', from: 10, to: 25 }, badge: '10w', earnedLabel: '10-words-added milestone', unlockLabel: '10 words added', reason: 'your 10-words-added milestone' },
  { id: 'highlight-5', plantId: 'peace-lily', order: 28, unlock: { metric: 'highlights', at: 5 }, grow: { metric: 'highlights', from: 5, to: 15 }, badge: '5💬', earnedLabel: '5-saved-quotes milestone', unlockLabel: '5 saved quotes or highlights', reason: 'your 5-saved-quotes milestone' },
  { id: 'total-250', plantId: 'orchid', order: 30, unlock: { metric: 'totalPages', at: 250 }, grow: { metric: 'totalPages', from: 250, to: 600 }, badge: '250', earnedLabel: '250-pages-read milestone', unlockLabel: '250 pages read in total', reason: 'your 250-pages-read milestone' },
  { id: 'streak-14', plantId: 'velvet-rose', order: 32, unlock: { metric: 'consistency', at: 14 }, grow: { metric: 'consistency', from: 14, to: 26 }, badge: '14d', earnedLabel: '14-day streak milestone', unlockLabel: '14-day streak', reason: 'your 14-day reading streak' },
  { id: 'learned-10', plantId: 'rosemary', order: 34, unlock: { metric: 'wordsLearned', at: 10 }, grow: { metric: 'wordsLearned', from: 10, to: 25 }, badge: '10✓', earnedLabel: '10-words-learned milestone', unlockLabel: '10 words learned', reason: 'your 10-words-learned milestone' },
  { id: 'total-500', plantId: 'string-of-pearls', order: 36, unlock: { metric: 'totalPages', at: 500 }, grow: { metric: 'totalPages', from: 500, to: 1000 }, badge: '500', earnedLabel: '500-pages-read milestone', unlockLabel: '500 pages read in total', reason: 'your 500-pages-read milestone' },
  { id: 'books-3', plantId: 'monstera', order: 38, unlock: { metric: 'books', at: 3 }, grow: { metric: 'books', from: 3, to: 6 }, badge: '3📖', earnedLabel: '3-finished-books milestone', unlockLabel: '3 finished books', reason: 'your 3-finished-books milestone' },
  { id: 'streak-21', plantId: 'snake-plant', order: 40, unlock: { metric: 'consistency', at: 21 }, grow: { metric: 'consistency', from: 21, to: 35 }, badge: '21d', earnedLabel: '21-day streak milestone', unlockLabel: '21-day streak', reason: 'your 21-day reading streak' },
  { id: 'highlight-15', plantId: 'lavender', order: 42, unlock: { metric: 'highlights', at: 15 }, grow: { metric: 'highlights', from: 15, to: 40 }, badge: '15💬', earnedLabel: '15-saved-quotes milestone', unlockLabel: '15 saved quotes or highlights', reason: 'your 15-saved-quotes milestone' },
  { id: 'words-25', plantId: 'english-ivy', order: 44, unlock: { metric: 'wordsAdded', at: 25 }, grow: { metric: 'wordsAdded', from: 25, to: 60 }, badge: '25w', earnedLabel: '25-words-added milestone', unlockLabel: '25 words added', reason: 'your 25-words-added milestone' },
  { id: 'pages-50', plantId: 'poppy', order: 46, unlock: { metric: 'pagesInDay', at: 50 }, grow: { metric: 'pagesInDay', from: 50, to: 100 }, badge: '50p', earnedLabel: '50-page day milestone', unlockLabel: '50 pages in a single day', reason: 'a 50-page reading day' },
  { id: 'books-5', plantId: 'calathea', order: 48, unlock: { metric: 'books', at: 5 }, grow: { metric: 'books', from: 5, to: 10 }, badge: '5📖', earnedLabel: '5-finished-books milestone', unlockLabel: '5 finished books', reason: 'your 5-finished-books milestone' },
  { id: 'streak-30', plantId: 'hibiscus', order: 50, unlock: { metric: 'consistency', at: 30 }, grow: { metric: 'consistency', from: 30, to: 45 }, badge: '30d', earnedLabel: '30-day streak milestone', unlockLabel: '30-day streak', reason: 'your 30-day reading streak' },
  { id: 'total-1000', plantId: 'lucky-bamboo', order: 52, unlock: { metric: 'totalPages', at: 1000 }, grow: { metric: 'totalPages', from: 1000, to: 2500 }, badge: '1k', earnedLabel: '1,000-pages-read milestone', unlockLabel: '1,000 pages read in total', reason: 'your 1,000-pages-read milestone' },
  { id: 'learned-25', plantId: 'mushroom-cluster', order: 54, unlock: { metric: 'wordsLearned', at: 25 }, grow: { metric: 'wordsLearned', from: 25, to: 60 }, badge: '25✓', earnedLabel: '25-words-learned milestone', unlockLabel: '25 words learned', reason: 'your 25-words-learned milestone' },
  { id: 'books-10', plantId: 'philodendron', order: 56, unlock: { metric: 'books', at: 10 }, grow: { metric: 'books', from: 10, to: 20 }, badge: '10📖', earnedLabel: '10-finished-books milestone', unlockLabel: '10 finished books', reason: 'your 10-finished-books milestone' },
  { id: 'total-2500', plantId: 'bonsai', order: 58, unlock: { metric: 'totalPages', at: 2500 }, grow: { metric: 'totalPages', from: 2500, to: 6000 }, badge: '2.5k', earnedLabel: '2,500-pages-read milestone', unlockLabel: '2,500 pages read in total', reason: 'your 2,500-pages-read milestone' },
  // To add more: add a plant to PLANTS, then add one line here pointing at it.
];

export const MILESTONES: MilestoneDef[] = [...MILESTONE_LIST].sort((a, b) => a.order - b.order);

export const MILESTONE_BY_ID: Record<string, MilestoneDef> = Object.fromEntries(MILESTONES.map(m => [m.id, m]));

// ---------------------------------------------------------------------------------------------
// Garden areas (where plants can stand). Add an area here to give plants somewhere new to live.
// ---------------------------------------------------------------------------------------------

export interface GardenAreaDef {
  id: string;
  label: string;
  kind: PlantMount; // how the area is drawn: a shelf plank or a hanging rail
}

export const GARDEN_AREAS: GardenAreaDef[] = [
  { id: 'hanging', label: 'Hanging rail', kind: 'hanging' },
  { id: 'shelf', label: 'Garden shelf', kind: 'shelf' },
];

export const defaultAreaFor = (def: PlantDef): string =>
  GARDEN_AREAS.find(a => a.kind === def.mount)?.id ?? GARDEN_AREAS[GARDEN_AREAS.length - 1].id;

/** Vines only hang; every other plant can stand on the shelf or hang in a basket. */
export const canPlaceIn = (def: PlantDef, areaId: string): boolean => {
  const area = GARDEN_AREAS.find(a => a.id === areaId);
  if (!area) return false;
  return !def.hangOnly || area.kind === 'hanging';
};
