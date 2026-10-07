import { CURATED_SHELVES } from '../../data/storeCatalog';
import { NYT_EXTRA_SHELVES, NYT_SHELVES, bestsellerSource } from './bestsellers';
import { shelfSourceFor } from './dynamic';
import type { ShelfSource } from './shelves';
import { trendingSource } from './trending';

/**
 * Every shelf the Store can show, in its DEFAULT order. The Store draws these, and Customize Store lists the same entries, so
 * there is one list of shelves, not two. (A reader's own order / hidden shelves live in prefs.ts, apart from this.)
 *
 * One source object per shelf, created once: a shelf compares its source to know when to reload.
 */
export interface StoreShelfDef {
  id: string;
  title: string;
  /** Fed by a source (curated, NYT, trending...). Library shelves have none: they are built from the reader's own catalog. */
  source?: ShelfSource;
  /** Built from the reader's own catalog (see App.tsx), nothing to refresh */
  library?: 'prize' | 'easy';
  ranked?: boolean;
  lazy?: boolean;
  hideIfUnavailable?: boolean;
}

export const STORE_SHELVES: StoreShelfDef[] = [
  // Top 15 this week (official NYT, with GreatReads' labelled fallback)
  ...NYT_SHELVES.map(shelf => ({ id: shelf.id, title: shelf.title, source: bestsellerSource(shelf), ranked: true })),
  { id: 'trending', title: '🔥 Trending Today', source: trendingSource, ranked: true },
  // More NYT lists (official only: a shelf hides itself when its list can't be loaded)
  ...NYT_EXTRA_SHELVES.map(shelf => ({ id: shelf.id, title: shelf.title, source: bestsellerSource(shelf), ranked: true, lazy: true, hideIfUnavailable: true })),
  { id: 'prize-catalog', title: '🏆 Prize winners from your lists', library: 'prize' },
  { id: 'easy-catalog', title: '🟢 Easy to start', library: 'easy' },
  // Self-refreshing where a shelf has a public source (see dynamic.ts), hand-picked otherwise
  ...CURATED_SHELVES.map(sh => ({ id: sh.id, title: `${sh.emoji} ${sh.title}`, source: shelfSourceFor(sh), lazy: true })),
];

export const DEFAULT_SHELF_ORDER = STORE_SHELVES.map(s => s.id);
export const SHELF_BY_ID: Record<string, StoreShelfDef> = Object.fromEntries(STORE_SHELVES.map(s => [s.id, s]));
