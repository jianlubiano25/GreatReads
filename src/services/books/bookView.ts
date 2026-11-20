/**
 * ONE answer to "which cover do we already know for this book?", used by every screen that draws or preloads a cover (cards, Store, nook, search, add, preload).
 * No network, no waiting; the order is the same everywhere:
 *   1. your pick, else the published catalog cover (same matcher as Book Info), else the older shared set, else a loose spelling match   -> getCoverPickInfo
 *   2. a repaired cover (Reload missing covers)
 *   3. the book's own link (what the shelf or search result carried)
 *   4. a cover kept from an earlier lookup
 * Nothing known = '' (only then does a screen show a placeholder and ask the lookup). Description, bio and ratings have their own single path: `getInfo` (infoStore.ts),
 * which already puts the published catalog before any live lookup and uses the same catalog matcher.
 */
import type { Book } from '../../types';
import { getCoverPickInfo, pickSizedUrl, type CoverPick } from './coverPicks';
import { getCoverFix, ownCoverUrl, sizedCoverUrl, type CoverSize } from './coverLookup';
import { peekCoverCandidate } from './coverCandidates';

export type KnownCover = { url: string; from: 'pick' | 'fix' | 'own' | 'kept' | ''; /** set when `from` is 'pick' (your pick, the catalog's or the shared one) */ pick?: CoverPick };

export function knownCover(book: Pick<Book, 'title' | 'author'> & Partial<Book>, size: CoverSize = 'M'): KnownCover {
  const pick = getCoverPickInfo(book);
  if (pick) return { url: pickSizedUrl(pick.url, size), from: 'pick', pick };
  // ONE URL per picture: a repaired cover is drawn at the card's size like the same picture arriving through the book's own link
  const fix = getCoverFix(book);
  if (fix) return { url: sizedCoverUrl(fix, size), from: 'fix' };
  const own = ownCoverUrl(book, size);
  if (own) return { url: own, from: 'own' };
  const kept = peekCoverCandidate(book);
  return kept ? { url: sizedCoverUrl(kept, size), from: 'kept' } : { url: '', from: '' };
}
