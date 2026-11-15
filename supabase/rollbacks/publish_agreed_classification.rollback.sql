-- Undo the bulk publish rule: put every row it published back to its old status (rows changed by hand afterwards are left alone: only rows still 'approved' with the backed-up id are reset).
update public.catalog_work_terms t set status = b.old_status from public.catalog_backup_publish_rule b where b.tbl = 'catalog_work_terms' and b.id = t.id and t.status = 'approved';
update public.catalog_work_labels t set status = b.old_status from public.catalog_backup_publish_rule b where b.tbl = 'catalog_work_labels' and b.id = t.id and t.status = 'approved';
-- then, when happy to forget the undo: drop table public.catalog_backup_publish_rule;
