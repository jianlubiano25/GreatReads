/**
 * Phase 4: independent cloud records for settings (table user_settings, one row per key) and saved words (table user_words, one row per word),
 * so a change to one setting can no longer pause, overwrite or conflict with the others (they used to share ONE preferences JSON and ONE revision).
 *
 * - OFF by default. Nothing here reads or writes the new tables until the switch is on (see settingsRecordsSyncEnabled).
 * - preferences.* in the cloud is never modified by this path: with the switch on it is only read as the starting value; switching off is lossless.
 * - Per setting: the later edited_at wins. Equal value is never a conflict. Equal edited_at with a different value, or two never-edited (legacy)
 *   different values, overwrite NOTHING: both are kept and the setting is recorded as a tie for the owner. A local clock more than a minute ahead
 *   of now, or a cloud edit time more than a minute ahead of the server's own updated_at, cannot be trusted and also becomes a tie.
 * - A setting with no cloud row is never a deletion. Only a row with deleted_at is.
 * - The garden is not "latest wins": its peaks are high-water marks, so it merges with mergeGarden both ways and never ties.
 * - Words reuse mergeWordsByTime (the Phase 3 rules, including tombstones); each word is one record, so the later edit to a word wins as a whole.
 * - Pure merge functions first, cloud access and the one orchestrating function (syncSettingsRecords) last.
 */
import type { ReadingState, WordItem } from '../types';
import { currentUser, rest } from './supabase';
import { deviceId } from './cloudSync';
import { mergeGarden } from './librarySyncMerge';
import { mergeWordsByTime, timeKey, type Times } from './editTimes';
import { exportNookLook, restoreNookLook } from './nookPrefs';
import { settingsRecordsSyncEnabled, setSettingsRecordsOverride, SETTINGS_RECORDS_FLAG_KEY } from './settingsRecordsFlag';
import { applyDeviceSettings, exportDeviceSettings, type DeviceSettings } from './deviceSettings';

export { SETTINGS_RECORDS_FLAG_KEY, setSettingsRecordsOverride, settingsRecordsSyncEnabled };
export const CLOCK_SKEW_MS = 60_000;
const DEFAULT_GOAL = 10;

/* ---------- settings ---------- */

export const SETTING_KEYS = ['goal', 'reading_intention', 'profile_name', 'theme', 'garden', 'nook_look', 'store_layout', 'fonts', 'nook_toggles', 'name_choices'] as const;
export type SettingKey = typeof SETTING_KEYS[number];
export type LocalSetting = { value: unknown; at: number; deviceId?: string; editSeq?: number };
export type CloudSetting = { user_id: string; key: string; value: unknown; edited_at: string; device_id: string | null; edit_seq: number; revision: number; updated_at?: string; deleted_at: string | null };
export type SettingDecision = 'skip' | 'same' | 'take-cloud' | 'push-local' | 'tie';
export type SettingTie = { key: SettingKey; localValue: unknown; localEditedAt: number; cloudValue: unknown; cloudEditedAt: number; cloudDeviceId: string; cloudEditSeq: number };
export type SettingMeta = Record<string, { seen: string; at: number; deviceId: string; editSeq: number }>;

/** JSON with object keys sorted, because the database returns jsonb keys in its own order and key order must never look like a change. */
export const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, (x as Record<string, unknown>)[k]])) : x));
const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const timeOf = (iso: string | undefined | null): number => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : 0; };
const iso = (ms: number) => new Date(Math.max(0, ms)).toISOString();

