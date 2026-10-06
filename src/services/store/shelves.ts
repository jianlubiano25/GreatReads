import type { Book } from '../../types';
import { persistentCache } from '../books/cache';

/** What a Store shelf needs from its data source, whatever feeds it (curated list, NYT, trending). */
export interface ShelfSource {
  id: string;
  /** Instant, synchronous read of a shelf already loaded recently (or null). */
  cached: () => Book[] | null;
  /** Load the shelf: resolves with something showable quickly; `onUpdate` receives the improved final version later. */
  load: (onUpdate: (books: Book[]) => void) => Promise<Book[]>;
}

export const SHELF_TTL = 6 * 60 * 60 * 1000;
/** Finished dynamic shelves (NYT, Trending). Curated shelves have their own, longer-lived cache (see curated.ts). */
export const dynamicShelves = persistentCache<Book[]>('readlife.shelves1', { ttl: SHELF_TTL, max: 8 });
