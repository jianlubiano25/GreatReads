-- Bulk publish by rule (owner go 2026-11-16): a classification item is published (status approved) when TWO OR MORE different sources agree on it for the same book, and the book is published.
--   terms: the same vocabulary term on the same book from 2+ distinct sources (apple/google/openlibrary/hardcover/app), none rejected;
--   keywords & tags: the same plain label (no / or , heading form, <= 40 chars, no vocabulary term) from 2+ distinct sources.
-- Awards are NOT touched (each one is reviewed by hand). Candidates only: approved/rejected rows are never changed. Exact undo: supabase/rollbacks/publish_agreed_classification.rollback.sql (uses the backup table).
create table if not exists public.catalog_backup_publish_rule (tbl text not null, id uuid not null, old_status text not null, applied_at timestamptz not null default now(), primary key (tbl, id));
alter table public.catalog_backup_publish_rule enable row level security; -- no policy: only the service role / owner SQL can read it
revoke all on public.catalog_backup_publish_rule from anon, authenticated;
insert into public.catalog_backup_publish_rule (tbl, id, old_status)
select 'catalog_work_terms', wt.id, wt.status from public.catalog_work_terms wt
  join public.catalog_works w on w.id = wt.work_id and w.status = 'published'
 where wt.status = 'candidate'
   and (select count(distinct x.source) from public.catalog_work_terms x where x.work_id = wt.work_id and x.term_id = wt.term_id and x.status <> 'rejected') >= 2
on conflict do nothing;
insert into public.catalog_backup_publish_rule (tbl, id, old_status)
select 'catalog_work_labels', l.id, l.status from public.catalog_work_labels l
  join public.catalog_works w on w.id = l.work_id and w.status = 'published'
 where l.status = 'candidate' and l.term_id is null and length(l.label_norm) <= 40 and l.label_norm !~ '[/,]'
   and (select count(distinct x.source) from public.catalog_work_labels x where x.work_id = l.work_id and x.label_norm = l.label_norm and x.status <> 'rejected' and x.term_id is null) >= 2
on conflict do nothing;
update public.catalog_work_terms set status = 'approved' where status = 'candidate' and id in (select id from public.catalog_backup_publish_rule where tbl = 'catalog_work_terms');
update public.catalog_work_labels set status = 'approved' where status = 'candidate' and id in (select id from public.catalog_backup_publish_rule where tbl = 'catalog_work_labels');
