/**
 * Cloud backup (Supabase, signed in): the same backup text Backup & Restore makes, kept as ONE record per account, so a new phone can restore it.
 * Safe by design:
 *  - it never changes the library by itself: restoring is a button, and the current library is first saved aside on this device (readlife.preCloudRestore1);
 *  - a newer copy from another device is never overwritten silently: every upload names the revision it was based on, and the database refuses it when
 *    the cloud has moved on (a "conflict": the person chooses Restore, or Back up now to replace it on purpose);
 *  - automatic upload is off until the person turns it on, runs at most every few minutes and only when something changed.
 */
import { currentUser, rest } from './supabase';

const TYPE = 'backup';
const ID = 'main';
const REV_KEY = 'readlife.cloudRev1';
const AUTO_KEY = 'readlife.cloudAuto1';
const LAST_KEY = 'readlife.cloudLast1';
const DEVICE_KEY = 'readlife.deviceId1';
export const SAFETY_KEY = 'readlife.preCloudRestore1';
const AUTO_GAP = 5 * 60 * 1000;

const get = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };
const deviceId = () => { let d = get(DEVICE_KEY); if (!d) { d = (crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2)); put(DEVICE_KEY, d); } return d; };
const hash = (s: string): string => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return `${s.length}:${h}`; };

export type CloudStatus = { revision: number; updatedAt: string; device: string } | null;
export type CloudResult = { ok: true; note: string } | { ok: false; error: string; conflict?: boolean };

export const isAutoBackup = (): boolean => get(AUTO_KEY) === '1';
export const setAutoBackup = (on: boolean) => { on ? put(AUTO_KEY, '1') : (() => { try { localStorage.removeItem(AUTO_KEY); } catch {} })(); };
export const lastSynced = (): { at: number; conflict: boolean } => { try { const r = JSON.parse(get(LAST_KEY) || 'null'); return { at: Number(r?.at) || 0, conflict: !!r?.conflict }; } catch { return { at: 0, conflict: false }; } };
const setLast = (conflict: boolean) => put(LAST_KEY, JSON.stringify({ at: Date.now(), conflict }));

type Row = { payload: { json?: string }; revision: number; updated_at: string; device_id: string | null };
const q = `user_sync_records?record_type=eq.${TYPE}&record_id=eq.${ID}&select=payload,revision,updated_at,device_id&limit=1`;

export async function cloudStatus(): Promise<{ ok: true; status: CloudStatus } | { ok: false; error: string }> {
  if (!currentUser()) return { ok: false, error: 'Please sign in first.' };
  const r = await rest<Row[]>(q);
  if (!r.ok) return { ok: false, error: r.error };
  const row = r.data[0];
  return { ok: true, status: row ? { revision: Number(row.revision), updatedAt: row.updated_at, device: row.device_id || '' } : null };
}

/** Upload. `replace` = on purpose replace a newer cloud copy; otherwise a newer cloud copy is a conflict and nothing is written. */
export async function backUpNow(json: string, replace = false): Promise<CloudResult> {
  const user = currentUser();
  if (!user) return { ok: false, error: 'Please sign in first.' };
  try { JSON.parse(json); } catch { return { ok: false, error: 'The backup could not be read.' }; }
  const st = await cloudStatus();
  if (!st.ok) return st;
  const mine = Number(get(REV_KEY)) || 0;
  const body = { payload: { json, app: 'greatreads' }, schema_version: 1, device_id: deviceId(), updated_at: new Date().toISOString() };
  if (!st.status) {
    const ins = await rest(`user_sync_records`, { method: 'POST', body: { user_id: user.id, record_type: TYPE, record_id: ID, revision: 1, ...body } });
    if (!ins.ok) return { ok: false, error: ins.error };
    put(REV_KEY, '1'); put('readlife.cloudHash1', hash(json)); setLast(false);
    return { ok: true, note: 'Backed up to your account.' };
  }
  if (!replace && st.status.revision !== mine) { setLast(true); return { ok: false, conflict: true, error: 'Your account has a newer backup from another device (or this device has not restored it yet). Restore it, or choose Replace.' }; }
  const next = st.status.revision + 1;
  const upd = await rest<Row[]>(`user_sync_records?record_type=eq.${TYPE}&record_id=eq.${ID}&revision=eq.${st.status.revision}`, { method: 'PATCH', prefer: 'return=representation', body: { ...body, revision: next } });
  if (!upd.ok) return { ok: false, error: upd.error };
  if (!upd.data.length) { setLast(true); return { ok: false, conflict: true, error: 'The backup changed while uploading. Try again.' }; }
  put(REV_KEY, String(next)); put('readlife.cloudHash1', hash(json)); setLast(false);
  return { ok: true, note: 'Backed up to your account.' };
}

/** Download the cloud copy as backup text (nothing is changed here; the caller restores it). */
export async function fetchCloudBackup(): Promise<{ ok: true; json: string; revision: number } | { ok: false; error: string }> {
  if (!currentUser()) return { ok: false, error: 'Please sign in first.' };
  const r = await rest<Row[]>(q);
  if (!r.ok) return { ok: false, error: r.error };
  const row = r.data[0];
  if (!row?.payload?.json) return { ok: false, error: 'There is no backup in your account yet.' };
  return { ok: true, json: row.payload.json, revision: Number(row.revision) };
}

/** Call after the cloud copy was restored on this device. */
export function markRestored(revision: number, json: string) { put(REV_KEY, String(revision)); put('readlife.cloudHash1', hash(json)); setLast(false); }
/** The library as it was just before a cloud restore (one slot, this device only). */
export function saveSafetyCopy(json: string) { put(SAFETY_KEY, json); }
export const getSafetyCopy = (): string => get(SAFETY_KEY);

let lastAuto = 0;
let running = false;
/** Gentle automatic upload: only when turned on, signed in, changed, not too often, and never over a newer cloud copy. */
export async function autoBackup(exportJson: () => string): Promise<void> {
  if (running || !isAutoBackup() || !currentUser()) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const now = Date.now();
  if (now - lastAuto < AUTO_GAP) return;
  lastAuto = now;
  running = true;
  try {
    const json = exportJson();
    if (hash(json) === get('readlife.cloudHash1')) return;
    await backUpNow(json, false);
  } catch {} finally { running = false; }
}