export function decideSetting(local: LocalSetting | undefined, cloud: CloudSetting | undefined, now: number): SettingDecision {
  if (!cloud) return local === undefined ? 'skip' : 'push-local';
  const cloudAt = timeOf(cloud.edited_at), localAt = local?.at ?? 0;
  if (cloud.deleted_at) {
    if (local === undefined) return 'same';
    return localAt > cloudAt ? 'push-local' : localAt < cloudAt ? 'take-cloud' : 'tie';
  }
  if (local === undefined) return 'take-cloud';
  if (same(local.value, cloud.value)) return 'same';
  const localUntrusted = localAt > now + CLOCK_SKEW_MS;
  const cloudUntrusted = cloud.updated_at ? cloudAt - timeOf(cloud.updated_at) > CLOCK_SKEW_MS : false;
  if (localAt > cloudAt) return localUntrusted ? 'tie' : 'push-local';
  if (cloudAt > localAt) return cloudUntrusted ? 'tie' : 'take-cloud';
  return 'tie'; // same time (including two legacy never-edited values) but different values: never overwrite either
}

export type TakenSetting = { value: unknown; at: number; deviceId: string; editSeq: number; deleted?: boolean };
export type SettingsMerge = { take: Partial<Record<SettingKey, TakenSetting>>; push: { key: SettingKey; value: unknown; at: number; deviceId: string; editSeq: number }[]; ties: SettingTie[] };

/** Merge the cloud's settings into this device's, key by key. Never lowers or removes a setting unless the cloud copy is genuinely newer or explicitly deleted. */
export function mergeSettings(local: Partial<Record<SettingKey, LocalSetting>>, rows: CloudSetting[], now = Date.now()): SettingsMerge {
  const byKey = new Map(rows.map(r => [r.key, r]));
  const out: SettingsMerge = { take: {}, push: [], ties: [] };
  for (const key of SETTING_KEYS) {
    const mine = local[key], cloud = byKey.get(key);
    const cloudMeta = cloud ? { at: timeOf(cloud.edited_at), deviceId: cloud.device_id || '', editSeq: Number(cloud.edit_seq) || 0 } : undefined;
    if (key === 'garden') {
      if (cloud && !cloud.deleted_at && cloud.value && typeof cloud.value === 'object' && mine?.value && typeof mine.value === 'object') {
        const merged = mergeGarden(mine.value as ReadingState['garden'], cloud.value as ReadingState['garden']);
        if (!same(merged, mine.value)) out.take.garden = { value: merged, ...cloudMeta! };
        if (!same(merged, cloud.value)) out.push.push({ key, value: merged, at: Math.max(mine.at, cloudMeta!.at), deviceId: mine.deviceId || deviceId(), editSeq: mine.editSeq ?? 0 });
        continue;
      }
    }
    const decision = decideSetting(mine, cloud, now);
    if (decision === 'push-local' && mine) out.push.push({ key, value: mine.value, at: mine.at, deviceId: mine.deviceId || deviceId(), editSeq: mine.editSeq ?? 0 });
    else if (decision === 'tie' && cloud && mine) out.ties.push({ key, localValue: mine.value, localEditedAt: mine.at, cloudValue: cloud.value, cloudEditedAt: cloudMeta!.at, cloudDeviceId: cloudMeta!.deviceId, cloudEditSeq: cloudMeta!.editSeq });
    else if (decision === 'take-cloud' && cloud) out.take[key] = cloud.deleted_at ? { value: undefined, deleted: true, ...cloudMeta! } : { value: cloud.value, ...cloudMeta! };
  }
  return out;
}

/** Remember when this device's reader last changed each setting. A value that differs from the last one seen is a change made now; a first sighting is a legacy value (time 0), which any real edit beats. */
export function stampSettings(current: Partial<Record<SettingKey, unknown>>, meta: SettingMeta, now = Date.now(), device = deviceId()): SettingMeta {
  const next: SettingMeta = { ...meta };
  for (const key of SETTING_KEYS) {
    if (!(key in current)) continue;
    const json = canon(current[key]), prev = meta[key];
    if (!prev) next[key] = { seen: json, at: 0, deviceId: device, editSeq: 0 };
    else if (prev.seen !== json) next[key] = { seen: json, at: Math.max(now, prev.at + 1), deviceId: device, editSeq: prev.editSeq + 1 };
  }
  return next;
}

