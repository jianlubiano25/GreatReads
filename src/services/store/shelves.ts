import type { Book } from '../../types';
import { persistentCache } from '../books/cache';

/** What Customize Store shows about a shelf's data. Read-only: it never changes the shelf. */
export interface ShelfInfo {
  /** When the data was last REFRESHED SUCCESSFULLY (ms). Failed attempts never move it. Undefined = never refreshed (hand-picked list). */
  updatedAt?: number;
  /** The normal automatic schedule, in words */
  schedule: string;
  /** Where the books come from, in words (and whether that is official) */
  source: string;
  /** official = the publisher's own list; fallback = a public record standing in for one; generated = GreatReads / discovery; curated = hand-picked */
  kind: 'official' | 'fallback' | 'generated' | 'curated';
  /** The list's handle at its source (the NYT list name, the Apple chart, the Wikipedia page...), shown in Customize Shelves so you can tell exactly which list a shelf follows */
  handle?: string;
}

/** How a manual refresh ended. 'updated' and 'unchanged' are both successes (the timestamp moves); 'failed' keeps the old data. */
export type RefreshResult = 'updated' | 'unchanged' | 'failed';

/** What a Store shelf needs from its data source, whatever feeds it (curated list, NYT, trending). */
export interface ShelfSource {
  id: string;
  /** The heading to show right now, when it depends on where the books came from (e.g. an official list vs. GreatReads' own fallback). */
  label?: () => string;
  /** Instant, synchronous read of a shelf already loaded recently (or null). */
  cached: () => Book[] | null;
  /** Load the shelf: resolves with something showable quickly; `onUpdate` receives the improved final version later. */
  load: (onUpdate: (books: Book[]) => void) => Promise<Book[]>;
  /** Customize Store: what to tell the reader about this shelf's data. Hand-picked shelves can leave it out. */
  info?: () => ShelfInfo;
  /** Customize Store: fetch this one shelf now, ignoring its schedule. Must keep the old data on failure. Use manualRefresh() (refresh.ts), which adds the rate limit. */
  refresh?: () => Promise<RefreshResult>;
}

export const SHELF_TTL = 6 * 60 * 60 * 1000;
/**
 * Finished dynamic shelves (Trending). Curated shelves have their own, longer-lived cache (see curated.ts).
 * `shelves3`: lists saved by `shelves1` / `shelves2` were built before explicit books were judged on their categories (1) and before satanic /
 * demonic books were excluded (2), so they are not trusted (and are removed at startup, see LEGACY_BOOK_CACHE_KEYS in books/cache.ts);
 * the next open builds the shelf again.
 */
export const dynamicShelves = persistentCache<Book[]>('readlife.shelves3', { ttl: SHELF_TTL, max: 8, keepStale: 7 * 24 * 60 * 60 * 1000 });
