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

## Fixes after the second device test (iPhone + iPad)
- Live channel: realtime used serializer 1.0.0 with array messages, so the server rejected every join (commit 2e7a579). Now 2.0.0.
- Re-adding a removed book did nothing: removal left the book on this device's "deleted" list and hidden, and nothing cleared either. Adding a book back now clears both (and a cloud delete older than the re-add no longer hides it again).
- Theme (Parchment/Night/System) was reverted by the old shared preferences copy, which still overwrote goal, intention, name, theme and nook look on every pull. With Phase 4 on it now only fills empty values.
- Clock: always 12-hour (the owner's choice); the iPad followed its 24-hour region format.

## Owner's requests, still open
- SEARCH: book search in this branch must be as fast and as reliable as in Jldata2, or better (typing a title and getting the right book quickly). Last test: still not fast. Compare with Jldata2's search (src/hooks/useBookSearch.ts, src/components/BookSearch.tsx) before changing anything; keep the genre picks and "hidden gems" the owner likes.
- "Reading now" page did not change on the second device after a change on the first: cause NOT found yet. Check on real devices after the fixes above; if it still fails, look at status sync (user_library_books) and the pull after a realtime event.
- Owner always uses the 12-hour clock.

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

## Audit patches 1-3 (status screen, independent startup, writer)
- Backup & Restore now has "Live sync status" (src/components/SyncStatusSection.tsx, src/services/syncStatus.ts): per part working/problem with the reason, live connection state, build id, short device id, Sync now.
- Bootstrap no longer throws when the library upload, daily pages or settings fail: the device is ready right after the cloud copy is merged, live updates start immediately, and each category retries on its own backoff (usePersonalLibrarySync.ts).
- writeRemoteLibrary tries every record: one failed request or moved record no longer stops the records after it; the round still reports failure so it retries.
- Verified in the logs: realtime join failures ("V1 JSON Serializer") ran in the thousands per hour until ~15:00 UTC on 25 Oct and are zero since 2e7a579.
- Pending-upload receive stays stamped-only (status, rating, page, notes, words); unstamped things (custom book details, cover picks, removals) wait for the upload to finish. Not yet per-record.
