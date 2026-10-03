import seeds from './storeSeeds.json';

/** Hand-picked store shelves: [title, author]. Edit src/data/storeSeeds.json, then run `npm run prefetch:store`. */
export interface CuratedShelf {
  id: string;
  title: string;
  emoji: string;
  genre: string;
  seeds: [string, string, string?][]; // [title, author, optional prize label]
}

export const CURATED_SHELVES = seeds as unknown as CuratedShelf[];