type StateSlice = Pick<ReadingState, 'goal' | 'readingIntention' | 'profile' | 'garden'>;
const gardenHasContent = (g: ReadingState['garden'] | undefined) => !!g && (Object.keys(g.plants || {}).length > 0 || Object.keys(g.achievements || {}).length > 0 || Object.values(g.peaks || {}).some(Boolean));

/** The values this device would sync, leaving out anything still at its default and never edited (so a new device never offers defaults as if they were choices). */
export function collectLocalValues(state: StateSlice, meta: SettingMeta, device: DeviceSettings | undefined, nookLook: unknown): Partial<Record<SettingKey, unknown>> {
  const out: Partial<Record<SettingKey, unknown>> = {};
  const edited = (k: SettingKey) => !!meta[k]; // seen before: a change back to the default is still a change
  if (edited('goal') || (state.goal && state.goal !== DEFAULT_GOAL)) out.goal = state.goal;
  if (edited('reading_intention') || state.readingIntention) out.reading_intention = state.readingIntention || '';
  if (edited('profile_name') || state.profile?.name) out.profile_name = state.profile?.name || '';
  if (edited('theme') || (state.profile?.theme && state.profile.theme !== 'auto')) out.theme = state.profile?.theme || 'auto';
  if (gardenHasContent(state.garden)) out.garden = state.garden;
  if (nookLook !== undefined || edited('nook_look')) out.nook_look = nookLook ?? {};
  if (device?.storeLayout) out.store_layout = device.storeLayout.value;
  if (device?.fonts) out.fonts = device.fonts.value;
  if (device?.nookToggles) out.nook_toggles = device.nookToggles.value;
  if (device?.nameChoices) out.name_choices = device.nameChoices.value;
  return out;
}

const DEVICE_KEYS: Partial<Record<SettingKey, keyof DeviceSettings>> = { store_layout: 'storeLayout', fonts: 'fonts', nook_toggles: 'nookToggles', name_choices: 'nameChoices' };
/** Local values with their edit times: stamped by the meta for state settings, and by each group's own time for the four device settings. */
export function withTimes(values: Partial<Record<SettingKey, unknown>>, meta: SettingMeta, device: DeviceSettings | undefined): Partial<Record<SettingKey, LocalSetting>> {
  const out: Partial<Record<SettingKey, LocalSetting>> = {};
  for (const key of SETTING_KEYS) {
    if (!(key in values)) continue;
    const group = DEVICE_KEYS[key];
    out[key] = group ? { value: values[key], at: device?.[group]?.at ?? 0, deviceId: deviceId(), editSeq: 0 } : { value: values[key], at: meta[key]?.at ?? 0, deviceId: meta[key]?.deviceId, editSeq: meta[key]?.editSeq };
  }
  return out;
}

/** Put the cloud's newer values on the state. Returns the same object when nothing changes (so it never causes a re-render loop). */
export function applySettingsToState<T extends StateSlice>(prev: T, take: SettingsMerge['take']): T {
  let next = prev;
  const t = (k: SettingKey) => take[k];
  if (t('goal') && !t('goal')!.deleted && Number.isFinite(Number(t('goal')!.value)) && next.goal !== Number(t('goal')!.value)) next = { ...next, goal: Number(t('goal')!.value) };
  if (t('reading_intention') && typeof t('reading_intention')!.value === 'string' && next.readingIntention !== t('reading_intention')!.value) next = { ...next, readingIntention: t('reading_intention')!.value as string };
  if (t('profile_name') && typeof t('profile_name')!.value === 'string' && next.profile.name !== t('profile_name')!.value) next = { ...next, profile: { ...next.profile, name: t('profile_name')!.value as string } };
  const theme = t('theme')?.value;
  if (t('theme') && (theme === 'auto' || theme === 'light' || theme === 'dark') && next.profile.theme !== theme) next = { ...next, profile: { ...next.profile, theme } };
  if (t('garden') && t('garden')!.value && typeof t('garden')!.value === 'object' && !same(next.garden, t('garden')!.value)) next = { ...next, garden: t('garden')!.value as ReadingState['garden'] };
  return next;
}

