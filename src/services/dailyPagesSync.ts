/**
 * Daily pages sync: one cloud row per day (table user_daily_pages), merged per day by "latest edit wins".
 *
 * - Latest edited_at wins. Equal pages are never a conflict. An exact tie with different pages overwrites NOTHING: both values are kept and
 *   the owner is asked to choose (Backup & Restore). A cloud edit time later than the cloud's own server time, or a local edit time in the
 *   future, by more than a minute means a clock cannot be trusted; if that untrusted time would be the one to win, it is also a tie.
 * - A day missing from the cloud is never a deletion. Only a row with deleted_at is.
 * - Totals, streaks and best-week stay derived from dailyLog; nothing here stores a counter.
 * - On by default, with a kill switch (see dailyPagesSyncEnabled). preferences.dailyLog is never modified by this path: with the switch on it is only
 *   read, as a one-time import of days this device has never stamped; with the switch off the app behaves exactly as before.
 * - Two LEGACY values (edited_at 0 on both sides, nobody ever edited them since stamping began) are not a tie: the larger one wins, as dailyLog has
 *   always been merged. Any real edit beats a legacy value. Only two real edits at the exact same time with different pages ask the owner.
 */
import type { DayEdit, ReadingState } from '../types';
import { currentUser, rest } from './supabase';
import { deviceId } from './cloudSync';
import { DATE_KEY_RE } from './dates';

export type CloudDay = { user_id: string; day: string; pages: number; edited_at: string; device_id: string | null; edit_seq: number; revision: number; updated_at?: string; deleted_at: string | null };
export type DayTie = { day: string; localPages: number; localEditedAt: number; cloudPages: number; cloudEditedAt: number; cloudDeviceId: string; cloudEditSeq: number };
export type DayDecision = 'skip' | 'same' | 'take-cloud' | 'push-local' | 'tie';
type DaySlice = Pick<ReadingState, 'dailyLog' | 'dailyLogMeta'>;

export const CLOCK_SKEW_MS = 60_000;
export const DAILY_PAGES_FLAG_KEY = 'readlife.dailyPagesSync1';
let override: boolean | undefined;
/** Tests only. */
export const setDailyPagesSyncOverride = (value: boolean | undefined) => { override = value; };
/**
 * On unless switched off. Kill switch: localStorage "readlife.dailyPagesSync1" = "0" (one device) or the build setting VITE_DAILY_PAGES_SYNC=0 (all devices).
 * Switching off is lossless: preferences.dailyLog in the cloud is never modified by this path, so the app simply reads it again as before.
 */
export function dailyPagesSyncEnabled(): boolean {
  if (override !== undefined) return override;
  try { const flag = localStorage.getItem(DAILY_PAGES_FLAG_KEY); if (flag === '0') return false; if (flag === '1') return true; } catch {}
  try { return (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_DAILY_PAGES_SYNC !== '0'; } catch { return true; }
}

/** The stamp for a user edit of one day. Strictly later than the day's previous stamp, so an edit made after seeing a value always beats it. */
export function stampDayEdit(meta: Record<string, DayEdit> | undefined, day: string, now = Date.now(), device = deviceId()): Record<string, DayEdit> {
  const prev = meta?.[day];
  return { ...(meta || {}), [day]: { editedAt: Math.max(now, (prev?.editedAt ?? -1) + 1), deviceId: device, editSeq: (prev?.editSeq ?? 0) + 1 } };
}

const timeOf = (iso: string | undefined | null): number => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : 0; };

export function decideDay(localPages: number | undefined, meta: DayEdit | undefined, cloud: CloudDay | undefined, now: number): DayDecision {
  if (!cloud) return localPages === undefined ? 'skip' : 'push-local';
  const cloudAt = timeOf(cloud.edited_at);
  const localAt = meta?.editedAt ?? 0;
  if (cloud.deleted_at) {
    if (localPages === undefined) return 'same';
    return localAt > cloudAt ? 'push-local' : localAt < cloudAt ? 'take-cloud' : 'tie';
  }
  if (localPages === undefined) return 'take-cloud';
  if (localPages === cloud.pages) return 'same';
  const localUntrusted = localAt > now + CLOCK_SKEW_MS;
  const cloudUntrusted = cloud.updated_at ? cloudAt - timeOf(cloud.updated_at) > CLOCK_SKEW_MS : false;
  if (localAt > cloudAt) return localUntrusted ? 'tie' : 'push-local';
  if (cloudAt > localAt) return cloudUntrusted ? 'tie' : 'take-cloud';
  if (localAt === 0) return localPages > cloud.pages ? 'push-local' : 'take-cloud'; // two legacy values: the larger one, as dailyLog has always merged
  return 'tie';
}

