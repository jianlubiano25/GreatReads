-- Rollback for 20261025000005_user_words.sql. Drops only the NEW table. preferences.words/editTimes/deletedWords are untouched.
-- Turn the app switch off FIRST (same switch as user_settings) so the app reads the old word list again.
-- Optional safety copy before dropping:  select * from public.user_words order by user_id, word_id;
alter publication supabase_realtime drop table public.user_words;
drop table public.user_words;
