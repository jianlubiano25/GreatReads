-- D7 step 2 (owner go 2026-11-09): Hardcover becomes a fourth provider. Only the two allowed-value checks change; no table is added.
-- Spellings differ per table on purpose (provider records: 'openlibrary'; ratings: 'open_library', 'apple_books', 'google_books').
-- Rollback: supabase/rollbacks/20261109000001_catalog_hardcover_provider.rollback.sql
alter table public.catalog_provider_records drop constraint if exists catalog_provider_records_provider_check;
alter table public.catalog_provider_records add constraint catalog_provider_records_provider_check
  check (provider = any (array['apple'::text, 'google'::text, 'openlibrary'::text, 'hardcover'::text]));
alter table public.catalog_rating_candidates drop constraint if exists catalog_rating_candidates_source_name_check;
alter table public.catalog_rating_candidates add constraint catalog_rating_candidates_source_name_check
  check (source_name = any (array['apple_books'::text, 'google_books'::text, 'open_library'::text, 'hardcover'::text]));
