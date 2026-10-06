import type { Book } from '../../../types';
import type { ContentFlags } from '../quality';

/** What every source adapter returns: a normalised Book plus the signals the quality filter looks at. */
export interface Hit {
  book: Book;
  flags: ContentFlags;
}

export interface CallOpts {
  signal?: AbortSignal;
}
