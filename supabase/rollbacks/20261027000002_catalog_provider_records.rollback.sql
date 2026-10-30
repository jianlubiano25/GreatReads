-- Rollback for 20261027000002_catalog_provider_records.sql. Safe order: columns first (they reference the table), then the table.
-- Before running: export catalog_provider_records and catalog_metadata_candidates.(provider_record_id, raw_value) if any row should be kept.
-- Existing metadata candidates (values, sources, status) are untouched; only the two new columns are dropped.
drop index if exists public.catalog_metadata_candidates_provider_record_idx;
alter table public.catalog_metadata_candidates drop column if exists provider_record_id;
alter table public.catalog_metadata_candidates drop column if exists raw_value;
drop table if exists public.catalog_provider_records;
