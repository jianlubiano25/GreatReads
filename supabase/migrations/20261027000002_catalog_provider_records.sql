-- APPLIED to production 2026-10-27 with owner approval (migration name catalog_provider_records), followed by 20261027000003 to tighten grants. Phase 2 of the catalog plan.
-- Additive only: one new admin-only table + two nullable columns on catalog_metadata_candidates. No existing row, column, policy or function is changed or removed.
-- Rollback: supabase/rollbacks/20261027000002_catalog_provider_records.rollback.sql (export the table first if it holds rows you want to keep).
-- Storage policy per provider is in docs/provider-terms.md: Open Library = full, Apple = trimmed, Google = trimmed/ids_only (never the full response).

create table if not exists public.catalog_provider_records (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('apple', 'google', 'openlibrary')),
  provider_record_id text not null check (length(provider_record_id) > 0),
  record_kind text not null default 'work' check (record_kind in ('work', 'edition', 'volume', 'author', 'listing')),
  -- never cascade: a receipt must survive if a work or edition is archived or removed, it just becomes unmatched
  work_id uuid references public.catalog_works(id) on delete set null,
  edition_id uuid references public.catalog_editions(id) on delete set null,
  payload_policy text not null check (payload_policy in ('full', 'trimmed', 'ids_only')),
  payload jsonb,
  source_url text,
  http_status integer,
  fetched_at timestamptz not null default now(),
  refresh_after timestamptz,
  match_status text not null default 'unmatched' check (match_status in ('unmatched', 'matched', 'needs_review', 'rejected')),
  match_confidence numeric check (match_confidence is null or (match_confidence >= 0 and match_confidence <= 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- ids_only means exactly that: no payload is kept
  constraint catalog_provider_records_ids_only_has_no_payload check (payload_policy <> 'ids_only' or payload is null),
  constraint catalog_provider_records_unique unique (provider, record_kind, provider_record_id)
);
comment on table public.catalog_provider_records is 'What a provider returned for one record (receipt + provenance). Admin only. payload_policy follows docs/provider-terms.md; Google is never stored in full.';

create index if not exists catalog_provider_records_work_idx on public.catalog_provider_records (work_id) where work_id is not null;
create index if not exists catalog_provider_records_edition_idx on public.catalog_provider_records (edition_id) where edition_id is not null;
create index if not exists catalog_provider_records_review_idx on public.catalog_provider_records (match_status) where match_status = 'needs_review';

drop trigger if exists catalog_provider_records_set_updated_at on public.catalog_provider_records;
create trigger catalog_provider_records_set_updated_at before update on public.catalog_provider_records
  for each row execute function public.catalog_set_updated_at();

alter table public.catalog_provider_records enable row level security;
drop policy if exists "Admins manage provider records" on public.catalog_provider_records;
create policy "Admins manage provider records" on public.catalog_provider_records
  as permissive for all to authenticated
  using (exists (select 1 from public.catalog_admins a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.catalog_admins a where a.user_id = (select auth.uid())));
revoke all on public.catalog_provider_records from anon, public;
grant select, insert, update, delete on public.catalog_provider_records to authenticated;

-- Provenance on the existing candidate table: which receipt a value came from, and the value exactly as the provider gave it (before any cleaning).
alter table public.catalog_metadata_candidates add column if not exists provider_record_id uuid references public.catalog_provider_records(id) on delete set null;
alter table public.catalog_metadata_candidates add column if not exists raw_value jsonb;
create index if not exists catalog_metadata_candidates_provider_record_idx on public.catalog_metadata_candidates (provider_record_id) where provider_record_id is not null;
