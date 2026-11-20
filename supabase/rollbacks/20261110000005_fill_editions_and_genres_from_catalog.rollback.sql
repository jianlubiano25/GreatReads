-- Exact undo of 20261110000005 using its backup tables, then drops them.
update public.catalog_editions e set page_count = b.old_page_count, publication_year = b.old_publication_year, publisher = b.old_publisher
from public.catalog_backup_20261110_fill_editions b where b.id = e.id;
delete from public.catalog_work_terms wt using public.catalog_backup_20261110_fill_genres b where b.term_row_created and wt.work_id = b.work_id and wt.term_id = b.term_id and wt.source = 'app';
update public.catalog_works w set genres = '{}' where w.id in (select work_id from public.catalog_backup_20261110_fill_genres);
drop table public.catalog_backup_20261110_fill_editions;
drop table public.catalog_backup_20261110_fill_genres;
