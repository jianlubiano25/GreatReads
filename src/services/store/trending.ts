import type { Book } from '../../types';
import { mapPool } from '../books/http';
import { identityOf, sameWork } from '../books/identity';
import { mergeBooks } from '../books/merge';
import { hasRealSummary, isKnownGenre, shrunkRating } from '../books/model';
import { EXPLICIT_FILTER_AT, EXPLICIT_PENALTY_AT, explicitScore, type ContentFlags } from '../books/quality';
import { resolveBook } from '../books/resolve';
import { fetchNytList } from '../books/sources/nyt';
import { trendingOpenLibrary } from '../books/sources/openLibrary';
import { NYT_SHELVES } from './bestsellers';
import { dynamicShelves, type ShelfSource } from './shelves';

/**
 * "Trending Today": GreatReads' own list, built from several signals. It is NOT a universal real-time ranking (no such public
 * data exists) and it is deliberately different from the NYT Top 15: that list is one authority's rank; this one asks
 * "what are readers around these catalogues paying attention to right now?"
 *
 * Candidates come from Open Library's daily and weekly trending. Each is scored from the signals below (see TREND_WEIGHTS).
 * Explicit books are dropped, and the final 15 keep a mix of genres.
 */

/** Maximum points each signal can add. Change a number here to change how the list is weighed. */
export const TREND_WEIGHTS = {
  olDaily: 40, // Open Library trending today (position in that list)
  olWeekly: 15, // Open Library trending this week
  nyt: 20, // currently on a NYT bestseller list (higher rank, more points)
  readers: 18, // how many people rated it (log scale), across Open Library / Google / Apple
  quality: 8, // rating quality, shrunk toward average for small samples
  recency: 10, // published this year / last year / within three years
  metadata: 10, // cover, real description, page count, genre
  crossSource: 8, // appears in two or more of: OL daily, OL weekly, NYT
  suggestivePenalty: 30, // mildly suggestive (not explicit) books are pushed down
} as const;

export interface TrendSignals {
  book: Book;
  dailyRank?: number; // 0 = most trending today
  dailyTotal?: number;
  weeklyRank?: number;
  weeklyTotal?: number;
  nytRank?: number; // 1..15 when on a NYT list
  explicit?: number;
}

const position = (rank: number | undefined, total: number | undefined) => (rank === undefined || !total ? 0 : Math.max(0, 1 - rank / total));

/** Score with a per-signal breakdown, so it is always clear why a book is where it is. */
export function scoreTrending(s: TrendSignals, now = new Date()): { score: number; parts: Record<string, number> } {
  const W = TREND_WEIGHTS;
  const b = s.book;
  const count = b.ratingCount || 0;
  const year = Number(b.year);
  const age = year ? now.getFullYear() - year : 99;
  const parts: Record<string, number> = {
    olDaily: position(s.dailyRank, s.dailyTotal) * W.olDaily,
    olWeekly: position(s.weeklyRank, s.weeklyTotal) * W.olWeekly,
    nyt: s.nytRank ? W.nyt * Math.max(0.05, 1 - (s.nytRank - 1) / 15) : 0,
    readers: Math.min(W.readers, Math.log10(count + 1) * 4.5),
    quality: b.ratingAverage ? Math.max(0, Math.min(W.quality, (shrunkRating(b.ratingAverage, count) - 3.5) * 5)) : 0,
    recency: age <= 0 ? W.recency : age === 1 ? W.recency * 0.6 : age <= 3 ? W.recency * 0.3 : 0,
    metadata: (b.coverId || b.coverUrl ? 4 : 0) + (hasRealSummary(b.summary) ? 3 : 0) + (b.pageCount ? 1.5 : 0) + (isKnownGenre(b.genre) ? 1.5 : 0),
    crossSource: [s.dailyRank !== undefined, s.weeklyRank !== undefined, !!s.nytRank].filter(Boolean).length >= 2 ? W.crossSource : 0,
    penalty: (s.explicit ?? 0) >= EXPLICIT_PENALTY_AT ? -W.suggestivePenalty : 0,
  };
  return { score: Object.values(parts).reduce((a, n) => a + n, 0), parts };
}

/** Best-scoring books first, but each extra book of an already-picked genre costs points, so one genre cannot take over the shelf. */
export function pickDiverse<T extends { book: Book; score: number }>(items: T[], limit: number, genrePenalty = 9): T[] {
  const left = [...items].sort((a, b) => b.score - a.score);
  const picked: T[] = [];
  const used: Record<string, number> = {};
  const genreOf = (b: Book) => (isKnownGenre(b.genre) ? b.genre : '');
  while (picked.length < limit && left.length) {
    let bestI = 0;
    let bestV = -Infinity;
    left.forEach((it, i) => {
      const g = genreOf(it.book);
      const v = it.score - (g ? genrePenalty * (used[g] || 0) : 0);
      if (v > bestV) { bestV = v; bestI = i; }
    });
    const [it] = left.splice(bestI, 1);
    picked.push(it);
    const g = genreOf(it.book);
    if (g) used[g] = (used[g] || 0) + 1;
  }
  return picked.sort((a, b) => b.score - a.score);
}

