-- E1 part 1 / WP3. APPLIED to production 2026-11-09 (migration name catalog_term_tables) with owner approval; this file is that SQL, kept in the repo. Design: docs/catalog-vocabulary.md.
-- Additive only: three NEW tables (terms, aliases, work terms) + the owner's mapping table as seed. No existing table, column or row is changed.
-- Rollback: supabase/rollbacks/20261109000002_catalog_term_tables.rollback.sql (export first if the tables hold rows you want to keep).
create table if not exists public.catalog_terms (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('genre', 'subgenre', 'subject', 'keyword', 'collection', 'tag')),
  name text not null check (length(btrim(name)) > 0),
  slug text not null check (length(slug) > 0),
  parent_id uuid references public.catalog_terms(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'candidate', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_terms_parent_only_subgenre check (parent_id is null or kind = 'subgenre'),
  constraint catalog_terms_unique unique (kind, slug)
);
comment on table public.catalog_terms is 'The shared vocabulary (see docs/catalog-vocabulary.md). status candidate = created by a capture from a provider label, not yet curated.';
create index if not exists catalog_terms_parent_idx on public.catalog_terms (parent_id) where parent_id is not null;
create table if not exists public.catalog_term_aliases (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'any' check (source in ('any', 'apple', 'google', 'openlibrary', 'hardcover', 'app')),
  label_norm text not null check (label_norm = lower(btrim(label_norm)) and length(label_norm) > 0),
  term_id uuid not null references public.catalog_terms(id) on delete cascade,
  requires_genre text,
  implies_genre text,
  created_at timestamptz not null default now(),
  constraint catalog_term_aliases_unique unique (source, label_norm, term_id)
);
comment on table public.catalog_term_aliases is 'Provider label (lower-case) -> term, editable without a deploy. requires_genre: only maps when the book has/arrives with that genre. implies_genre: genre added when the context agrees.';
create index if not exists catalog_term_aliases_term_idx on public.catalog_term_aliases (term_id);
create table if not exists public.catalog_work_terms (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.catalog_works(id) on delete cascade,
  term_id uuid not null references public.catalog_terms(id) on delete cascade,
  source text not null check (source in ('apple', 'google', 'openlibrary', 'hardcover', 'app', 'owner')),
  status text not null default 'candidate' check (status in ('candidate', 'approved', 'rejected')),
  raw_label text,
  provider_record_id uuid references public.catalog_provider_records(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_work_terms_unique unique (work_id, term_id, source)
);
comment on table public.catalog_work_terms is 'Which terms a work has, per source. candidate = admin only; approved on a published work = readable by everyone.';
create index if not exists catalog_work_terms_work_idx on public.catalog_work_terms (work_id, status);
create index if not exists catalog_work_terms_term_idx on public.catalog_work_terms (term_id);
create index if not exists catalog_work_terms_record_idx on public.catalog_work_terms (provider_record_id) where provider_record_id is not null;
drop trigger if exists catalog_terms_set_updated_at on public.catalog_terms;
create trigger catalog_terms_set_updated_at before update on public.catalog_terms for each row execute function public.catalog_set_updated_at();
drop trigger if exists catalog_work_terms_set_updated_at on public.catalog_work_terms;
create trigger catalog_work_terms_set_updated_at before update on public.catalog_work_terms for each row execute function public.catalog_set_updated_at();
alter table public.catalog_terms enable row level security;
alter table public.catalog_term_aliases enable row level security;
alter table public.catalog_work_terms enable row level security;
drop policy if exists "Everyone reads active terms" on public.catalog_terms;
create policy "Everyone reads active terms" on public.catalog_terms as permissive for select to anon, authenticated using (status = 'active');
drop policy if exists "Admins manage terms" on public.catalog_terms;
create policy "Admins manage terms" on public.catalog_terms as permissive for all to authenticated
  using (exists (select 1 from public.catalog_admins a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.catalog_admins a where a.user_id = (select auth.uid())));
drop policy if exists "Admins manage term aliases" on public.catalog_term_aliases;
create policy "Admins manage term aliases" on public.catalog_term_aliases as permissive for all to authenticated
  using (exists (select 1 from public.catalog_admins a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.catalog_admins a where a.user_id = (select auth.uid())));
drop policy if exists "Everyone reads approved terms of published works" on public.catalog_work_terms;
create policy "Everyone reads approved terms of published works" on public.catalog_work_terms as permissive for select to anon, authenticated
  using (status = 'approved' and exists (select 1 from public.catalog_works w where w.id = work_id and w.status = 'published'));
drop policy if exists "Admins manage work terms" on public.catalog_work_terms;
create policy "Admins manage work terms" on public.catalog_work_terms as permissive for all to authenticated
  using (exists (select 1 from public.catalog_admins a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.catalog_admins a where a.user_id = (select auth.uid())));
revoke all on public.catalog_terms, public.catalog_term_aliases, public.catalog_work_terms from anon, public;
grant select on public.catalog_terms, public.catalog_work_terms to anon;
grant select, insert, update, delete on public.catalog_terms, public.catalog_term_aliases, public.catalog_work_terms to authenticated;
insert into public.catalog_terms (kind, name, slug) values
  ('genre','Fiction','fiction'),('genre','Non-fiction','non-fiction'),('genre','Mystery','mystery'),('genre','Thriller','thriller'),('genre','Fantasy','fantasy'),
  ('genre','Romance','romance'),('genre','Memoir','memoir'),('genre','Biography','biography'),('genre','Horror','horror'),('genre','Historical fiction','historical-fiction'),
  ('genre','Science fiction','science-fiction'),('genre','Business','business'),('genre','Cookbooks','cookbooks'),('genre','Classic','classic'),('genre','Self-help','self-help'),
  ('genre','Graphic novels','graphic-novels'),('genre','Philosophy','philosophy'),('genre','Science','science'),('genre','Young adult','young-adult'),('genre','Crime','crime'),
  ('genre','True crime','true-crime'),('genre','Humor','humor'),('genre','Contemporary','contemporary'),('genre','Literary fiction','literary-fiction'),('genre','Poetry','poetry'),
  ('genre','History','history'),('genre','Psychology','psychology'),('genre','Travel','travel')
on conflict (kind, slug) do nothing;
insert into public.catalog_terms (kind, name, slug, parent_id)
select v.kind, v.name, v.slug, (select id from public.catalog_terms p where p.kind = 'genre' and p.name = v.parent)
from (values
  ('subgenre','Romantic comedy','romantic-comedy','Romance'), ('subgenre','Dystopian','dystopian','Science fiction'), ('subgenre','Speculative fiction','speculative-fiction','Fiction'),
  ('subgenre','Satire','satire',null), ('subgenre','Essays','essays','Non-fiction'),
  ('subject','Mythology','mythology',null), ('subject','Creativity','creativity',null), ('subject','Career','career',null),
  ('subject','Family & relationships','family-and-relationships',null), ('subject','Politics','politics',null), ('subject','Social science','social-science',null)
) as v(kind, name, slug, parent)
on conflict (kind, slug) do nothing;
insert into public.catalog_term_aliases (source, label_norm, term_id, requires_genre, implies_genre)
select 'any', v.label, t.id, v.requires, v.implies
from (values
  ('romcom','subgenre','romantic-comedy','Fiction','Romance'), ('dystopian','subgenre','dystopian','Fiction','Science fiction'), ('speculative','subgenre','speculative-fiction',null,null),
  ('satire','subgenre','satire',null,null), ('essays','subgenre','essays',null,'Non-fiction'),
  ('myth','subject','mythology','Fiction','Fantasy'), ('creativity','subject','creativity','Self-help','Self-help'), ('career','subject','career','Self-help','Self-help'),
  ('family & relationships','subject','family-and-relationships',null,'Non-fiction'), ('political science','subject','politics',null,'Non-fiction'), ('social science','subject','social-science',null,'Non-fiction')
) as v(label, kind, slug, requires, implies)
join public.catalog_terms t on t.kind = v.kind and t.slug = v.slug
on conflict (source, label_norm, term_id) do nothing;
