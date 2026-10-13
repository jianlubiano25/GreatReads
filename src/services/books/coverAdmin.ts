/**
 * The owner's hidden cover tools. Nothing here is security: it only keeps the cover button and "Publish book covers" out of everyone's way.
 * Tapping the name in the Today greeting five times switches the tools on (five more switch them off). What really protects the shared covers
 * is the secret token the server checks when something is published (functions/api/covers.js); it is typed once and kept on this device only,
 * never in a backup.
 */
const ON_KEY = 'readlife.coverAdmin1';
const TOKEN_KEY = 'readlife.coverToken1';
const TAPS = 5;
const WINDOW_MS = 3000;

const read = (k: string): string => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
let on = read(ON_KEY) === '1';
const listeners = new Set<() => void>();

export const isCoverAdminOn = (): boolean => on;
export const subscribeCoverAdmin = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function setCoverAdmin(next: boolean): void {
  if (next === on) return;
  on = next;
  try { next ? localStorage.setItem(ON_KEY, '1') : localStorage.removeItem(ON_KEY); } catch {}
  listeners.forEach(l => l());
}

let taps: number[] = [];
/** Call on every tap of the name. Returns the new state (true = tools shown) on the fifth tap within 3 seconds, else undefined. */
export function tapSecret(now = Date.now()): boolean | undefined {
  taps = taps.filter(t => now - t < WINDOW_MS);
  taps.push(now);
  if (taps.length < TAPS) return undefined;
  taps = [];
  setCoverAdmin(!on);
  return on;
}

export const getCoverToken = (): string => read(TOKEN_KEY);
export function setCoverToken(token: string): void {
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch {}
}
