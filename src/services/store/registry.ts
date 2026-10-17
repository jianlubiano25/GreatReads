import { CURATED_SHELVES } from '../../data/storeCatalog';
import { APPLE_SHELVES, appleShelfSource } from './appleShelves';
import { NYT_EXTRA_SHELVES, NYT_SHELVES, bestsellerSource } from './bestsellers';
import { shelfSourceFor } from './dynamic';
import { isShelfHidden } from './prefs';
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
  /** Not on the Store until the reader turns it on in Customize Store (it still appears, hidden, in that list) */
  defaultHidden?: boolean;
  ranked?: boolean;
  lazy?: boolean;
  hideIfUnavailable?: boolean;
  /** Which part of the Store it belongs to (see SECTION_ORDER); the sticky icon bar jumps by section */
  section: StoreSection;
}

/**
 * The Store's sections, in default order. The sticky icon bar (StoreNav) jumps between them: Top / New / Trending share one icon.
 * A shelf the app has never heard of (a later addition) lands in 'genres', the last section.
 */
export type StoreSection = 'top' | 'new' | 'trending' | 'clubs' | 'awards' | 'genres';
export const SECTION_ORDER: StoreSection[] = ['top', 'new', 'trending', 'clubs', 'awards', 'genres'];
const SECTION_OF: Record<string, StoreSection> = {
  new2026: 'new',
  trending: 'trending',
  service95: 'clubs', inklingsclub: 'clubs', inklings: 'clubs', oprah: 'clubs', reeses: 'clubs',
  'prize-catalog': 'awards', womens: 'awards', intbooker: 'awards', booker: 'awards', pulitzer: 'awards', nba: 'awards', goodreadschoice: 'awards', hugo: 'awards', nobel: 'awards', nebula: 'awards',
  'easy-catalog': 'genres', romance: 'genres', selfhelp: 'genres', fantasy: 'genres', memoir: 'genres', historical: 'genres', mystery: 'genres', scifi: 'genres', classics: 'genres',
};
/** Top section, in order: the two combined NYT lists, Apple's charts, the paperback lists, the hardcover lists, then the rest. */
const TOP_ORDER = ['nyt-fiction', 'nyt-nonfiction', 'apple-top-free', 'apple-top-paid', 'nyt-paperback-fiction', 'nyt-paperback-nonfiction', 'nyt-hardcover-fiction', 'nyt-hardcover-nonfiction', 'nyt-advice', 'topfiction', 'topnonfiction', 'nyt-ya'];
const TOP_IDS = new Set<string>([...NYT_SHELVES.map(s => s.id), ...NYT_EXTRA_SHELVES.map(s => s.id), ...APPLE_SHELVES.map(s => s.id), ...TOP_ORDER]);
const SHELVES_OFF_BY_DEFAULT = new Set(['nyt-ya', 'nyt-paperback-nonfiction', 'nyt-hardcover-fiction', 'nyt-hardcover-nonfiction']);
const sectionOf = (id: string): StoreSection => SECTION_OF[id] ?? (TOP_IDS.has(id) ? 'top' : 'genres');

const ALL_SHELVES: Omit<StoreShelfDef, 'section'>[] = [
  // Top 15 this week (official NYT, with GreatReads' labelled fallback)
  ...NYT_SHELVES.map(shelf => ({ id: shelf.id, title: shelf.title, source: bestsellerSource(shelf), ranked: true })),
  { id: 'trending', title: '🔥 Trending Today', source: trendingSource, ranked: true },
  // More NYT lists (official only: a shelf hides itself when its list can't be loaded)
  // Young Adult, Paperback Non-Fiction and the two Hardcover lists are off by default; everything else is on.
  ...NYT_EXTRA_SHELVES.map(shelf => ({ id: shelf.id, title: shelf.title, source: bestsellerSource(shelf), ranked: true, lazy: true, hideIfUnavailable: true, defaultHidden: SHELVES_OFF_BY_DEFAULT.has(shelf.id) })),
  // Apple Books' own charts (official only: a shelf hides itself when its chart can't be loaded)
  ...APPLE_SHELVES.map(shelf => ({ id: shelf.id, title: shelf.title, source: appleShelfSource(shelf), ranked: true, lazy: true, hideIfUnavailable: true })),
  { id: 'prize-catalog', title: '🏆 Prize winners from your lists', library: 'prize' },
  { id: 'easy-catalog', title: '🟢 Easy to start', library: 'easy' },
  // Self-refreshing where a shelf has a public source (see dynamic.ts), hand-picked otherwise
  ...CURATED_SHELVES.map(sh => ({ id: sh.id, title: `${sh.emoji} ${sh.title}`, source: shelfSourceFor(sh), lazy: true })),
];

/** Every shelf in its DEFAULT order: sections in SECTION_ORDER, and inside a section the order the shelves are listed above. */
const topRank = (id: string) => { const i = TOP_ORDER.indexOf(id); return i < 0 ? TOP_ORDER.length : i; };
export const STORE_SHELVES: StoreShelfDef[] = SECTION_ORDER.flatMap(section => {
  const inSection = ALL_SHELVES.filter(d => sectionOf(d.id) === section);
  return (section === 'top' ? [...inSection].sort((a, b) => topRank(a.id) - topRank(b.id)) : inSection).map(d => ({ ...d, section }));
});

export const DEFAULT_SHELF_ORDER = STORE_SHELVES.map(s => s.id);
export const SHELF_BY_ID: Record<string, StoreShelfDef> = Object.fromEntries(STORE_SHELVES.map(s => [s.id, s]));

/** Ids of the shelves currently hidden, given the reader's prefs (what Customize Store and the Store both use). */
export const hiddenShelfIds = (p: Pick<import('./prefs').StorePrefs, 'hidden' | 'shown'>): string[] =>
  STORE_SHELVES.filter(d => isShelfHidden(d.id, !!d.defaultHidden, p)).map(d => d.id);
