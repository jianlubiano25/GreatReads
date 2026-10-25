# GreatReads sync repair - handoff (branch claude/jldata2-best-of-vscode)

Rules: work only on this branch. Never merge, deploy or force-push. Back up before any data change. Report, then stop and wait for approval after each step.
Check after every step: `npm test` (811 pass), `npx tsc --noEmit`, `npm run build`.

## Done
Phase 0 safety tests, 1 first-sync merge and "use cloud", 2 daily pages (table user_daily_pages), 3/3b timestamped clears, deletes, notes, highlights,
5 store layout/fonts/nook toggles/name choices sync + shelf order applied on read.
Phase 4 (this handoff): tables user_settings and user_words (supabase/migrations/20261025000004/5, rollbacks in supabase/rollbacks/),
app code in src/services/settingsRecordsSync.ts, hook wiring in usePersonalLibrarySync.ts. ON for every signed-in account (emergency kill switch: localStorage readlife.settingsRecordsSync1 = "0" or VITE_SETTINGS_RECORDS_SYNC=0).

## Live receive fix (after the iPhone/iPad test)
Cloud rows from the iPhone (theme, garden, daily pages) were verified present in Supabase, so pushing worked and the iPad was not receiving them.
Fixed in src/services/supabase.ts and usePersonalLibrarySync.ts: every request now times out (25 s); sync locks (runGate.ts) cannot stay stuck after a hung request;
the realtime socket has a health watchdog (linkHealth.ts) that rebuilds a dead or refused channel, and wakes up on foreground/online/focus;
a revision-only safety-net check (changeProbe.ts, every 30 s while visible, a few hundred bytes) pulls whenever anything changed; 'resync' is no longer dropped while an upload is pending.
Still needs the owner's real-device test: change theme/plant/pages on one device with the other open, then with the other in the background and brought back.

## Switch
Always on while signed in. Kill switch only: localStorage `readlife.settingsRecordsSync1` = "0" (one device) or build var VITE_SETTINGS_RECORDS_SYNC=0.
Rollback: set "0", then run rollbacks 000005 then 000004. preferences.* is never modified by Phase 4.

## Not done
- Tie screen exists in Backup & Restore (event `greatreads-setting-tie`).
- No test of syncSettingsRecords against a fake Supabase (only the pure merge rules and a two-device simulation).
- Nook look may upload once more after another device takes it (watch for flip-flop).
- Cover picks, hidden books and the profile photo stay in the shared preferences JSON. Phase 6 (photo to storage + user_profiles) not started.
- Real-device testing is still needed for everything.

## Supabase
Free plan: no branches. Only one project (GreatReads). Never write production user data. Schema changes need the owner's explicit approval; the Phase 4 migrations only create two empty tables.
