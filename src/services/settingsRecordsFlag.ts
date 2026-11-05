/** Leaf module (imports nothing) so supabase.ts can read the Phase 4 switch without an import cycle. ON for every signed-in account. Emergency kill switch only: localStorage "readlife.settingsRecordsSync1" = "0" (one device) or VITE_SETTINGS_RECORDS_SYNC=0 (all devices); it falls back to the old shared preferences record, losslessly. */
export const SETTINGS_RECORDS_FLAG_KEY = 'readlife.settingsRecordsSync1';
let override: boolean | undefined;
/** Tests only. */
export const setSettingsRecordsOverride = (value: boolean | undefined) => { override = value; };
export function settingsRecordsSyncEnabled(): boolean {
  if (override !== undefined) return override;
  try { const flag = localStorage.getItem(SETTINGS_RECORDS_FLAG_KEY); if (flag === '0') return false; if (flag === '1') return true; } catch {}
  try { return (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SETTINGS_RECORDS_SYNC !== '0'; } catch { return true; }
}
