/**
 * Phase 5: small settings that used to live only on one device now sync, and travel in JSON backups:
 *  - storeLayout: which Store shelves come first / are hidden (readlife.storeprefs1)
 *  - fonts: title and text font (readlife.fonts1)
 *  - nookToggles: "nook matches theme" and "window follows the clock"
 *  - nameChoices: "show this name instead" per book (readlife.nameChoices1)
 * Not synced (device-local by decision): downloaded/offline flags, the sign-in session and keys, location/weather, caches.
 *
 * Each group is stamped with the time of the reader's last change. The later change wins; a group with no stamp is a legacy
 * value that any real change beats. Name choices merge per book: the newest choice wins, and a book's choice is dropped only when
 * the other side CLEARED choices after it was made. The merge is pure (no storage, no network) so it can be tested directly.
 */
import { getFontPrefs, sanitizeFontPrefs, applyFontPrefsFromSync, DEFAULT_TEXT, DEFAULT_TITLE, type FontPrefs } from './fontPrefs';
import { loadStorePrefs, sanitizeStorePrefs, applyStorePrefsFromSync, NO_PREFS, type StorePrefs } from './store/prefs';
import { applyNookTogglesFromSync, getNookMatchesTheme, getWindowFollowsTime } from './nookPrefs';
import { exportNameChoices, isNameChoice, replaceNameChoices } from './books/englishTitle';
import { loadSettingTimes, setSettingTime, stampSetting, type SettingGroup } from './settingsTimes';

export type NookToggles = { matchTheme: boolean; windowFollowsTime: boolean };
export type NameChoiceMap = Record<string, { v: { title?: 'original'; author?: string }; t: number }>;
export interface DeviceSettings {
  storeLayout?: { value: StorePrefs; at: number };
  fonts?: { value: FontPrefs; at: number };
  nookToggles?: { value: NookToggles; at: number };
  nameChoices?: { value: NameChoiceMap; at: number };
}

const DEFAULT_TOGGLES: NookToggles = { matchTheme: false, windowFollowsTime: true };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {});
const at = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };

/** Repairs settings read from the cloud or a backup. Anything unusable is dropped; nothing throws. */
export function sanitizeDeviceSettings(raw: unknown): DeviceSettings {
  const r = obj(raw), out: DeviceSettings = {};
  if (r.storeLayout && typeof r.storeLayout === 'object') out.storeLayout = { value: sanitizeStorePrefs(r.storeLayout.value), at: at(r.storeLayout.at) };
  if (r.fonts && typeof r.fonts === 'object') out.fonts = { value: sanitizeFontPrefs(r.fonts.value), at: at(r.fonts.at) };
  if (r.nookToggles && typeof r.nookToggles === 'object') { const v = obj(r.nookToggles.value); out.nookToggles = { value: { matchTheme: v.matchTheme === true, windowFollowsTime: v.windowFollowsTime !== false }, at: at(r.nookToggles.at) }; }
  if (r.nameChoices && typeof r.nameChoices === 'object') {
    const value: NameChoiceMap = {};
    for (const [k, e] of Object.entries(obj(r.nameChoices.value))) if (k && isNameChoice(obj(e).v)) value[k] = { v: { ...(obj(e).v.title ? { title: 'original' as const } : {}), ...(typeof obj(e).v.author === 'string' && obj(e).v.author ? { author: obj(e).v.author } : {}) }, t: at(obj(e).t) };
    out.nameChoices = { value, at: at(r.nameChoices.at) };
  }
  return out;
}

/** This device's synced settings. A group appears when the reader ever changed it (it has a time) or it differs from the default. */
export function exportDeviceSettings(): DeviceSettings | undefined {
  const times = loadSettingTimes(), out: DeviceSettings = {};
  const store = loadStorePrefs(); if (times.storeLayout || !same(store, NO_PREFS)) out.storeLayout = { value: store, at: times.storeLayout ?? 0 };
  const fonts = getFontPrefs(); if (times.fonts || fonts.title !== DEFAULT_TITLE || fonts.text !== DEFAULT_TEXT) out.fonts = { value: fonts, at: times.fonts ?? 0 };
  const toggles: NookToggles = { matchTheme: getNookMatchesTheme(), windowFollowsTime: getWindowFollowsTime() };
  if (times.nookToggles || !same(toggles, DEFAULT_TOGGLES)) out.nookToggles = { value: toggles, at: times.nookToggles ?? 0 };
  const names = exportNameChoices(); if (times.nameChoices || Object.keys(names).length) out.nameChoices = { value: names, at: times.nameChoices ?? 0 };
  return Object.keys(out).length ? out : undefined;
}

