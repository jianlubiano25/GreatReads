-- E1 part 2 / WP3 (owner go 2026-11-09): structured awards. Additive only: two NEW tables. `catalog_works.honors` stays the read model the app shows.
-- An award is a named prize; a work's award row says which year and result (won / shortlisted / nominated) and where it was learned (candidate until approved).
-- Rollback: supabase/rollbacks/20261109000003_catalog_awards.rollback.sql
create table if not exists public.catalog_awards (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  slug text not null check (length(slug) > 0),
  created_at timestamptz not null default now(),
  constraint catalog_awards_unique unique (slug)
);
comment on table public.catalog_awards is 'Named prizes (Hugo Award, Booker Prize...). Everyone may read the names.';
create table if not exists public.catalog_work_awards (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.catalog_works(id) on delete cascade,
  award_id uuid not null references public.catalog_awards(id) on delete cascade,
  award_year integer check (award_year is null or (award_year >= 1000 and award_year <= 2200)),
  result text not null default 'won' check (result in ('won', 'shortlisted', 'nominated')),
  source text not null default 'app' check (source in ('apple', 'google', 'openlibrary', 'hardcover', 'app', 'owner')),
  status text not null default 'candidate' check (status in ('candidate', 'approved', 'rejected')),
  raw_label text,
  provider_record_id uuid references public.catalog_provider_records(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- one row per work + award + year + source (a year-less row is its own year slot)
create unique index if not exists catalog_work_awards_unique on public.catalog_work_awards (work_id, award_id, coalesce(award_year, 0), source);
create index if not exists catalog_work_awards_work_idx on public.catalog_work_awards (work_id, status);
create index if not exists catalog_work_awards_award_idx on public.catalog_work_awards (award_id);
create index if not exists catalog_work_awards_record_idx on public.catalog_work_awards (provider_record_id) where provider_record_id is not null;
comment on table public.catalog_work_awards is 'Which awards a work has, per source. candidate = admin only; approved on a published work = readable by everyone.';
drop trigger if exists catalog_work_awards_set_updated_at on public.catalog_work_awards;
create trigger catalog_work_awards_set_updated_at before update on public.catalog_work_awards for each row execute function public.catalog_set_updated_at();
alter table public.catalog_awards enable row level security;
alter table public.catalog_work_awards enable row level security;
drop policy if exists "Everyone reads awards" on public.catalog_awards;
create policy "Everyone reads awards" on public.catalog_awards as permissive for select to anon, authenticated using (true);
drop policy if exists "Admins manage awards" on public.catalog_awards;
create policy "Admins manage awards" on public.catalog_awards as permissive for all to authenticated
  using (exists (select 1 from public.catalog_admins a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.catalog_admins a where a.user_id = (select auth.uid())));
drop policy if exists "Everyone reads approved awards of published works" on public.catalog_work_awards;
create policy "Everyone reads approved awards of published works" on public.catalog_work_awards as permissive for select to anon, authenticated
  using (status = 'approved' and exists (select 1 from public.catalog_works w where w.id = work_id and w.status = 'published'));
drop policy if exists "Admins manage work awards" on public.catalog_work_awards;
create policy "Admins manage work awards" on public.catalog_work_awards as permissive for all to authenticated
  using (exists (select 1 from public.catalog_admins a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.catalog_admins a where a.user_id = (select auth.uid())));
revoke all on public.catalog_awards, public.catalog_work_awards from anon, public;
grant select on public.catalog_awards, public.catalog_work_awards to anon;
grant select, insert, update, delete on public.catalog_awards, public.catalog_work_awards to authenticated;
