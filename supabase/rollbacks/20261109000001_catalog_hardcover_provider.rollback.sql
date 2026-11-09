-- Rollback of 20261109000001_catalog_hardcover_provider.sql. Hardcover rows must go first, or the old checks cannot be restored (export them first if you want to keep them).
delete from public.catalog_rating_candidates where source_name = 'hardcover';
delete from public.catalog_metadata_candidates where source_name = 'hardcover';
delete from public.catalog_provider_records where provider = 'hardcover';
alter table public.catalog_provider_records drop constraint if exists catalog_provider_records_provider_check;
alter table public.catalog_provider_records add constraint catalog_provider_records_provider_check
  check (provider = any (array['apple'::text, 'google'::text, 'openlibrary'::text]));
alter table public.catalog_rating_candidates drop constraint if exists catalog_rating_candidates_source_name_check;
alter table public.catalog_rating_candidates add constraint catalog_rating_candidates_source_name_check
  check (source_name = any (array['apple_books'::text, 'google_books'::text, 'open_library'::text]));
