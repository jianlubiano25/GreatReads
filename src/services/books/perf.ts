/**
 * Measurement for the book system (startup, Store opening, requests, caches). It only counts and times things: it never changes what the
 * app does, never throws, and costs a few object writes. Used to find out WHERE time and requests go instead of guessing.
 *
 * Read it in the browser console (Safari Web Inspector on a Mac, connected to the iPhone / iPad):
 *   __rlPerf()          the counters, the milestones and the last failed requests
 *   __rlPerf.reset()    start counting again (e.g. just before opening the Store)
 * The last 40 failed requests are also kept in localStorage ('readlife.perflog'), which the Storage tab shows on a device
 * where the console is hard to reach. Nothing here is sent anywhere.
 */

export interface FailedRequest { at: number; host: string; path: string; status: number; failure?: string }

const counters: Record<string, number> = {};
const milestones: Record<string, number> = {};
const failures: FailedRequest[] = [];
const LOG_KEY = 'readlife.perflog';
const MAX_FAILURES = 40;

/** Count one thing (or `n` of it): "net.itunes.apple.com", "resolve.cacheHit", "cache.readlife.resolved2.saveBytes" ... */
export function bump(name: string, n = 1): void {
  counters[name] = (counters[name] || 0) + n;
}

/** Remember when something happened, in ms since the page started ("main-start", "app-mounted", "store-mounted"...). First time wins. */
export function milestone(name: string): void {
  if (name in milestones) return;
  milestones[name] = typeof performance !== 'undefined' ? Math.round(performance.now()) : Date.now();
}

/** Run `fn`, adding its duration (ms) under `name` and counting the call under `name.calls`. */
export function timed<T>(name: string, fn: () => T): T {
  const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    return fn();
  } finally {
    bump(`${name}.calls`);
    bump(`${name}.ms`, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t);
  }
}

/** One finished network request: counted per host, and kept (last 40) when it failed. */
export function recordRequest(url: string, status: number, failure?: string, attempts = 1): void {
  let host = '?';
  let path = '';
  try {
    const u = new URL(url);
    host = u.hostname;
    path = u.pathname;
  } catch {}
  bump('net.requests');
  bump(`net.${host}`, attempts);
  if (attempts > 1) bump('net.retries', attempts - 1);
  if (!failure) return;
  if (failure === 'aborted') { bump('net.aborted'); return; } // a superseded request, not a failure
  bump('net.failed');
  bump(`net.failed.${host}.${status || failure}`);
  failures.push({ at: Date.now(), host, path, status, failure });
  if (failures.length > MAX_FAILURES) failures.splice(0, failures.length - MAX_FAILURES);
  try { localStorage.setItem(LOG_KEY, JSON.stringify(failures)); } catch {}
}

export interface PerfSnapshot {
  counters: Record<string, number>;
  milestones: Record<string, number>;
  failures: FailedRequest[];
}

export const perfSnapshot = (): PerfSnapshot => ({
  counters: Object.fromEntries(Object.entries(counters).map(([k, v]) => [k, Math.round(v * 10) / 10])),
  milestones: { ...milestones },
  failures: [...failures],
});

export function resetPerf(): void {
  for (const k of Object.keys(counters)) delete counters[k];
  failures.length = 0;
  try { localStorage.removeItem(LOG_KEY); } catch {}
}

if (typeof window !== 'undefined') {
  try {
    const read: any = () => perfSnapshot();
    read.reset = resetPerf;
    (window as any).__rlPerf = read;
  } catch {}
}
