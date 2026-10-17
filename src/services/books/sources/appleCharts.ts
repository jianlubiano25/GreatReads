import { dedupeInflight, getJsonDetailed } from '../http';
import { persistentCache } from '../cache';
import type { CallOpts } from './types';

/**
 * Apple Books' public charts (Top Free / Top Paid). These ARE a real popularity ranking from Apple, so they are used as a
 * signal. They cover all books (fiction and non-fiction mixed); each entry carries Apple's own genre names, which is how the
 * Store tells fiction from non-fiction. No key. Loaded through this site's /api/apple-charts function first (no browser
 * cross-origin rules), then directly from Apple.
 */

export interface AppleChartEntry {
  rank: number; // 1 = top of that chart
  total: number; // entries in that chart
  chart: 'top-free' | 'top-paid';
  id: string;
  title: string;
  author: string;
  genres: string[];
  cover: string;
}

const TTL = 30 * 60 * 1000;
const cache = persistentCache<AppleChartEntry[]>('readlife.appleCharts1', { ttl: TTL, max: 4, keepStale: 24 * 60 * 60 * 1000 });
const inflight = new Map<string, Promise<AppleChartEntry[] | null>>();
const FEEDS = ['top-free', 'top-paid'] as const;

export function parseAppleChart(data: any, chart: AppleChartEntry['chart']): AppleChartEntry[] {
  const rows: any[] = data?.feed?.results || [];
  return rows
    .filter(r => r && r.name)
    .map((r, i) => ({
      rank: i + 1,
      total: rows.length,
      chart,
      id: String(r.id || ''),
      title: String(r.name).trim(),
      author: String(r.artistName || '').trim(),
      genres: ((r.genres || []) as any[]).map(g => String(g?.name || '')).filter(g => g && g !== 'Books'),
      cover: String(r.artworkUrl100 || '').replace(/\d+x\d+(bb)?\.(jpg|png)/, '600x900bb.$2'),
    }));
}

async function loadOne(chart: AppleChartEntry['chart'], opts: CallOpts & { force?: boolean }): Promise<AppleChartEntry[] | null> {
  const fresh = opts.force ? undefined : cache.get(chart);
  if (fresh) return fresh;
  return dedupeInflight(inflight, chart, async () => {
    const urls = [`/api/apple-charts?feed=${chart}&limit=100`, `https://rss.applemarketingtools.com/api/v2/us/books/${chart}/100/books.json`];
    for (const url of urls) {
      const r = await getJsonDetailed(url, { timeout: 7000, signal: opts.signal });
      const entries = r.data ? parseAppleChart(r.data, chart) : [];
      if (entries.length) {
        cache.set(chart, entries);
        return entries;
      }
    }
    if (opts.force) return null; // a manual refresh must tell a failure from a success: it never answers with the old chart
    return cache.peek(chart)?.value ?? null; // up to a day old: a chart still tells what was popular
  });
}

/** One chart (Top Free or Top Paid). `force` = a manual refresh: ask Apple again now, and null when it cannot be reached. */
export const loadAppleChart = (chart: AppleChartEntry['chart'], opts: CallOpts & { force?: boolean } = {}) => loadOne(chart, opts);
/** What is saved for a chart (up to a day old) and how old it is, without asking Apple. */
export const peekAppleChart = (chart: AppleChartEntry['chart']) => cache.peek(chart);

/** Both charts (free + paid). null when neither could be loaded. */
export async function loadAppleCharts(opts: CallOpts = {}): Promise<AppleChartEntry[] | null> {
  const lists = await Promise.all(FEEDS.map(f => loadOne(f, opts)));
  const all = lists.flatMap(l => l || []);
  return all.length ? all : null;
}

/** Forget the saved charts (used by tests). */
export const forgetAppleCharts = () => FEEDS.forEach(f => cache.delete(f));
