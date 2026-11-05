-- APPLIED to production 2026-10-27 with owner approval (270 works, 270 audit notes). Phase 3 one-off backfill: catalog_works.genres / honors from the genre labels already stored as metadata candidates.
-- Data only, no schema change. Dry-run (2026-10-27): 276 works have a stored genre label; this fills 270 (226 genres, 44 honors) and leaves 6 alone
-- (1 "Reader favourite" tag, 3 "New release", 2 only unmapped labels). All 780 works had empty genres and honors when this was prepared.
-- Fill-only: a work is touched only if BOTH arrays are still empty; nothing is overwritten or removed. Each touched work gets a private audit note (catalog_private_notes) so it can be rolled back exactly.
-- The label-set -> genres/honors mapping below was produced by the app's own tested classifier (src/services/books/catalogFill.ts, classifyAll + planWorkFill), not by hand.
-- A label set that is not in the mapping (new data since the dry-run) is skipped. Rollback: supabase/rollbacks/20261027_genres_honors_backfill.rollback.sql
begin;

create temp table _map (labelset text primary key, genres text[] not null, honors text[] not null) on commit drop;
insert into _map (labelset, genres, honors) values
  ('Fiction', '{"Fiction"}'::text[], '{}'::text[]),
  ('Self-help', '{"Self-help"}'::text[], '{}'::text[]),
  ('Prize winner', '{}'::text[], '{"Prize winner"}'::text[]),
  ('Mystery', '{"Mystery"}'::text[], '{}'::text[]),
  ('Reese''s Book Club', '{}'::text[], '{"Reese''s Book Club"}'::text[]),
  ('cookbooks', '{"Cookbooks"}'::text[], '{}'::text[]),
  ('Fantasy', '{"Fantasy"}'::text[], '{}'::text[]),
  ('contemporary', '{"Contemporary"}'::text[], '{}'::text[]),
  ('Graphic Novels', '{"Graphic novels"}'::text[], '{}'::text[]),
  ('young adult', '{"Young adult"}'::text[], '{}'::text[]),
  ('Romance', '{"Romance"}'::text[], '{}'::text[]),
  ('Science fiction', '{"Science fiction"}'::text[], '{}'::text[]),
  ('Service95 Book Club', '{}'::text[], '{"Service95 Book Club"}'::text[]),
  ('Classic', '{"Classic"}'::text[], '{}'::text[]),
  ('humor', '{"Humor"}'::text[], '{}'::text[]),
  ('Non-fiction', '{"Non-fiction"}'::text[], '{}'::text[]),
  ('biography', '{"Biography"}'::text[], '{}'::text[]),
  ('crime', '{"Crime"}'::text[], '{}'::text[]),
  ('Memoir', '{"Memoir"}'::text[], '{}'::text[]),
  ('Fantasy || Fiction', '{"Fantasy","Fiction"}'::text[], '{}'::text[]),
  ('Historical fiction', '{"Historical fiction"}'::text[], '{}'::text[]),
  ('Oprah''s Book Club', '{}'::text[], '{"Oprah''s Book Club"}'::text[]),
  ('Fiction / Historical', '{"Fiction","Historical fiction"}'::text[], '{}'::text[]),
  ('Biography & Autobiography || Non-fiction', '{"Biography","Non-fiction"}'::text[], '{}'::text[]),
  ('Science', '{"Science"}'::text[], '{}'::text[]),
  ('Fiction || Mystery', '{"Fiction","Mystery"}'::text[], '{}'::text[]),
  ('Philosophy', '{"Philosophy"}'::text[], '{}'::text[]),
  ('horror', '{"Horror"}'::text[], '{}'::text[]),
  ('Fiction / Translated', '{"Fiction"}'::text[], '{}'::text[]),
  ('Fiction || Romance', '{"Fiction","Romance"}'::text[], '{}'::text[]),
  ('Memoir || Non-fiction', '{"Memoir","Non-fiction"}'::text[], '{}'::text[]),
  ('Self-help / Career', '{"Self-help"}'::text[], '{}'::text[]),
  ('Fiction / Myth', '{"Fiction"}'::text[], '{}'::text[]),
  ('crime || horror', '{"Crime","Horror"}'::text[], '{}'::text[]),
  ('The Inklings', '{}'::text[], '{"The Inklings"}'::text[]),
  ('Fiction / Speculative', '{"Fiction"}'::text[], '{}'::text[]),
  ('Fiction / Romcom', '{"Fiction"}'::text[], '{}'::text[]),
  ('Business & Economics || Non-fiction', '{"Non-fiction"}'::text[], '{}'::text[]),
  ('Self-help / Creativity', '{"Self-help"}'::text[], '{}'::text[]),
  ('Non-fiction || Political Science', '{"Non-fiction"}'::text[], '{}'::text[]),
  ('Biography & Autobiography || Memoir || Non-fiction', '{"Biography","Memoir","Non-fiction"}'::text[], '{}'::text[]),
  ('Non-fiction / Creativity', '{"Non-fiction"}'::text[], '{}'::text[]),
  ('Fiction / Satire', '{"Fiction"}'::text[], '{}'::text[]),
  ('Fiction / Literary', '{"Fiction"}'::text[], '{}'::text[]),
  ('Family & Relationships || Memoir || Non-fiction', '{"Memoir","Non-fiction"}'::text[], '{}'::text[]),
  ('Fiction || Literary Criticism || Non-fiction', '{"Fiction","Non-fiction"}'::text[], '{}'::text[]),
  ('Non-fiction || Social Science', '{"Non-fiction"}'::text[], '{}'::text[]),
  ('Fiction / Epistolary', '{"Fiction"}'::text[], '{}'::text[]),
  ('Fiction / Dystopian', '{"Fiction"}'::text[], '{}'::text[]),
  ('Psychology / Self-help', '{"Psychology","Self-help"}'::text[], '{}'::text[]),
  ('Fiction / Sci-Fi', '{"Fiction","Science fiction"}'::text[], '{}'::text[]),
  ('Biography & Autobiography', '{"Biography"}'::text[], '{}'::text[]),
  ('Fiction / Fantasy', '{"Fiction","Fantasy"}'::text[], '{}'::text[]),
  ('History || Non-fiction', '{"History","Non-fiction"}'::text[], '{}'::text[]),
  ('Fiction / Crime', '{"Fiction","Crime"}'::text[], '{}'::text[]),
  ('Inklings Book Club', '{}'::text[], '{"Inklings Book Club"}'::text[]),
  ('Philosophy / Self-help', '{"Philosophy","Self-help"}'::text[], '{}'::text[]),
  ('Non-fiction / Essays', '{"Non-fiction"}'::text[], '{}'::text[]),
  ('Fiction / Romance', '{"Fiction","Romance"}'::text[], '{}'::text[]);

