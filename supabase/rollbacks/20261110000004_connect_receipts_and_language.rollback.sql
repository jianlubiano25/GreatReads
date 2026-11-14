-- Undo supabase/migrations/20261110000004_connect_receipts_and_language.sql. Exact only if nothing else has written language_code / edition_id since (on 2026-11-10 every works.language_code was null).
update public.catalog_provider_records p set edition_id = null
from public.catalog_editions e
where p.provider = 'google' and p.edition_id = e.id and e.work_id = p.work_id and e.google_volume_id = p.provider_record_id;
update public.catalog_works set language_code = null where language_code is not null;
