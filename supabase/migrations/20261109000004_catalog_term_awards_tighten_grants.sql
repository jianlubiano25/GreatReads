-- NOT APPLIED. Needs the owner's go (production change). Files only.
-- Same fix as 20261027000003 for the five E1 tables: Supabase's default privileges gave signed-in users TRUNCATE / TRIGGER / REFERENCES on them, and row security does not cover those.
-- (PostgREST never exposes them over HTTP, so this is hygiene, not an open hole.) After this, signed-in users keep the four normal privileges, and visitors keep read-only access as before:
-- row security still decides who may see or change a row (admins write; everyone reads approved / active rows of published works).
-- Rollback: supabase/rollbacks/20261109000004_catalog_term_awards_tighten_grants.rollback.sql
revoke truncate, trigger, references on public.catalog_terms, public.catalog_term_aliases, public.catalog_work_terms, public.catalog_awards, public.catalog_work_awards from authenticated;