export type DayMerge = { dailyLog: Record<string, number>; dailyLogMeta: Record<string, DayEdit>; push: string[]; ties: DayTie[]; changed: boolean };
/** Merge the cloud's days into this device's, day by day. Never lowers or removes a day unless the cloud copy is genuinely newer or explicitly deleted. */
export function mergeDailyPages(state: DaySlice, rows: CloudDay[], now = Date.now()): DayMerge {
  const dailyLog = { ...state.dailyLog };
  const dailyLogMeta = { ...(state.dailyLogMeta || {}) };
  const byDay = new Map(rows.map(row => [row.day, row]));
  const push: string[] = [], ties: DayTie[] = [];
  let changed = false;
  for (const day of new Set([...Object.keys(state.dailyLog), ...byDay.keys()])) {
    if (!DATE_KEY_RE.test(day)) continue;
    const cloud = byDay.get(day);
    const local = day in dailyLog ? dailyLog[day] : undefined;
    const decision = decideDay(local, dailyLogMeta[day], cloud, now);
    if (decision === 'push-local') push.push(day);
    else if (decision === 'tie' && cloud && local !== undefined) ties.push({ day, localPages: local, localEditedAt: dailyLogMeta[day]?.editedAt ?? 0, cloudPages: cloud.pages, cloudEditedAt: timeOf(cloud.edited_at), cloudDeviceId: cloud.device_id || '', cloudEditSeq: Number(cloud.edit_seq) || 0 });
    else if (decision === 'take-cloud' && cloud) {
      changed = true;
      if (cloud.deleted_at) { delete dailyLog[day]; delete dailyLogMeta[day]; }
      else { dailyLog[day] = cloud.pages; dailyLogMeta[day] = { editedAt: timeOf(cloud.edited_at), deviceId: cloud.device_id || '', editSeq: Number(cloud.edit_seq) || 0 }; }
    }
  }
  return { dailyLog, dailyLogMeta, push, ties, changed };
}

/** A state update that applies the cloud's days; returns the same object when nothing changes (so it never causes a re-render loop). */
export function applyDayMerge<T extends DaySlice>(prev: T, rows: CloudDay[], now = Date.now()): T {
  const merged = mergeDailyPages(prev, rows, now);
  return merged.changed ? { ...prev, dailyLog: merged.dailyLog, dailyLogMeta: merged.dailyLogMeta } : prev;
}

/** The owner chose the cloud's value for a tied day. */
export function takeCloudDay<T extends DaySlice>(prev: T, tie: DayTie): T {
  return { ...prev, dailyLog: { ...prev.dailyLog, [tie.day]: tie.cloudPages }, dailyLogMeta: { ...(prev.dailyLogMeta || {}), [tie.day]: { editedAt: tie.cloudEditedAt, deviceId: tie.cloudDeviceId, editSeq: tie.cloudEditSeq } } };
}
/** The owner chose this device's value for a tied day: a fresh edit stamp makes it the latest, so it wins and uploads. */
export function keepDeviceDay<T extends DaySlice>(prev: T, day: string, now = Date.now()): T {
  return { ...prev, dailyLogMeta: stampDayEdit(prev.dailyLogMeta, day, now) };
}

/* ---------- cloud access ---------- */

const PAGE = 500;
export async function loadCloudDays(userId: string): Promise<CloudDay[] | null> {
  const all: CloudDay[] = [];
  for (let offset = 0; offset < 20_000; offset += PAGE) {
    const r = await rest<CloudDay[]>(`user_daily_pages?user_id=eq.${encodeURIComponent(userId)}&select=*&order=day.asc&limit=${PAGE}&offset=${offset}`);
    if (!r.ok || !Array.isArray(r.data)) return null;
    all.push(...r.data);
    if (r.data.length < PAGE) return all;
  }
  return null;
}