/* ---------- words ---------- */

export type CloudWord = { user_id: string; word_id: string; data: unknown; edited_at: string; device_id: string | null; edit_seq: number; revision: number; updated_at?: string; deleted_at: string | null };
export type WordPush = { id: string; word?: WordItem; at: number; deleted: boolean };
export type WordsSlice = { words: WordItem[]; editTimes?: Record<string, number>; deletedWords?: Record<string, number> };
export type WordsMerge = { words: WordItem[]; editTimes: Record<string, number>; deletedWords: Record<string, number>; push: WordPush[]; changed: boolean };

/** Merge the cloud's words into this device's with the Phase 3 rules, and work out which words the cloud still needs. */
export function mergeWordRows(state: WordsSlice, rows: CloudWord[]): WordsMerge {
  const live = rows.filter(r => !r.deleted_at && r.data && typeof r.data === 'object');
  const times: Times = {}, deleted: Record<string, number> = {};
  for (const r of live) { const at = timeOf(r.edited_at); if (at > 0) times[timeKey('word', r.word_id)] = at; }
  for (const r of rows) if (r.deleted_at) { const at = timeOf(r.deleted_at); if (at > 0) deleted[r.word_id] = at; }
  const merged = mergeWordsByTime(
    { words: state.words, times: state.editTimes, deleted: state.deletedWords },
    { words: live.map(r => ({ ...(r.data as WordItem), id: r.word_id })), times, deleted },
  );
  const byId = new Map(rows.map(r => [r.word_id, r]));
  const push: WordPush[] = [];
  for (const w of merged.words) {
    const cloud = byId.get(w.id), at = merged.times[timeKey('word', w.id)] ?? 0;
    if (!cloud || cloud.deleted_at || !same({ ...(cloud.data as object), id: w.id }, w)) {
      const cloudAt = cloud && !cloud.deleted_at ? timeOf(cloud.edited_at) : -1;
      if (!cloud || cloud.deleted_at || at >= cloudAt) push.push({ id: w.id, word: w, at, deleted: false });
    }
  }
  for (const [id, at] of Object.entries(merged.deleted)) {
    if (merged.words.some(w => w.id === id)) continue;
    const cloud = byId.get(id);
    if (!cloud || !cloud.deleted_at) push.push({ id, at, deleted: true });
  }
  const wordTimes = (t: Record<string, number> | undefined) => Object.fromEntries(Object.entries(t || {}).filter(([k]) => k.startsWith('word:')));
  const changed = !same(merged.words, state.words) || !same(merged.times, wordTimes(state.editTimes)) || !same(merged.deleted, state.deletedWords || {});
  return { words: merged.words, editTimes: merged.times, deletedWords: merged.deleted, push, changed };
}

export function applyWordMerge<T extends WordsSlice>(prev: T, rows: CloudWord[]): T {
  const m = mergeWordRows(prev, rows);
  if (!m.changed) return prev;
  const next: T = { ...prev, words: m.words };
  const others = Object.fromEntries(Object.entries(prev.editTimes || {}).filter(([k]) => !k.startsWith('word:'))); // other edit kinds (status, notes...) share this map: keep them
  if (Object.keys(others).length || Object.keys(m.editTimes).length) next.editTimes = { ...others, ...m.editTimes };
  if (Object.keys(m.deletedWords).length) next.deletedWords = m.deletedWords; else delete next.deletedWords;
  return next;
}

/* ---------- cloud access ---------- */

const PAGE = 500;
async function loadAll<T>(table: string, order: string, userId: string): Promise<T[] | null> {
  const all: T[] = [];
  for (let offset = 0; offset < 20_000; offset += PAGE) {
    const r = await rest<T[]>(`${table}?user_id=eq.${encodeURIComponent(userId)}&select=*&order=${order}&limit=${PAGE}&offset=${offset}`);
    if (!r.ok || !Array.isArray(r.data)) return null;
    all.push(...r.data);
    if (r.data.length < PAGE) return all;
  }
  return null;
}
export const loadCloudSettings = (userId: string) => loadAll<CloudSetting>('user_settings', 'key.asc', userId);
export const loadCloudWords = (userId: string) => loadAll<CloudWord>('user_words', 'word_id.asc', userId);

