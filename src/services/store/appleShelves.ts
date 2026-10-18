import type { Book } from '../../types';
import { filterEligible, rememberExcluded } from '../books/eligibility';
import { isBlocked } from '../books/quality';
import { appleFeedOf, loadAppleChart, peekAppleChart, type AppleChartEntry } from '../books/sources/appleCharts';
import { appleEntryToBook } from './collate';
import type { RefreshResult, ShelfSource } from './shelves';

/**
 * Apple Books' own charts as Store shelves. The order is Apple's; the only change is that books the app keeps out of every shelf
 * (explicit, sex manuals, satanic: books/quality.ts) are skipped and remembered as excluded, so no other shelf brings them back.
 * Apple lists fiction and non-fiction together on these charts. The charts themselves are loaded and saved by books/sources/appleCharts.ts.
 */
export interface AppleShelf { id: string; chart: AppleChartEntry['chart']; title: string; limit: number }

export const APPLE_SHELVES: AppleShelf[] = [
  { id: 'apple-top-free', chart: 'top-free', title: 'Apple Books · Top Free', limit: 15 },
  { id: 'apple-top-paid', chart: 'top-paid', title: 'Apple Books · Top Paid', limit: 15 },
  { id: 'apple-audio-top', chart: 'audio-top', title: 'Apple Books · Top Audiobooks', limit: 15 },
];

/** Every Apple chart is off by default except Top Paid; turn the others on in Customize Shelves. */
export const APPLE_SHELVES_ON_BY_DEFAULT = new Set(['apple-top-paid']);

export function chartBooks(entries: AppleChartEntry[], limit: number): Book[] {
  const out: Book[] = [];
  for (const e of entries) {
    const book = appleEntryToBook(e);
    if (isBlocked(e.title, { subjects: e.genres })) { rememberExcluded(book); continue; }
    out.push(book);
  }
  return filterEligible(out).slice(0, limit);
}

export function appleShelfSource(shelf: AppleShelf): ShelfSource {
  return {
    id: shelf.id,
    cached: () => {
      const hit = peekAppleChart(shelf.chart);
      const books = hit ? chartBooks(hit.value, shelf.limit) : [];
      return books.length ? books : null;
    },
    info: () => {
      const hit = peekAppleChart(shelf.chart);
      return {
        updatedAt: hit ? Date.now() - hit.ageMs : undefined,
        schedule: 'Apple updates its charts daily · checked every 30 minutes when opened',
        source: 'Apple Books charts (official)',
        kind: 'official',
        handle: `apple-books/${appleFeedOf(shelf.chart).media}/${appleFeedOf(shelf.chart).kind}`,
      };
    },
    refresh: async (): Promise<RefreshResult> => {
      const before = peekAppleChart(shelf.chart);
      const entries = await loadAppleChart(shelf.chart, { force: true });
      if (!entries?.length) return 'failed';
      const key = (es: AppleChartEntry[]) => es.slice(0, shelf.limit * 2).map(e => e.id).join(',');
      return before && key(before.value) === key(entries) ? 'unchanged' : 'updated';
    },
    load: async () => {
      const entries = await loadAppleChart(shelf.chart);
      const books = entries ? chartBooks(entries, shelf.limit) : [];
      if (!books.length) throw new Error('Apple chart unavailable');
      return books;
    },
  };
}
