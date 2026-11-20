-- Rollback of 20261109000002_catalog_term_tables.sql: drops the three tables it created (children first). Nothing else is touched.
drop table if exists public.catalog_work_terms;
drop table if exists public.catalog_term_aliases;
drop table if exists public.catalog_terms;
