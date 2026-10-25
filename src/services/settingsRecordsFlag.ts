/** Leaf module (imports nothing) so supabase.ts can read the Phase 4 switch without an import cycle. OFF unless "readlife.settingsRecordsSync1" = "1" or VITE_SETTINGS_RECORDS_SYNC=1; "0" always wins. */
export const SETTINGS_RECORDS_FLAG_KEY = 'readlife.settingsRecordsSync1';
let override: boolean | undefined;
/** Tests only. */
export const setSettingsRecordsOverride = (value: boolean | undefined) => { override = value; };
export function settingsRecordsSyncEnabled(): boolean {
  if (override !== undefined) return override;
  try { const flag = localStorage.getItem(SETTINGS_RECORDS_FLAG_KEY); if (flag === '0') return false; if (flag === '1') return true; } catch {}
  try { return (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SETTINGS_RECORDS_SYNC === '1'; } catch { return false; }
}
