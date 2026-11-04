-- Undo supabase/backfills/20261027_genres_honors_backfill.sql: empties genres and honors on exactly the works that got an audit note, then removes those notes.
-- Note: genres or honors added to those works AFTER the backfill (for example by a later Save to catalog) are emptied too.
begin;
update public.catalog_works w set genres = '{}', honors = '{}'
from public.catalog_private_notes n
where n.work_id = w.id and n.kind = 'note' and n.note = 'backfill 2026-10-27 genres/honors: both were empty before';
delete from public.catalog_private_notes where kind = 'note' and note = 'backfill 2026-10-27 genres/honors: both were empty before';
commit;
