-- Owner go 2026-11-10 ("fill up all missing fields"). FILL-ONLY, DATABASE-ONLY: copies values the catalog ALREADY holds for the same book; nothing is fetched, overwritten or deleted.
-- A) catalog_editions.page_count / publication_year / publisher from the work's published or approved metadata (pageCount, year, publisher), ONLY for works with exactly ONE edition
--    (a page count of "the book" must not be copied onto several editions) and exactly ONE distinct value, ONLY where the edition field is null.
--    NOTE: `year` is the year the app showed for the book; it can be the first-publication year rather than this edition's. Read edition years filled here as "year of the book".
-- B) catalog_works.genres from the owner's own app genre entries (source app, candidate/approved) that are exactly a genre term name or an alias of one, ONLY for works whose genres are empty;
--    plus the matching catalog_work_terms rows (source app, approved).
-- NOT done on purpose: genres from Open Library / Hardcover labels alone (stay candidates), new edition rows (an edition needs an identifier we do not have).
-- Exact undo: the two backup tables below hold every touched row; rollback: supabase/rollbacks/20261110000005_fill_editions_and_genres_from_catalog.rollback.sql

create table if not exists public.catalog_backup_20261110_fill_editions as
with one_ed as (select work_id from public.catalog_editions group by work_id having count(*) = 1),
vals as (
  select m.work_id, m.field_name, min(m.field_value #>> '{}') v
  from public.catalog_metadata_candidates m join one_ed using (work_id)
  where m.status in ('published', 'approved') and m.field_name in ('pageCount', 'year', 'publisher')
  group by m.work_id, m.field_name having count(distinct m.field_value #>> '{}') = 1
), plan as (
  select e.id, e.page_count old_page_count, e.publication_year old_publication_year, e.publisher old_publisher,
    case when e.page_count is null then (select v::int from vals where vals.work_id = e.work_id and field_name = 'pageCount' and v ~ '^[0-9]{1,5}$' and v::int between 1 and 20000) end new_page_count,
    case when e.publication_year is null then (select v::int from vals where vals.work_id = e.work_id and field_name = 'year' and v ~ '^[0-9]{4}$' and v::int between 1400 and 2100) end new_publication_year,
    case when e.publisher is null then (select v from vals where vals.work_id = e.work_id and field_name = 'publisher' and length(btrim(v)) between 2 and 120) end new_publisher
  from public.catalog_editions e where e.work_id in (select work_id from one_ed)
)
select * from plan where new_page_count is not null or new_publication_year is not null or new_publisher is not null;

update public.catalog_editions e set
  page_count = coalesce(e.page_count, b.new_page_count), publication_year = coalesce(e.publication_year, b.new_publication_year), publisher = coalesce(e.publisher, b.new_publisher)
from public.catalog_backup_20261110_fill_editions b where b.id = e.id;

create table if not exists public.catalog_backup_20261110_fill_genres as
with cand as (
  select m.work_id, t.id as term_id, t.name
  from public.catalog_metadata_candidates m
  join public.catalog_works w on w.id = m.work_id and coalesce(array_length(w.genres, 1), 0) = 0
  join public.catalog_terms t on t.kind = 'genre' and lower(t.name) = lower(btrim(m.field_value #>> '{}'))
  where m.field_name = 'genre' and m.source_name = 'app' and m.status in ('candidate', 'approved')
  union
  select m.work_id, t.id, t.name
  from public.catalog_metadata_candidates m
  join public.catalog_works w on w.id = m.work_id and coalesce(array_length(w.genres, 1), 0) = 0
  join public.catalog_term_aliases a on a.label_norm = lower(btrim(m.field_value #>> '{}'))
  join public.catalog_terms t on t.id = a.term_id and t.kind = 'genre'
  where m.field_name = 'genre' and m.source_name = 'app' and m.status in ('candidate', 'approved')
)
select c.work_id, c.term_id, c.name, not exists (select 1 from public.catalog_work_terms x where x.work_id = c.work_id and x.term_id = c.term_id and x.source = 'app') as term_row_created
from cand c;

insert into public.catalog_work_terms (work_id, term_id, source, status, raw_label)
select work_id, term_id, 'app', 'approved', name from public.catalog_backup_20261110_fill_genres where term_row_created
on conflict (work_id, term_id, source) do nothing;

update public.catalog_works w set genres = (select array_agg(distinct b.name order by b.name) from public.catalog_backup_20261110_fill_genres b where b.work_id = w.id)
where coalesce(array_length(w.genres, 1), 0) = 0 and exists (select 1 from public.catalog_backup_20261110_fill_genres b where b.work_id = w.id);

alter table public.catalog_backup_20261110_fill_editions enable row level security;
alter table public.catalog_backup_20261110_fill_genres enable row level security;
revoke all on public.catalog_backup_20261110_fill_editions, public.catalog_backup_20261110_fill_genres from anon, authenticated, public;
