import type { Book } from '../../types';
import { isAppleCoverUrl, isNytCoverUrl } from './model';

/**
 * How good a book's cover link is likely to be, judged from the LINK alone (nothing is loaded). A ranking signal, never a verdict: the picture itself is
 * still judged where it is drawn (coverFlatness.ts).
 *
 *   3  Apple Books art: flat, front-facing, modern
 *   2  a Google Books front cover (printsec=frontcover): the jacket of one real, usually recent, volume
 *   1  an Open Library cover (cover_i is often the work's oldest edition, or a scan of the whole wrap or an inside page) or any other link
 *   0.5  the NYT's marketing image: often a 3D render of a special edition
 *   0  no cover
 */
export type CoverQuality = 0 | 0.5 | 1 | 2 | 3;

const isGoogleFront = (url?: string): boolean => !!url && /books\.google\.[a-z.]+\/books\/(content|publisher\/content)/i.test(url) && /printsec=frontcover/i.test(url);

export function coverQuality(b: Pick<Book, 'coverId' | 'coverUrl'>): CoverQuality {
  const url = b.coverUrl;
  if (url) {
    if (isAppleCoverUrl(url)) return 3;
    if (isNytCoverUrl(url)) return 0.5;
    if (isGoogleFront(url)) return 2;
    return 1;
  }
  return b.coverId && b.coverId > 0 ? 1 : 0;
}

/** A cover worth looking for a better one: an Open Library cover or another plain link, or the NYT's art (never Apple's or a Google front). */
export const isWeakCover = (b: Pick<Book, 'coverId' | 'coverUrl'>): boolean => {
  const q = coverQuality(b);
  return q > 0 && q < 2;
};

/** Search ranking: having a cover is a tiebreaker, and a good flat front is a stronger one (the title match still decides first). */
export const COVER_BONUS = 8;
export const coverBonus = (b: Pick<Book, 'coverId' | 'coverUrl'>): number => {
  const q = coverQuality(b);
  return q === 0 ? 0 : q === 0.5 ? COVER_BONUS - 3 : COVER_BONUS + (q - 1) * 3; // NYT art 5, plain 8, Google front 11, Apple 14
};
