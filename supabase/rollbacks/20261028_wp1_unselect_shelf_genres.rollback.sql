-- Rollback for wp1_unselect_shelf_genres.sql: re-selects exactly the candidates that have a WP1 audit note, then removes those notes.
-- Honors added to catalog_works.honors are harmless extras and are kept.
update public.catalog_metadata_candidates c set is_selected = true
from public.catalog_private_notes n
where n.target_table='catalog_metadata_candidates' and n.target_id=c.id and n.note like 'WP1 2026-10-28:%';
delete from public.catalog_private_notes where target_table='catalog_metadata_candidates' and note like 'WP1 2026-10-28:%';
