-- Phase 4 of the sync repair (1 of 2): one row per user per SETTING, so a change to the goal no longer shares a revision with the
-- garden, the theme, the nook look and so on (they all used to live in ONE JSON under ONE revision, so one stalled field paused them all).
--
-- Additive only: one new table. Nothing existing is altered, renamed, dropped or backfilled by this file.
-- user_library_preferences.preferences is left exactly as it is and stays the read-only fallback in the app for two releases.
-- Rollback: supabase/rollbacks/20261025000004_user_settings.rollback.sql   Backup first: supabase/phase4-backup-and-rollback.md
--
-- Keys (decided by the app, not enforced by a list here so a new setting never needs a migration): goal, reading_intention,
-- profile_name, theme, fonts, store_layout, name_choices, nook_toggles, nook_look, garden. The profile PHOTO and cover picks and
-- hidden books are NOT here (photo moves in Phase 6). Device-local settings (on-device flags, secrets, location, caches) never sync.
--
-- Merge rule lives in the app: the later edited_at wins per key; an exact tie with different values is never overwritten (kept and
-- the owner is asked); a key with no row is never a deletion, only deleted_at is; edited_at = 1970-01-01 marks an imported legacy
-- value that any real edit beats. Same shape, RLS, grants and trigger as user_daily_pages.
create table public.user_settings (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  key        text        not null check (key ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  value      jsonb       not null default 'null'::jsonb check (octet_length(value::text) <= 65536),
  edited_at  timestamptz not null default now(),      -- when the user made the edit, by the device clock
  device_id  text        check (device_id is null or length(device_id) <= 120),
  edit_seq   bigint      not null default 0 check (edit_seq >= 0),
  revision   bigint      not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),      -- server time of the last write (secondary clock check)
  deleted_at timestamptz,
  primary key (user_id, key)
);

alter table public.user_settings enable row level security;

create policy "Users manage own settings" on public.user_settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create trigger user_settings_touch
  before insert or update on public.user_settings
  for each row execute function public.set_user_sync_record_updated_at();

revoke all on public.user_settings from public, anon, authenticated;
grant select, insert, update, delete on public.user_settings to authenticated;

alter publication supabase_realtime add table public.user_settings;
