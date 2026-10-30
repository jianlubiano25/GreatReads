-- Security hardening, no data or schema change. Every user_* table granted role anon full table privileges (incl. TRUNCATE, which
-- bypasses RLS) and authenticated TRUNCATE/TRIGGER/REFERENCES. The app only reads and writes these tables as a signed-in user,
-- and every policy is "to authenticated", so anon never legitimately sees a row. Keeps select/insert/update/delete for authenticated.
-- Rollback: supabase/rollbacks/20261025000002_harden_user_table_grants.rollback.sql
do $$
declare t text;
begin
  foreach t in array array['user_book_annotations','user_library_books','user_library_preferences','user_reading_sessions','user_shelf_books','user_shelves','user_sync_devices'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke truncate, trigger, references on public.%I from authenticated', t);
  end loop;
end $$;
