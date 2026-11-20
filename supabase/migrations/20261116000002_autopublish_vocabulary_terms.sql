-- Owner go 2026-11-16: "the terms we have are auto published; I only reject what is wrong; Hardcover included".
-- A) every unreviewed (candidate) link that points at an ACTIVE vocabulary term becomes approved (published): catalog_work_terms, and catalog_work_labels that carry a term. All sources, Hardcover included.
--    Rejected rows are never touched. Plain tags (labels with no vocabulary term) stay as they are (they are shown by default, see B).
-- B) the default-visible read rule no longer excludes Hardcover (the owner decided Hardcover is shown too).
-- Exact undo: backup table catalog_backup_20261116_autopublish (ids + old status); rollback: supabase/rollbacks/20261116000002_autopublish_vocabulary_terms.rollback.sql
create table if not exists public.catalog_backup_20261116_autopublish as
select wt.id, 'work_terms'::text as tbl, wt.status as old_status from public.catalog_work_terms wt
 where wt.status = 'candidate' and exists (select 1 from public.catalog_terms t where t.id = wt.term_id and t.status = 'active')
union all
select l.id, 'work_labels', l.status from public.catalog_work_labels l
 where l.status = 'candidate' and l.term_id is not null and exists (select 1 from public.catalog_terms t where t.id = l.term_id and t.status = 'active');
alter table public.catalog_backup_20261116_autopublish enable row level security;
revoke all on public.catalog_backup_20261116_autopublish from anon, authenticated, public;

update public.catalog_work_terms set status = 'approved' where status = 'candidate' and id in (select id from public.catalog_backup_20261116_autopublish where tbl = 'work_terms');
update public.catalog_work_labels set status = 'approved' where status = 'candidate' and id in (select id from public.catalog_backup_20261116_autopublish where tbl = 'work_labels');

drop policy if exists "Everyone reads unreviewed terms of published works" on public.catalog_work_terms;
create policy "Everyone reads unreviewed terms of published works" on public.catalog_work_terms as permissive for select to anon, authenticated
  using (status = 'candidate' and exists (select 1 from public.catalog_works w where w.id = work_id and w.status = 'published'));
drop policy if exists "Everyone reads unreviewed labels of published works" on public.catalog_work_labels;
create policy "Everyone reads unreviewed labels of published works" on public.catalog_work_labels as permissive for select to anon, authenticated
  using (status = 'candidate' and exists (select 1 from public.catalog_works w where w.id = work_id and w.status = 'published'));
