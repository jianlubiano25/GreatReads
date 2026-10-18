import type { Book } from '../../../types';
import type { ContentFlags } from '../quality';

/** What every source adapter returns: a normalised Book plus the signals the quality filter looks at. */
export interface Hit {
  book: Book;
  flags: ContentFlags;
}

export interface CallOpts {
  signal?: AbortSignal;
  /** Extra attempts after a timeout, a 429 or a 5xx (default 0) */
  retries?: number;
  /** Milliseconds to wait for one attempt (default 6500): the Store's discovery searches are heavy and need longer */
  timeout?: number;
  /** Search only: the 1-based page of results (Open Library) */
  page?: number;
  /** Google Books search only: index of the first result (paging) */
  start?: number;
  /** Search only: how many books the source says match in all (not just the ones returned) */
  onTotal?: (n: number) => void;
}
