-- Awards from provider labels (owner go 2026-11-15): "Hugo Award winner", "award:pulitzer_prize=1932", "Newbery Honor Book"... -> catalog_awards (named prizes) + catalog_work_awards (candidates, with provider + receipt).
-- The same rule as src/services/books/awardLabels.ts (keep them in step). Idempotent, fill-only, writes candidates only (nothing published, `honors` unchanged).
-- Two statements (the awards first, then the work rows that point at them).
with src as (
  select l.work_id, l.source, l.provider_record_id, l.label_norm n from public.catalog_work_labels l where l.status = 'candidate' and length(l.label_norm) <= 90
), parsed as (
  select work_id, source, provider_record_id,
    case when n ~ '^award:[a-z0-9_]+' then regexp_replace(initcap(replace(split_part(substr(n, 7), '=', 1), '_', ' ')), '\s+', ' ', 'g')
         else (select b from (select case when b0 ~ '^newbery honor' then 'Newbery Honor' when b0 ~ '^newbery medal' then 'Newbery Medal' else initcap(b0) end b
                 from (select regexp_replace(regexp_replace(regexp_replace(regexp_replace(n, ' (winners?|laureate|longlist|shortlist|books?)$', ''), ' (winners?|laureate|longlist|shortlist|books?)$', ''), ' (winners?|laureate|longlist|shortlist|books?)$', ''), '\mawards\M', 'award') b0) z) y) end as raw_name,
    case when n ~ '^award:.*=[0-9]{4}$' then right(n, 4)::int end as yr,
    case when n ~ 'longlist' then 'nominated' when n ~ 'shortlist|\mhonor\M' then 'shortlisted' else 'won' end as result
  from src
  where n ~ '^award:[a-z0-9_]+' or (n ~ '(\maward|\mprize|\mmedal|newbery honor|honor book)' and n !~ '^(award winning|devotional|carnegie,)')
), named as (
  select work_id, source, provider_record_id, yr, result,
    replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(raw_name, ' For ', ' for '), ' Of ', ' of '), ' The ', ' the '), ' And ', ' and '), ' In ', ' in '), '’S', '’s') as name
  from parsed where length(raw_name) > 4
)
insert into public.catalog_awards (name, slug)
select distinct on (slug) name, slug from (select name, trim(both '-' from regexp_replace(lower(replace(name, '&', 'and')), '[^a-z0-9]+', '-', 'g')) slug from named) s where slug <> ''
on conflict (slug) do nothing;
with src as (
  select l.work_id, l.source, l.provider_record_id, l.label_norm n from public.catalog_work_labels l where l.status = 'candidate' and length(l.label_norm) <= 90
), parsed as (
  select work_id, source, provider_record_id,
    case when n ~ '^award:[a-z0-9_]+' then regexp_replace(initcap(replace(split_part(substr(n, 7), '=', 1), '_', ' ')), '\s+', ' ', 'g')
         else (select b from (select case when b0 ~ '^newbery honor' then 'Newbery Honor' when b0 ~ '^newbery medal' then 'Newbery Medal' else initcap(b0) end b
                 from (select regexp_replace(regexp_replace(regexp_replace(regexp_replace(n, ' (winners?|laureate|longlist|shortlist|books?)$', ''), ' (winners?|laureate|longlist|shortlist|books?)$', ''), ' (winners?|laureate|longlist|shortlist|books?)$', ''), '\mawards\M', 'award') b0) z) y) end as raw_name,
    case when n ~ '^award:.*=[0-9]{4}$' then right(n, 4)::int end as yr,
    case when n ~ 'longlist' then 'nominated' when n ~ 'shortlist|\mhonor\M' then 'shortlisted' else 'won' end as result
  from src
  where n ~ '^award:[a-z0-9_]+' or (n ~ '(\maward|\mprize|\mmedal|newbery honor|honor book)' and n !~ '^(award winning|devotional|carnegie,)')
), named as (
  select work_id, source, provider_record_id, yr, result,
    replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(raw_name, ' For ', ' for '), ' Of ', ' of '), ' The ', ' the '), ' And ', ' and '), ' In ', ' in '), '’S', '’s') as name
  from parsed where length(raw_name) > 4
)
insert into public.catalog_work_awards (work_id, award_id, award_year, result, source, status, raw_label, provider_record_id)
select distinct on (n.work_id, a.id, coalesce(n.yr, 0), n.source) n.work_id, a.id, n.yr, n.result, n.source, 'candidate', left(n.name, 120), n.provider_record_id
  from named n join public.catalog_awards a on a.slug = trim(both '-' from regexp_replace(lower(replace(n.name, '&', 'and')), '[^a-z0-9]+', '-', 'g'))
 where n.source in ('apple', 'google', 'openlibrary', 'hardcover')
on conflict (work_id, award_id, coalesce(award_year, 0), source) do nothing;
