-- Phase 4 of the sync repair (2 of 2): one row per user per saved WORD, so adding, deleting or marking a word learned on one device
-- is its own record (before, the whole word list was one JSON array inside the shared preferences row).
--
-- Additive only: one new table. Nothing existing is altered, dropped or backfilled by this file. preferences.words, editTimes and
-- deletedWords stay exactly as they are as the read-only fallback for two releases.
-- Rollback: supabase/rollbacks/20261025000005_user_words.rollback.sql   Backup first: supabase/phase4-backup-and-rollback.md
--
-- data is the app's WordItem (word, definition, example, bookId, isLearned, addedAt ...). edited_at is the same per-word time the app
-- already keeps in editTimes, so a learned flag or a delete made later on another device wins; the whole word is one unit.
-- A word with no row is never a deletion; only deleted_at is (the tombstone also stops a deleted word coming back from a second device).
create table public.user_words (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  word_id    text        not null check (length(word_id) between 1 and 200),
  data       jsonb       not null check (octet_length(data::text) <= 65536),
  edited_at  timestamptz not null default now(),
  device_id  text        check (device_id is null or length(device_id) <= 120),
  edit_seq   bigint      not null default 0 check (edit_seq >= 0),
  revision   bigint      not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, word_id)
);

alter table public.user_words enable row level security;

create policy "Users manage own words" on public.user_words
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create trigger user_words_touch
  before insert or update on public.user_words
  for each row execute function public.set_user_sync_record_updated_at();

revoke all on public.user_words from public, anon, authenticated;
grant select, insert, update, delete on public.user_words to authenticated;

alter publication supabase_realtime add table public.user_words;
