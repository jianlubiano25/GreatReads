-- APPLIED to production 2026-10-27 with owner approval (migration name catalog_provider_records_tighten_grants).
-- Supabase's default privileges gave signed-in users TRUNCATE/REFERENCES/TRIGGER on the new table; row security does not cover those. This leaves only the four normal ones, like catalog_private_notes.
-- Rollback: supabase/rollbacks/20261027000003_catalog_provider_records_tighten_grants.rollback.sql (not needed unless you want the broader defaults back).
revoke all on public.catalog_provider_records from authenticated, anon, public;
grant select, insert, update, delete on public.catalog_provider_records to authenticated;
