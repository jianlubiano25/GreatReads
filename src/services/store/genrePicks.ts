import { SEARCH_GENRES, type SearchGenre } from '../../data/searchGenres';
import type { CuratedShelf } from '../../data/storeCatalog';
import { curatedSource } from './curated';
import { bestsellerSource } from './bestsellers';
import { NYT_EXTRA_SHELVES, NYT_GENRE_SHELVES } from './lists';
import { SHELF_BY_ID } from './registry';
import type { ShelfSource } from './shelves';

const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const own = new Map<string, { id: string; source: ShelfSource }>();

/**
 * The row of hand-picked books on a genre's page: the Store's own shelf for that genre when there is one (the same list, kept once), otherwise the genre's
 * picks as a curated shelf (looked up and saved like any other Store shelf). One source object per genre, because a shelf reloads when its source changes.
 */
export function genrePicks(g: SearchGenre): { id: string; source: ShelfSource } | null {
  let hit = own.get(g.label);
  if (hit) return hit;
  if (g.shelfId) {
    const def = SHELF_BY_ID[g.shelfId];
    if (!def?.source) return null;
    hit = { id: def.id, source: def.source };
    own.set(g.label, hit);
    return hit;
  }
  if (!g.picks?.length) return null;
  if (!hit) {
    const shelf: CuratedShelf = { id: `genre-${slug(g.label)}`, title: g.label, emoji: g.emoji, genre: g.label, seeds: g.picks.map(([t, a]) => [t, a]) };
    hit = { id: shelf.id, source: curatedSource(shelf) };
    own.set(g.label, hit);
  }
  return hit;
}

export const genreByLabel = (label: string): SearchGenre | undefined => SEARCH_GENRES.find(g => g.label === label);

const popular = new Map<string, { id: string; source: ShelfSource } | null>();

/**
 * The "Popular now" row of a genre page: the official NYT list for the genre, when there is one (`popular` in the genre list). Official only: the shelf
 * hides itself when the NYT can't be reached, and a genre with no list has no row. One source object per genre, like genrePicks.
 */
export function genrePopular(g: SearchGenre): { id: string; source: ShelfSource } | null {
  if (!g.popular) return null;
  if (popular.has(g.label)) return popular.get(g.label)!;
  const shelf = [...NYT_GENRE_SHELVES, ...NYT_EXTRA_SHELVES].find(s => s.id === g.popular);
  const hit = shelf ? { id: shelf.id, source: bestsellerSource(shelf) } : null;
  popular.set(g.label, hit);
  return hit;
}
