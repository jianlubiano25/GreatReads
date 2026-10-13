import { registerClearableKey } from './cache';
import { cleanPicks, type CoverPick } from './coverRecords';
import { notifyCoversChanged } from './covers';

/**
 * The covers published for EVERYONE (the owner's picks, served by functions/api/covers.js). Read-only here: the app keeps one copy on this
 * device, shows it at once on the next launch, and asks the server for a newer one only now and then:
 *   - not more than once every 10 minutes (and a failed try waits a minute), however often the app is opened or brought back;
 *   - with the saved ETag, so "nothing changed" costs a tiny 304 answer and no download;
 *   - never while offline, and never blocking anything: a failure just means the saved copy is used.
 * Cards re-draw only when the version really changed. The copy is re-downloadable, so it is registered as clearable.
 */

const KEY = 'readlife.sharedCovers1';
registerClearableKey(KEY);
const MIN_GAP = 10 * 60 * 1000;
const RETRY_GAP = 60 * 1000;

type Saved = { v: number; etag: string; t: number; picks: Record<string, CoverPick> };
let saved: Saved | undefined;
const copy = (): Saved => {
  if (!saved) {
    try {
      const r = JSON.parse(localStorage.getItem(KEY) || 'null');
      saved = r && typeof r === 'object' && r.picks ? { v: Number(r.v) || 0, etag: typeof r.etag === 'string' ? r.etag : '', t: Number(r.t) || 0, picks: cleanPicks(r.picks) } : { v: 0, etag: '', t: 0, picks: {} };
    } catch {
      saved = { v: 0, etag: '', t: 0, picks: {} };
    }
  }
  return saved;
};
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(copy())); } catch {} };

export const getSharedPick = (key: string): CoverPick | undefined => copy().picks[key];
export const sharedCoverPicks = (): Record<string, CoverPick> => ({ ...copy().picks });
export const sharedCoversVersion = (): number => copy().v;

/** Take a set from the server (a sync or the owner's own publish). Cards re-draw only when the version differs from what is held. */
export function applySharedCovers(v: number, picks: unknown, etag = `"${v}"`): void {
  const s = copy();
  const changed = v !== s.v;
  saved = { v, etag, t: Date.now(), picks: cleanPicks(picks) };
  persist();
  if (changed) notifyCoversChanged();
}

let syncing: Promise<boolean> | undefined;
let lastTry = 0;

/** Bring the saved copy up to date. Resolves true when the copy is current, false when it could not be checked (the saved copy stays in use). */
export function syncSharedCovers(opts: { force?: boolean } = {}): Promise<boolean> {
  if (syncing) return syncing;
  const s = copy();
  const now = Date.now();
  if (!opts.force && (now - s.t < MIN_GAP || now - lastTry < RETRY_GAP)) return Promise.resolve(now - s.t < MIN_GAP);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve(false);
  lastTry = now;
  syncing = (async () => {
    try {
      const res = await fetch('/api/covers', { headers: s.etag ? { 'If-None-Match': s.etag } : {} });
      if (res.status === 304) { s.t = Date.now(); persist(); return true; }
      if (!res.ok) return false;
      const body = await res.json();
      if (!body || typeof body !== 'object' || !body.picks || typeof body.picks !== 'object') return false;
      applySharedCovers(Number(body.v) || 0, body.picks, res.headers.get('etag') || `"${Number(body.v) || 0}"`);
      return true;
    } catch {
      return false;
    } finally {
      syncing = undefined;
    }
  })();
  return syncing;
}
