-- Rollback of 20261101000001_discovery_cache.sql. Only a cache lives here (it is rebuilt by admin devices), so dropping it loses nothing that cannot be fetched again.
drop trigger if exists discovery_cache_keep_fuller on public.discovery_cache;
drop function if exists public.discovery_cache_keep_fuller();
drop table if exists public.discovery_cache;
