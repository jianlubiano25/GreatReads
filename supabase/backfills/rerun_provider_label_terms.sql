-- Idempotent: turns the provider labels on the receipts into candidate work terms using the CURRENT vocabulary + aliases. Run after adding aliases (needs an owner go: it writes).
insert into public.catalog_work_terms (work_id, term_id, source, status, raw_label, provider_record_id)
select distinct on (m.work_id, m.term_id, m.provider) m.work_id, m.term_id, m.provider, 'candidate', left(m.raw,120), m.rid
  from (
    select l.work_id, l.rid, l.provider, l.raw, a.term_id from (
        select r.work_id, r.id as rid, r.provider, x.raw,
               lower(regexp_replace(btrim(x.raw),'\s+',' ','g')) as whole,
               case when x.raw like '%/%' then lower(btrim(split_part(x.raw,'/',1))) end as root,
               (select coalesce(array_agg(lower(g)),'{}') from unnest(w.genres) g) as wg
          from public.catalog_provider_records r
          join public.catalog_works w on w.id=r.work_id
          cross join lateral jsonb_array_elements_text(coalesce(r.payload->'genres','[]'::jsonb) || coalesce(r.payload->'subjects','[]'::jsonb)) as x(raw)
         where r.work_id is not null and r.payload is not null) l
      cross join lateral (select lower(regexp_replace(btrim(p),'\s+',' ','g')) as n from regexp_split_to_table(l.raw,'\s*/\s*') p union select l.whole) z
      join public.catalog_term_aliases a on a.label_norm=z.n and (a.source='any' or a.source=l.provider)
     where length(z.n) between 1 and 80 and (a.requires_genre is null or lower(a.requires_genre)=any(l.wg || coalesce(array[l.root],'{}')))
    union
    select l.work_id, l.rid, l.provider, l.raw, g.id from (
        select r.work_id, r.id as rid, r.provider, x.raw, lower(regexp_replace(btrim(x.raw),'\s+',' ','g')) as whole
          from public.catalog_provider_records r
          cross join lateral jsonb_array_elements_text(coalesce(r.payload->'genres','[]'::jsonb) || coalesce(r.payload->'subjects','[]'::jsonb)) as x(raw)
         where r.work_id is not null and r.payload is not null) l
      cross join lateral (select lower(regexp_replace(btrim(p),'\s+',' ','g')) as n from regexp_split_to_table(l.raw,'\s*/\s*') p union select l.whole) z
      join public.catalog_terms g on g.status='active' and g.kind in ('genre','subgenre','subject','collection') and lower(g.name)=z.n
     where length(z.n) between 1 and 80
  ) m
 where m.provider in ('apple','google','openlibrary','hardcover')
on conflict (work_id, term_id, source) do nothing;
