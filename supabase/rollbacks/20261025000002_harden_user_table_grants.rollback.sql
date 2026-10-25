-- Restores the previous (over-broad) grants exactly as they were on 2026-10-25.
do $$
declare t text;
begin
  foreach t in array array['user_book_annotations','user_library_books','user_library_preferences','user_reading_sessions','user_shelf_books','user_shelves','user_sync_devices'] loop
    execute format('grant all on public.%I to anon', t);
    execute format('grant truncate, trigger, references on public.%I to authenticated', t);
  end loop;
end $$;
