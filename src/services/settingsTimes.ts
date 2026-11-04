/**
 * Phase 5: when the reader last changed each small per-device setting that now syncs (store layout, fonts, nook toggles, name choices).
 * A leaf module (imports nothing) so every setter can stamp a change without import cycles.
 *
 * A stamp is strictly later than the previous one for the same group, so a change made after seeing a value always beats it.
 * A group with no stamp holds a legacy value (made before stamping existed): any real change beats it.
 */
export type SettingGroup = 'storeLayout' | 'fonts' | 'nookToggles' | 'nameChoices';
export const SETTING_GROUPS: readonly SettingGroup[] = ['storeLayout', 'fonts', 'nookToggles', 'nameChoices'];
export const SETTING_TIMES_KEY = 'readlife.settingsTimes1';

export function loadSettingTimes(): Partial<Record<SettingGroup, number>> {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTING_TIMES_KEY) || '{}');
    const out: Partial<Record<SettingGroup, number>> = {};
    for (const g of SETTING_GROUPS) { const t = raw?.[g]; if (typeof t === 'number' && Number.isFinite(t) && t > 0) out[g] = Math.round(t); }
    return out;
  } catch { return {}; }
}
export const settingTime = (g: SettingGroup): number => loadSettingTimes()[g] ?? 0;

/** Remember the time a group was set to a value that came from the cloud or a backup (no upload is triggered). */
export function setSettingTime(g: SettingGroup, at: number): void {
  try { localStorage.setItem(SETTING_TIMES_KEY, JSON.stringify({ ...loadSettingTimes(), [g]: Math.max(1, Math.round(at)) })); } catch {}
}

/** Tells the cloud sync that a synced preference changed on this device, so it uploads soon instead of waiting for the next other edit. */
export const announceLocalChange = () => { try { if (typeof window !== 'undefined') window.dispatchEvent(new Event('greatreads-library-local-change')); } catch {} };

/** The reader changed this group on this device: stamp it (strictly later than before) and ask the sync to upload. */
export function stampSetting(g: SettingGroup, now = Date.now()): number {
  const at = Math.max(now, settingTime(g) + 1);
  setSettingTime(g, at);
  announceLocalChange();
  return at;
}
