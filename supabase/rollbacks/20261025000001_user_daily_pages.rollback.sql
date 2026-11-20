-- Rollback for 20261025000001_user_daily_pages.sql. Drops only the NEW table (its policy, trigger and rows go with it).
-- The old preferences.dailyLog is never modified by the migration or by the app, so no reading history is lost: turn the app switch off
-- first (localStorage "readlife.dailyPagesSync1" = "0" or VITE_DAILY_PAGES_SYNC=0) and it reads preferences.dailyLog again as before.
-- Optional safety copy before dropping:  select * from public.user_daily_pages order by user_id, day;
alter publication supabase_realtime drop table public.user_daily_pages;
drop table public.user_daily_pages;