/** Insert rows the cloud has none of; update the others only if the revision is still the one just read (someone else wrote first → false, and the next round re-reads and decides again). */
async function upsertRows(table: string, pk: 'key' | 'word_id', userId: string, items: { id: string; body: Record<string, unknown> }[], existing: Map<string, { revision: number }>): Promise<boolean> {
  const fresh: Record<string, unknown>[] = [];
  for (const { id, body } of items) {
    const cloud = existing.get(id);
    if (!cloud) { fresh.push({ user_id: userId, [pk]: id, ...body, revision: 1 }); continue; }
    const r = await rest<unknown[]>(`${table}?user_id=eq.${encodeURIComponent(userId)}&${pk}=eq.${encodeURIComponent(id)}&revision=eq.${cloud.revision}`, { method: 'PATCH', prefer: 'return=representation', body: { ...body, revision: cloud.revision + 1 } });
    if (!r.ok || !Array.isArray(r.data) || r.data.length !== 1) return false;
  }
  for (let i = 0; i < fresh.length; i += 100) {
    const r = await rest(table, { method: 'POST', prefer: 'return=minimal', body: fresh.slice(i, i + 100) });
    if (!r.ok) return false;
  }
  return true;
}
export const pushSettingRows = (userId: string, push: SettingsMerge['push'], rows: CloudSetting[]) =>
  upsertRows('user_settings', 'key', userId, push.map(p => ({ id: p.key, body: { value: p.value ?? null, edited_at: iso(p.at), device_id: p.deviceId, edit_seq: p.editSeq, deleted_at: null } })), new Map(rows.map(r => [r.key, r])));
export const pushWordRows = (userId: string, push: WordPush[], rows: CloudWord[], device = deviceId()) =>
  upsertRows('user_words', 'word_id', userId, push.map(p => p.deleted
    ? { id: p.id, body: { data: { id: p.id }, edited_at: iso(p.at), device_id: device, edit_seq: 0, deleted_at: iso(p.at) } }
    : { id: p.id, body: { data: p.word, edited_at: iso(p.at), device_id: device, edit_seq: 0, deleted_at: null } }), new Map(rows.map(r => [r.word_id, r])));

/* ---------- local bookkeeping ---------- */

const metaKey = (userId: string) => `readlife.settingsRecordsMeta1.${encodeURIComponent(userId)}`;
const tiesKey = (userId: string) => `readlife.settingsTies1.${encodeURIComponent(userId)}`;
export function loadSettingMeta(userId: string): SettingMeta { try { const raw = JSON.parse(localStorage.getItem(metaKey(userId)) || '{}'); return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}; } catch { return {}; } }
function saveSettingMeta(userId: string, meta: SettingMeta) { try { localStorage.setItem(metaKey(userId), JSON.stringify(meta)); } catch {} }
export function loadSettingTies(userId: string): SettingTie[] { try { const raw = JSON.parse(localStorage.getItem(tiesKey(userId)) || '[]'); return Array.isArray(raw) ? raw.filter((t): t is SettingTie => !!t && typeof t.key === 'string') : []; } catch { return []; } }
function saveSettingTies(userId: string, ties: SettingTie[]) {
  const before = JSON.stringify(loadSettingTies(userId));
  try { ties.length ? localStorage.setItem(tiesKey(userId), JSON.stringify(ties)) : localStorage.removeItem(tiesKey(userId)); } catch {}
  if (before !== JSON.stringify(ties) && typeof window !== 'undefined') window.dispatchEvent(new Event('greatreads-library-sync-status'));
}

