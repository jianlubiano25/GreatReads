-- Phase 2 of the sync repair: one row per user per day for "pages read", so edits made on different devices for different days no
-- longer overwrite each other (they used to share one JSON field under one revision).
--
-- Additive only: one new table. Nothing existing is altered, renamed, dropped or backfilled. user_library_preferences.preferences.dailyLog
-- is left exactly as it is and becomes a read-only fallback in the app. Rollback: supabase/rollbacks/20261025000001_user_daily_pages.rollback.sql
--
-- Follows the live user_* tables: RLS "(select auth.uid()) = user_id" for authenticated, ON DELETE CASCADE to auth.users, soft delete via
-- deleted_at, realtime publication membership (user_sync_records is NOT in it, and it also stores the large JSON backup, so daily pages
-- get their own table). The revision/updated_at trigger is set_user_sync_record_updated_at() (pins search_path, uses greatest()), not
-- touch_user_sync_record() (no search_path). It also runs on INSERT so updated_at is always server time: the app uses it as the secondary
-- clock check (an edited_at far ahead of updated_at means a device clock cannot be trusted).
--
-- Merge rule lives in the app, not here: the later edited_at wins per day; an exact tie with different pages is never overwritten, the app
-- keeps both and asks the owner. A day with no row is never a deletion; only deleted_at is.
create table public.user_daily_pages (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  day        date        not null,
  pages      integer     not null check (pages >= 0 and pages <= 100000),
  edited_at  timestamptz not null default now(),      -- when the user made the edit, by the device clock (1970-01-01 = imported legacy value, any real edit beats it)
  device_id  text        check (device_id is null or length(device_id) <= 120),
  edit_seq   bigint      not null default 0 check (edit_seq >= 0),
  revision   bigint      not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),      -- server time of the last write
  deleted_at timestamptz,
  primary key (user_id, day)
);

alter table public.user_daily_pages enable row level security;

create policy "Users manage own daily pages" on public.user_daily_pages
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create trigger user_daily_pages_touch
  before insert or update on public.user_daily_pages
  for each row execute function public.set_user_sync_record_updated_at();

revoke all on public.user_daily_pages from public, anon, authenticated;
grant select, insert, update, delete on public.user_daily_pages to authenticated;

alter publication supabase_realtime add table public.user_daily_pages;
