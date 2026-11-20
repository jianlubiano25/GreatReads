update public.catalog_work_terms set status = 'candidate' where id in (select id from public.catalog_backup_20261116_autopublish where tbl = 'work_terms') and status = 'approved';
update public.catalog_work_labels set status = 'candidate' where id in (select id from public.catalog_backup_20261116_autopublish where tbl = 'work_labels') and status = 'approved';
drop policy if exists "Everyone reads unreviewed terms of published works" on public.catalog_work_terms;
create policy "Everyone reads unreviewed terms of published works" on public.catalog_work_terms as permissive for select to anon, authenticated
  using (status = 'candidate' and source <> 'hardcover' and exists (select 1 from public.catalog_works w where w.id = work_id and w.status = 'published'));
drop policy if exists "Everyone reads unreviewed labels of published works" on public.catalog_work_labels;
create policy "Everyone reads unreviewed labels of published works" on public.catalog_work_labels as permissive for select to anon, authenticated
  using (status = 'candidate' and source <> 'hardcover' and exists (select 1 from public.catalog_works w where w.id = work_id and w.status = 'published'));
drop table public.catalog_backup_20261116_autopublish;