interface Candidate extends TrendSignals { flags: ContentFlags }

const POOL = 20; // candidates that get the extra lookups
const SHELF_ID = 'trending';
let refining = false;

function select(cands: Candidate[], limit: number): Book[] {
  const scored = cands
    .map(c => ({ c, explicit: explicitScore(c.book.title, c.flags) }))
    .filter(x => x.explicit < EXPLICIT_FILTER_AT && (x.c.book.coverId || x.c.book.coverUrl))
    .map(x => ({ book: x.c.book, score: scoreTrending({ ...x.c, explicit: x.explicit }).score }));
  return pickDiverse(scored, limit).map(x => x.book);
}

async function gather(): Promise<Candidate[]> {
  const [daily, weekly, ...nyt] = await Promise.all([
    trendingOpenLibrary('daily', 30),
    trendingOpenLibrary('weekly', 30),
    ...NYT_SHELVES.map(s => fetchNytList(s.list)), // usually already cached by the NYT shelves: no extra request
  ]);
  if (!daily && !weekly) throw new Error('trending unavailable');
  const nytEntries = nyt.flatMap(l => l || []);

  const cands: Candidate[] = [];
  const add = (hit: NonNullable<typeof daily>[number], kind: 'daily' | 'weekly', total: number) => {
    const i = cands.findIndex(c => sameWork(c.book, hit.book));
    if (i >= 0) {
      const c = cands[i];
      if (kind === 'daily') { c.dailyRank = hit.rank; c.dailyTotal = total; } else { c.weeklyRank = hit.rank; c.weeklyTotal = total; }
      c.book = mergeBooks(c.book, hit.book);
    } else {
      cands.push({ book: hit.book, flags: hit.flags, ...(kind === 'daily' ? { dailyRank: hit.rank, dailyTotal: total } : { weeklyRank: hit.rank, weeklyTotal: total }) });
    }
  };
  daily?.forEach(h => add(h, 'daily', daily.length));
  weekly?.forEach(h => add(h, 'weekly', weekly.length));

  // NYT presence is a signal for books already trending, not a way into the list
  for (const c of cands) {
    const isbn = identityOf(c.book);
    const e = nytEntries.find(n => sameWork(c.book, { id: '', title: n.title, author: n.author, identity: { isbn13: n.isbn13, isbn10: n.isbn10 } }) || (isbn.isbn13 && isbn.isbn13 === n.isbn13));
    if (e) c.nytRank = e.rank;
  }
  return cands.filter(c => explicitScore(c.book.title, c.flags) < EXPLICIT_FILTER_AT);
}

export const trendingSource: ShelfSource = {
  id: SHELF_ID,
  cached: () => dynamicShelves.get(SHELF_ID) ?? null,
  load: async onUpdate => {
    const cached = dynamicShelves.get(SHELF_ID);
    if (cached) return cached;
    const cands = await gather();
    let first = select(cands, 15);
    if (!first.length) first = cands.slice(0, 15).map(c => c.book);
    if (!first.length) throw new Error('trending empty');

    if (!refining) {
      refining = true;
      void (async () => {
        try {
          // The candidates worth a closer look: best first impressions
          const pool = [...cands].sort((a, b) => scoreTrending(b).score - scoreTrending(a).score).slice(0, POOL);
          await mapPool(pool, 3, async c => {
            const id = identityOf(c.book);
            const r = await resolveBook({ title: c.book.title, author: c.book.author, isbn: id.isbn13 || id.isbn10, fallbackId: c.book.id, apple: true });
            if (!r) return;
            c.book = { ...mergeBooks(c.book, r.book), id: c.book.id }; // keep the Open Library record id
            c.flags = { subjects: [...(c.flags.subjects || []), ...(r.flags.subjects || [])], description: r.flags.description || c.flags.description, googleMaturity: r.flags.googleMaturity, appleAdvisory: r.flags.appleAdvisory };
          });
          let final = select(pool, 15);
          if (final.length < 8) {
            const have = new Set(final.map(b => String(b.id)));
            final = [...final, ...first.filter(b => !have.has(String(b.id)))].slice(0, 15);
          }
          dynamicShelves.set(SHELF_ID, final);
          onUpdate(final);
        } catch {
          /* the first-impression shelf stays */
        } finally {
          refining = false;
        }
      })();
    }
    return first;
  },
};