/** Name choices: per book, the newest choice wins; a book missing on one side is dropped only if that side cleared choices LATER than the book's choice was made. */
export function mergeNameChoices(local: { value: NameChoiceMap; at: number } | undefined, remote: { value: NameChoiceMap; at: number } | undefined): { value: NameChoiceMap; at: number } | undefined {
  if (!local) return remote; if (!remote) return local;
  const value: NameChoiceMap = {};
  for (const k of new Set([...Object.keys(local.value), ...Object.keys(remote.value)])) {
    const l = local.value[k], r = remote.value[k];
    if (l && r) value[k] = r.t > l.t ? r : l;
    else if (l) { if (!(remote.at > l.t)) value[k] = l; }   // the other side only forgot it if it changed its choices after this was made
    else if (r) { if (!(local.at > r.t)) value[k] = r; }
  }
  return { value, at: Math.max(local.at, remote.at) };
}

/**
 * Merge this device's settings with the cloud's. The later change wins per group. On an exact tie (including two legacy values) this
 * device keeps its own value, unless `tieGoesToRemote` (the cloud copy is being taken, or a first sync must not overwrite the cloud).
 */
export function mergeDeviceSettings(local: DeviceSettings | undefined, remoteRaw: unknown, tieGoesToRemote = false): DeviceSettings | undefined {
  const remote = sanitizeDeviceSettings(remoteRaw), l = local || {}, out: DeviceSettings = {};
  for (const g of ['storeLayout', 'fonts', 'nookToggles'] as const) {
    const a = l[g] as { value: any; at: number } | undefined, b = remote[g] as { value: any; at: number } | undefined;
    const pickRemote = !!b && (!a || b.at > a.at || (b.at === a.at && tieGoesToRemote));
    const chosen = pickRemote ? b : a;
    if (chosen) (out as any)[g] = { value: chosen.value, at: chosen.at };
  }
  const names = mergeNameChoices(l.nameChoices, remote.nameChoices);
  if (names) out.nameChoices = names;
  return Object.keys(out).length ? out : undefined;
}

/** Put merged settings on this device without counting it as a new edit. Only groups that differ from what is here are touched. */
export function applyDeviceSettings(next: DeviceSettings | undefined): void {
  if (!next) return;
  const have = exportDeviceSettings() || {};
  if (next.storeLayout && !same(next.storeLayout.value, have.storeLayout?.value ?? NO_PREFS)) applyStorePrefsFromSync(next.storeLayout.value);
  if (next.fonts && !same(next.fonts.value, have.fonts?.value ?? getFontPrefs())) applyFontPrefsFromSync(next.fonts.value);
  if (next.nookToggles && !same(next.nookToggles.value, have.nookToggles?.value ?? DEFAULT_TOGGLES)) applyNookTogglesFromSync(next.nookToggles.value);
  if (next.nameChoices && !same(next.nameChoices.value, have.nameChoices?.value ?? {})) replaceNameChoices(next.nameChoices.value);
  for (const g of ['storeLayout', 'fonts', 'nookToggles', 'nameChoices'] as SettingGroup[]) { const t = next[g]?.at; if (t) setSettingTime(g, t); }
}

/** Restoring a JSON backup is the reader's own choice: its settings replace this device's, and count as a change made now. A backup made before this existed leaves everything alone. */
export function restoreDeviceSettings(jsonStr: string): void {
  let raw: unknown;
  try { raw = JSON.parse(jsonStr)?.deviceSettings; } catch { return; }
  if (!raw || typeof raw !== 'object') return;
  const next = sanitizeDeviceSettings(raw);
  const groups = (['storeLayout', 'fonts', 'nookToggles', 'nameChoices'] as SettingGroup[]).filter(g => next[g]);
  applyDeviceSettings({ ...next, storeLayout: next.storeLayout && { ...next.storeLayout, at: 0 }, fonts: next.fonts && { ...next.fonts, at: 0 }, nookToggles: next.nookToggles && { ...next.nookToggles, at: 0 }, nameChoices: next.nameChoices && { ...next.nameChoices, at: 0 } });
  for (const g of groups) stampSetting(g);
}
