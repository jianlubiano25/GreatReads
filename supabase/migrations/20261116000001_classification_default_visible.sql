-- Owner go 2026-11-16: classification is shown to readers BY DEFAULT and the owner rejects what is wrong (instead of publishing every book by hand).
-- Readers may now also read the provider-suggested rows that are still status 'candidate' (not yet reviewed) of PUBLISHED books, for catalog_work_terms and catalog_work_labels,
-- EXCEPT anything whose source is Hardcover (its terms are still unread by the owner: those stay owner-only until approved). Awards are NOT included (a wrong prize claim is worse than a missing one).
-- Rejected rows were already readable by everyone, so a rejection hides a chip for readers too. Read-only change: no row is changed.
-- Rollback: supabase/rollbacks/20261116000001_classification_default_visible.rollback.sql
create policy "Everyone reads unreviewed terms of published works" on public.catalog_work_terms as permissive for select to anon, authenticated
  using (status = 'candidate' and source <> 'hardcover' and exists (select 1 from public.catalog_works w where w.id = work_id and w.status = 'published'));
create policy "Everyone reads unreviewed labels of published works" on public.catalog_work_labels as permissive for select to anon, authenticated
  using (status = 'candidate' and source <> 'hardcover' and exists (select 1 from public.catalog_works w where w.id = work_id and w.status = 'published'));
create policy "Everyone reads candidate terms" on public.catalog_terms as permissive for select to anon, authenticated using (status = 'candidate');
