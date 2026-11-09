-- Rollback of 20261109000003_catalog_awards.sql: drops the two tables it created. Nothing else is touched.
drop table if exists public.catalog_work_awards;
drop table if exists public.catalog_awards;
