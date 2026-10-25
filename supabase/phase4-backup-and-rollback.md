# Phase 4 backup and rollback (read before applying anything)

Nothing here has been applied. These steps keep your current data safe before the two new tables exist or are read.

## 1. Backup (do all three, in this order)
1. In the app on each device: Settings > Cloud backup > export the JSON backup file. Keep both files.
2. In the Supabase SQL editor (read-only, changes nothing), save the result as CSV:
   `select user_id, revision, updated_at, preferences from public.user_library_preferences;`
3. Same, for the sync baseline of the other tables:
   `select count(*) from public.user_library_books; select count(*) from public.user_book_annotations; select count(*) from public.user_daily_pages;`

## 2. Order of release
a. Apply the two migrations (they only create empty tables; the current app ignores them).
b. Ship the app with the switch OFF by default. Nothing reads or writes the new tables.
c. Dry run (tests + a script on your two devices' data shapes), you review, then turn the switch on for your account only.
d. Existing preferences.* stays read-only for two releases and is never deleted by this phase.

## 3. Rollback
- App: set the switch off (`readlife.settingsRecordsSync1` = `0`, or `VITE_SETTINGS_RECORDS_SYNC=0`). The app goes back to preferences.*.
- Database: run the two files in supabase/rollbacks/ (`...000005_user_words.rollback.sql` then `...000004_user_settings.rollback.sql`).
- Data: restore the JSON backup from step 1 in the app if anything looks wrong. preferences.* was never modified, so it is still correct.
