-- Rollback for 20261025000004_user_settings.sql. Drops only the NEW table (policy, trigger and rows go with it).
-- preferences.* is never modified by the migration or the app, so no setting is lost. Turn the app switch off FIRST
-- (localStorage "readlife.settingsRecordsSync1" = "0" or VITE_SETTINGS_RECORDS_SYNC=0) and it reads preferences again.
-- Optional safety copy before dropping:  select * from public.user_settings order by user_id, key;
alter publication supabase_realtime drop table public.user_settings;
drop table public.user_settings;
