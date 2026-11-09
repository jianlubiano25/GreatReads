/**
 * A small, in-memory record of how sync is doing, shown in Backup & Restore → "Live sync status".
 * It stores only times and short messages (never your data), and resets when the app is reopened.
 * It exists so a sync problem is visible on the device instead of just "nothing changed".
 */
export type SyncPart = 'library-push' | 'library-pull' | 'daily-pages' | 'settings' | 'live-connection' | 'safety-check';

export type PartStatus = { lastOkAt?: number; lastFailAt?: number; lastError?: string; okCount: number; failCount: number };
export type LiveState = 'starting' | 'connecting' | 'connected' | 'closed' | 'refused';

const parts = new Map<SyncPart, PartStatus>();
let liveState: LiveState = 'starting';
let lastCloudEventAt = 0;
let version = 0;
const listeners = new Set<() => void>();
const bump = () => { version++; for (const l of listeners) l(); };

/** Record the result of one round of a part of sync. */
export function reportSync(part: SyncPart | 'library', ok: boolean, error?: string, at = Date.now()): void {
  const key: SyncPart = part === 'library' ? 'library-push' : part;
  const s = parts.get(key) || { okCount: 0, failCount: 0 };
  if (ok) { s.lastOkAt = at; s.okCount++; } else { s.lastFailAt = at; s.failCount++; s.lastError = (error || 'failed').slice(0, 140); }
  parts.set(key, s);
  bump();
}
export function reportLive(state: LiveState): void { if (liveState !== state) { liveState = state; bump(); } if (state === 'connected') reportSync('live-connection', true); if (state === 'refused') reportSync('live-connection', false, 'the live channel was refused; retrying'); }
export function reportCloudEvent(at = Date.now()): void { lastCloudEventAt = at; bump(); }

export type SyncStatusSnapshot = { parts: Record<string, PartStatus>; live: LiveState; lastCloudEventAt: number; version: number };
let cached: SyncStatusSnapshot | undefined;
export function getSyncStatus(): SyncStatusSnapshot {
  if (!cached || cached.version !== version) cached = { parts: Object.fromEntries(parts), live: liveState, lastCloudEventAt, version };
  return cached;
}
export const subscribeSyncStatus = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
/** Tests only. */
export function resetSyncStatus(): void { parts.clear(); liveState = 'starting'; lastCloudEventAt = 0; cached = undefined; bump(); }

/** "3 s ago", "2 min ago", "never": plain words for a time. */
export function ago(at: number | undefined, now = Date.now()): string {
  if (!at) return 'not yet';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

/** One plain-language verdict for a part: good, a problem (with the reason), or nothing yet. */
export function verdict(p: PartStatus | undefined, now = Date.now()): { ok: boolean | null; text: string } {
  if (!p || (!p.lastOkAt && !p.lastFailAt)) return { ok: null, text: 'not run yet' };
  const failedLast = (p.lastFailAt || 0) > 0 && (p.lastFailAt || 0) >= (p.lastOkAt || 0); // same instant: show the problem
  if (failedLast) return { ok: false, text: `problem ${ago(p.lastFailAt, now)}: ${p.lastError || 'failed'}${p.lastOkAt ? ` (last worked ${ago(p.lastOkAt, now)})` : ''}` };
  return { ok: true, text: `working, last ${ago(p.lastOkAt, now)}` };
}
