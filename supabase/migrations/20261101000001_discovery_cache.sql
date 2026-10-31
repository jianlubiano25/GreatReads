-- NOT APPLIED. Owner order 6 (2026-11-01): a shared cache of discovery answers (genre lists and a few busy searches), so a new device or a cold start reads one
-- small row from Supabase first, then its own saved copy, and only then asks the slow public book sites. Needs the owner's explicit approval in chat before it is applied.
-- Additive only: one new table, one function, one trigger. No existing table, column, policy or function is changed.
-- Rollback: supabase/rollbacks/20261101000001_discovery_cache.rollback.sql
--
-- What is stored (docs/provider-terms.md): a SLIM list per row (title, author, year, genre, the book's own ids, a cover link that is not Google's, and a rating only when it
-- came from Open Library or Apple). Never a provider response, never Google ratings, covers or text, never anything about a reader. Rows EXPIRE (1 day by default) and are not
-- read after that, in line with the providers' cache rules. Only catalog admins can write; everyone can read rows that have not expired (it is public book data, like the catalog).

create table if not exists public.discovery_cache (
  kind text not null check (kind in ('genre_pool', 'search')),
  cache_key text not null check (length(cache_key) between 1 and 200),
  payload jsonb not null check (jsonb_typeof(payload) = 'array'),
  item_count integer generated always as (jsonb_array_length(payload)) stored,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 day',
  updated_at timestamptz not null default now(),
  primary key (kind, cache_key),
  -- never an empty or thin answer, and a row stays small (about 40 slim books)
  constraint discovery_cache_not_thin check (jsonb_array_length(payload) >= 3),
  constraint discovery_cache_small check (octet_length(payload::text) <= 60000)
);
comment on table public.discovery_cache is 'Shared, expiring cache of discovery answers (genre lists, busy searches). Slim public book facts only (see docs/provider-terms.md). Written by catalog admins only; read by everyone until expires_at.';

-- A good list is never replaced by a much thinner one while it is still valid (a half-failed refresh from an admin device cannot hurt everyone).
create or replace function public.discovery_cache_keep_fuller() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.expires_at > now() and jsonb_array_length(new.payload) * 2 < jsonb_array_length(old.payload) then
    raise exception 'discovery_cache: refusing to replace a fuller list with a much thinner one';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists discovery_cache_keep_fuller on public.discovery_cache;
create trigger discovery_cache_keep_fuller before update on public.discovery_cache
  for each row execute function public.discovery_cache_keep_fuller();

alter table public.discovery_cache enable row level security;
drop policy if exists "Anyone reads live discovery rows" on public.discovery_cache;
create policy "Anyone reads live discovery rows" on public.discovery_cache
  as permissive for select to anon, authenticated
  using (expires_at > now());
drop policy if exists "Admins write discovery rows" on public.discovery_cache;
create policy "Admins write discovery rows" on public.discovery_cache
  as permissive for all to authenticated
  using (exists (select 1 from public.catalog_admins a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.catalog_admins a where a.user_id = (select auth.uid())));

revoke all on public.discovery_cache from anon, public;
grant select on public.discovery_cache to anon, authenticated;
grant insert, update, delete on public.discovery_cache to authenticated;
revoke all on function public.discovery_cache_keep_fuller() from public, anon, authenticated;
