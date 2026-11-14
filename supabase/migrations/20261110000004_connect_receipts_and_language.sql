-- APPLIED 2026-11-10 (owner go). Two fill-only, database-only steps that connect data the catalog already holds. No network, no deletes, no overwrite.
--   A) link Google provider records to the edition that carries the same Google volume id (catalog_provider_records.edition_id, only where it is null today)
--   B) set works.language_code from provider records when a work's records agree on ONE language (only where it is null today)
-- Rollback: supabase/rollbacks/20261110000004_connect_receipts_and_language.rollback.sql

-- A) receipt -> edition
update public.catalog_provider_records p
set edition_id = e.id
from public.catalog_editions e
where p.provider = 'google' and p.edition_id is null
  and e.work_id = p.work_id and e.google_volume_id = p.provider_record_id
  and (select count(*) from public.catalog_editions e2 where e2.work_id = p.work_id and e2.google_volume_id = p.provider_record_id) = 1;

-- B) language: only single-language values (Open Library lists every language of every edition, e.g. "eng,spa": that is not the work's language, so it is ignored)
with raw as (
  select p.work_id,
         case lower(btrim(coalesce(p.payload->>'language', p.payload->>'lang')))
           when 'en' then 'en' when 'eng' then 'en' when 'es' then 'es' when 'spa' then 'es' when 'fr' then 'fr' when 'fre' then 'fr' when 'fra' then 'fr'
           when 'de' then 'de' when 'ger' then 'de' when 'deu' then 'de' when 'pt' then 'pt' when 'por' then 'pt' when 'nl' then 'nl' when 'dut' then 'nl' when 'nld' then 'nl'
           when 'it' then 'it' when 'ita' then 'it' when 'ja' then 'ja' when 'jpn' then 'ja' when 'pl' then 'pl' when 'pol' then 'pl'
         end as lang
  from public.catalog_provider_records p
  where p.work_id is not null and coalesce(p.payload->>'language', p.payload->>'lang') is not null
    and coalesce(p.payload->>'language', p.payload->>'lang') !~ '[,;/ ]'
), one as (
  select work_id, min(lang) as lang from raw where lang is not null group by work_id having count(distinct lang) = 1
)
update public.catalog_works w set language_code = one.lang
from one where w.id = one.work_id and w.language_code is null;
