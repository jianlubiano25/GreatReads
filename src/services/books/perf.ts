/**
 * Measurement for the book system (startup, Store opening, requests, caches). It only counts and times things: it never changes what the
 * app does, never throws, and costs a few object writes. Used to find out WHERE time and requests go instead of guessing.
 *
 * Read it in the browser console (Safari Web Inspector on a Mac, connected to the iPhone / iPad):
 *   __rlPerf()          the counters, the milestones and the last failed requests
 *   __rlPerf.reset()    start counting again (e.g. just before opening the Store)
 * The last 40 failed requests are also kept in localStorage ('readlife.perflog'), and Profile > Copy diagnostics copies everything as text on a device
 * where the console is hard to reach (iPhone / iPad without a Mac). Nothing here is sent anywhere.
 */

import { APP_VERSION } from '../appVersion';

export interface FailedRequest { at: number; host: string; path: string; status: number; failure?: string; ms?: number }
/** A request this slow (ms) is kept in the log even when it succeeded. */
export const SLOW_MS = 3000;

const counters: Record<string, number> = {};
const milestones: Record<string, number> = {};
const failures: FailedRequest[] = [];
const LOG_KEY = 'readlife.perflog';
const MAX_FAILURES = 40;

/** Count one thing (or `n` of it): "net.itunes.apple.com", "resolve.cacheHit", "cache.readlife.resolved3.saveBytes" ... */
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
export function recordRequest(url: string, status: number, failure?: string, attempts = 1, ms?: number): void {
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
  if (ms !== undefined && failure !== 'aborted') {
    bump(`net.ms.${host}`, ms);
    if (ms >= SLOW_MS) {
      bump('net.slow'); bump(`net.slow.${host}`);
      if (!failure) { // slow but fine: still worth seeing on the device log
        failures.push({ at: Date.now(), host, path, status, failure: 'slow', ms: Math.round(ms) });
        if (failures.length > MAX_FAILURES) failures.splice(0, failures.length - MAX_FAILURES);
        try { localStorage.setItem(LOG_KEY, JSON.stringify(failures)); } catch {}
      }
    }
  }
  if (!failure) return;
  if (failure === 'aborted') { bump('net.aborted'); return; } // a superseded request, not a failure
  bump('net.failed');
  bump(`net.failed.${host}.${status || failure}`);
  failures.push({ at: Date.now(), host, path, status, failure, ms: ms === undefined ? undefined : Math.round(ms) });
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

/** The last settled searches (what was typed, what each source gave and how fast), so "search found nothing" can be told apart from "a source was down or slow". */
export interface SearchTrace { at: number; q: string; ms: number; shown: number; failed: string[]; usedSaved: boolean; sources: { name: string; n: number; ms: number }[] }
const searches: SearchTrace[] = [];
export function recordSearch(t: SearchTrace): void {
  searches.push(t);
  if (searches.length > 12) searches.splice(0, searches.length - 12);
}

/** What the device's saved data (localStorage) holds: the total and the biggest keys, in characters (the browser's budget is about 2.5-5 million). Sizes only, never contents. */
export function storageReport(): { totalChars: number; biggest: string[] } | undefined {
  try {
    const rows: [string, number][] = [];
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const n = k.length + (localStorage.getItem(k) || '').length;
      total += n;
      rows.push([k, n]);
    }
    rows.sort((a, b) => b[1] - a[1]);
    return { totalChars: total, biggest: rows.slice(0, 14).map(([k, n]) => `${k}: ${n}`) };
  } catch { return undefined; }
}

/** The snapshot as plain text a person can paste into a chat (hosts, request paths, counts, times; no library or account data). Used by Profile > Copy diagnostics. */
export const clock12 = (d: Date): string => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
/** Built from the live counters at the moment it is called, never kept: every copy is a new reading. `generated` says when, and for how long the app has been open, so an old paste is easy to spot. */
export const diagnosticsText = (): string => {
  const snap = perfSnapshot();
  const now = new Date();
  const upMs = typeof performance !== 'undefined' ? Math.round(performance.now()) : undefined;
  const generated = { at: now.toISOString(), local: clock12(now), appOpenMin: upMs === undefined ? undefined : Math.round(upMs / 600) / 100 };
  const hosts = Object.keys(snap.counters).filter(k => k.startsWith('net.ms.')).map(k => `${k.slice(7)}: ${Math.round(snap.counters[k])} ms total over ${snap.counters[`net.${k.slice(7)}`] ?? '?'} requests`);
  return JSON.stringify({ version: APP_VERSION, when: generated.at, generated, storage: storageReport(), searches: searches.map(x => ({ ...x, q: x.q.slice(0, 60) })), upMs, hosts, ...snap }, null, 1);
};

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