create temp table _plan on commit drop as
with g as (
  select work_id, array_to_string(array_agg(distinct field_value #>> '{}' order by field_value #>> '{}'), ' || ') as labelset
  from public.catalog_metadata_candidates
  where field_name = 'genre' and status <> 'rejected' and jsonb_typeof(field_value) = 'string'
  group by work_id)
select w.id as work_id, m.genres, m.honors
from public.catalog_works w join g on g.work_id = w.id join _map m on m.labelset = g.labelset
where cardinality(w.genres) = 0 and cardinality(w.honors) = 0;

do $$ declare n int; begin
  select count(*) into n from _plan;
  -- first run: about 270 works expected. A re-run (audit notes already exist) may find nothing left to fill.
  if n > 330 or (n < 200 and not exists (select 1 from public.catalog_private_notes where kind = 'note' and note = 'backfill 2026-10-27 genres/honors: both were empty before')) then
    raise exception 'backfill plan has % works, expected about 270: stop and re-run the dry-run', n;
  end if;
end $$;

insert into public.catalog_private_notes (work_id, target_table, target_id, kind, note)
select work_id, 'catalog_works', work_id, 'note', 'backfill 2026-10-27 genres/honors: both were empty before' from _plan;

update public.catalog_works w set genres = p.genres, honors = p.honors
from _plan p where w.id = p.work_id and cardinality(w.genres) = 0 and cardinality(w.honors) = 0;

commit;