/** The owner chose for a tied setting. "device" restamps this device's value as the latest edit (it wins and uploads); "cloud" takes the cloud's value. */
export function resolveSettingTie(userId: string, key: SettingKey, choice: 'device' | 'cloud', now = Date.now()): TakenSetting | undefined {
  const tie = loadSettingTies(userId).find(t => t.key === key);
  if (!tie) return undefined;
  const meta = loadSettingMeta(userId);
  saveSettingTies(userId, loadSettingTies(userId).filter(t => t.key !== key));
  if (choice === 'device') { const prev = meta[key]; meta[key] = { seen: canon(tie.localValue), at: Math.max(now, tie.cloudEditedAt + 1, (prev?.at ?? 0) + 1), deviceId: deviceId(), editSeq: (prev?.editSeq ?? 0) + 1 }; saveSettingMeta(userId, meta); return undefined; }
  meta[key] = { seen: canon(tie.cloudValue), at: tie.cloudEditedAt, deviceId: tie.cloudDeviceId, editSeq: tie.cloudEditSeq }; saveSettingMeta(userId, meta);
  return { value: tie.cloudValue, at: tie.cloudEditedAt, deviceId: tie.cloudDeviceId, editSeq: tie.cloudEditSeq };
}

/* ---------- one round ---------- */

type Io = { getState: () => StateSlice & WordsSlice; apply: (change: (state: ReadingState) => ReadingState) => void };
/**
 * One round: read both cloud tables; apply newer cloud values here; upload this device's newer ones; remember ties. Returns false when it should be retried.
 * With the switch off it does nothing at all and returns true.
 */
export async function syncSettingsRecords(userId: string, io: Io): Promise<boolean> {
  if (!settingsRecordsSyncEnabled()) return true;
  if (currentUser()?.id !== userId || (typeof navigator !== 'undefined' && navigator.onLine === false)) return false;
  const [settingRows, wordRows] = await Promise.all([loadCloudSettings(userId), loadCloudWords(userId)]);
  if (!settingRows || !wordRows || currentUser()?.id !== userId) return false;
  const now = Date.now();
  const snapshot = io.getState();
  const device = exportDeviceSettings();
  const meta = stampSettings(collectLocalValues(snapshot, loadSettingMeta(userId), device, exportNookLook()), loadSettingMeta(userId), now);
  const values = collectLocalValues(snapshot, meta, device, exportNookLook());
  const merge = mergeSettings(withTimes(values, meta, device), settingRows, now);
  // Apply what the cloud has that is newer.
  for (const [key, taken] of Object.entries(merge.take) as [SettingKey, TakenSetting][]) meta[key] = { seen: canon(taken.value), at: taken.at, deviceId: taken.deviceId, editSeq: taken.editSeq };
  saveSettingMeta(userId, meta);
  const t = merge.take;
  if (Object.keys(t).length) {
    io.apply(prev => applySettingsToState(prev, t));
    if (t.nook_look && !t.nook_look.deleted && t.nook_look.value && typeof t.nook_look.value === 'object') restoreNookLook(JSON.stringify({ nookLook: t.nook_look.value }));
    const dev: DeviceSettings = {};
    if (t.store_layout && !t.store_layout.deleted) dev.storeLayout = { value: t.store_layout.value as never, at: t.store_layout.at };
    if (t.fonts && !t.fonts.deleted) dev.fonts = { value: t.fonts.value as never, at: t.fonts.at };
    if (t.nook_toggles && !t.nook_toggles.deleted) dev.nookToggles = { value: t.nook_toggles.value as never, at: t.nook_toggles.at };
    if (t.name_choices && !t.name_choices.deleted) dev.nameChoices = { value: t.name_choices.value as never, at: t.name_choices.at };
    if (Object.keys(dev).length) applyDeviceSettings(dev);
  }
  saveSettingTies(userId, merge.ties);
  const words = mergeWordRows(snapshot, wordRows);
  if (words.changed) io.apply(prev => applyWordMerge(prev, wordRows));
  let ok = true;
  if (merge.push.length) ok = await pushSettingRows(userId, merge.push, settingRows) && ok;
  if (words.push.length) ok = await pushWordRows(userId, words.push, wordRows) && ok;
  return ok;
}