const iso = (ms: number) => new Date(ms).toISOString();
/** Upload the given days. A day the cloud has no row for is inserted; otherwise it is updated only if the revision is still the one just read. */
export async function pushDays(userId: string, state: DaySlice, days: string[], rows: CloudDay[]): Promise<boolean> {
  const byDay = new Map(rows.map(row => [row.day, row]));
  const fresh: Record<string, unknown>[] = [];
  for (const day of days) {
    const pages = state.dailyLog[day];
    if (pages === undefined) continue;
    const meta = state.dailyLogMeta?.[day];
    const body = { pages: Math.max(0, Math.round(pages)), edited_at: iso(meta?.editedAt ?? 0), device_id: meta?.deviceId || deviceId(), edit_seq: meta?.editSeq ?? 0 };
    const cloud = byDay.get(day);
    if (!cloud) { fresh.push({ user_id: userId, day, ...body, revision: 1 }); continue; }
    const r = await rest<unknown[]>(`user_daily_pages?user_id=eq.${encodeURIComponent(userId)}&day=eq.${day}&revision=eq.${cloud.revision}`, { method: 'PATCH', prefer: 'return=representation', body: { ...body, deleted_at: null, revision: cloud.revision + 1 } });
    if (!r.ok || !Array.isArray(r.data) || r.data.length !== 1) return false; // someone else wrote first: the next round re-reads and decides again
  }
  for (let i = 0; i < fresh.length; i += 100) {
    const r = await rest('user_daily_pages', { method: 'POST', prefer: 'return=minimal', body: fresh.slice(i, i + 100) });
    if (!r.ok) return false;
  }
  return true;
}

/* ---------- ties the owner has to choose ---------- */

const TIES_PREFIX = 'readlife.dailyPagesTies1.';
const tiesKey = (userId: string) => `${TIES_PREFIX}${encodeURIComponent(userId)}`;
export function loadDailyTies(userId: string): DayTie[] {
  try { const raw = JSON.parse(localStorage.getItem(tiesKey(userId)) || '[]'); return Array.isArray(raw) ? raw.filter((t): t is DayTie => !!t && typeof t.day === 'string') : []; } catch { return []; }
}
function saveDailyTies(userId: string, ties: DayTie[]) {
  const before = JSON.stringify(loadDailyTies(userId));
  try { ties.length ? localStorage.setItem(tiesKey(userId), JSON.stringify(ties)) : localStorage.removeItem(tiesKey(userId)); } catch {}
  if (before !== JSON.stringify(ties) && typeof window !== 'undefined') window.dispatchEvent(new Event('greatreads-library-sync-status'));
}
export const hasDailyTies = (userId: string): boolean => loadDailyTies(userId).length > 0;
/** The owner's choice for a tied day (the app applies it and syncs). */
export function requestDailyTieResolution(userId: string, day: string, choice: 'device' | 'cloud'): void {
  if (currentUser()?.id !== userId || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('greatreads-daily-tie', { detail: { day, choice } }));
}

/** One round: pull the cloud's days, apply the newer ones here, upload this device's newer ones, remember any ties. Returns false when it should be retried. */
export async function syncDailyPages(userId: string, io: { getState: () => DaySlice; apply: (change: (state: ReadingState) => ReadingState) => void }): Promise<boolean> {
  if (!dailyPagesSyncEnabled()) return true;
  if (currentUser()?.id !== userId || (typeof navigator !== 'undefined' && navigator.onLine === false)) return false;
  const rows = await loadCloudDays(userId);
  if (!rows || currentUser()?.id !== userId) return false;
  const now = Date.now();
  const snapshot = io.getState();
  const merge = mergeDailyPages(snapshot, rows, now);
  if (merge.changed) io.apply(prev => applyDayMerge(prev, rows, now));
  saveDailyTies(userId, merge.ties);
  if (!merge.push.length) return true;
  return pushDays(userId, snapshot, merge.push, rows);
}
