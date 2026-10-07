import { persistentCache } from '../books/cache';
import { dedupeInflight } from '../books/http';
import type { RefreshResult, ShelfSource } from './shelves';

/**
 * Manual "refresh this shelf" (Customize Store). It calls the shelf source's own refresh(), the same code the schedule uses, and
 * adds only what a button needs: a rate limit, so tapping again and again cannot hammer an API or a website.
 *
 *  - after an attempt that worked, the shelf is left alone for 10 minutes
 *  - after one that failed, for 2 minutes (a dropped connection should be easy to retry, an outage should not be hammered)
 *  - taps while a refresh is running share that refresh
 *
 * A failed attempt never changes the shelf or its "last updated" time (that belongs to the source and only moves on success).
 */

export type ManualResult = RefreshResult | 'cooldown' | 'unsupported';

export const COOLDOWN_OK_MS = 10 * 60 * 1000;
export const COOLDOWN_FAILED_MS = 2 * 60 * 1000;

interface Attempt { at: number; ok: boolean }
const attempts = persistentCache<Attempt>('readlife.shelftried1', { ttl: 60 * 60 * 1000, max: 60 });
const running = new Map<string, Promise<ManualResult>>();

/** Milliseconds until this shelf may be refreshed by hand again (0 = now). */
export function cooldownLeft(id: string, now = Date.now()): number {
  const a = attempts.get(id);
  return a ? Math.max(0, a.at + (a.ok ? COOLDOWN_OK_MS : COOLDOWN_FAILED_MS) - now) : 0;
}

export const isRefreshing = (id: string) => running.has(id);

export function manualRefresh(source: Pick<ShelfSource, 'id' | 'refresh'>, now = Date.now()): Promise<ManualResult> {
  const { refresh } = source;
  if (!refresh) return Promise.resolve('unsupported');
  const pending = running.get(source.id);
  if (pending) return pending;
  if (cooldownLeft(source.id, now) > 0) return Promise.resolve('cooldown');
  return dedupeInflight(running, source.id, async () => {
    let result: RefreshResult;
    try { result = await refresh(); } catch { result = 'failed'; }
    attempts.set(source.id, { at: Date.now(), ok: result !== 'failed' });
    return result;
  });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Updated just now / 5 min ago / 2 hours ago / yesterday / Oct 1 (2025 when it is another year)". */
export function formatUpdated(at: number | undefined, now = Date.now()): string {
  if (!at) return 'Not refreshed yet';
  const age = Math.max(0, now - at);
  const min = Math.floor(age / 60000);
  if (min < 1) return 'Updated just now';
  if (min < 60) return `Updated ${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `Updated ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const d = new Date(at), n = new Date(now);
  const yesterday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
  if (d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate()) return 'Updated yesterday';
  return `Updated ${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() === n.getFullYear() ? '' : `, ${d.getFullYear()}`}`;
}

/** "Try again in 8 min" for the button's tooltip. */
export const waitLabel = (ms: number) => (ms >= 60000 ? `${Math.ceil(ms / 60000)} min` : 'a moment');
