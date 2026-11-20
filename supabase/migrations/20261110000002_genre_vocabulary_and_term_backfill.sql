-- Genre vocabulary + term backfill (fill only; nothing overwritten or deleted). Owner go 2026-11-10.
-- Layers: (1) RAW labels stay untouched in receipts / provider-label candidates; (2) VOCABULARY = catalog_terms (genre, subgenre, subject, collection) + catalog_term_aliases (data, editable);
-- (3) WORK terms = catalog_work_terms (provider labels = candidate, the owner's published display genre = approved). works.genres / honors stay the read model.
-- Noise labels (reading level, large type books, staff picks...) have no alias on purpose: they stay in the raw layer only.
insert into public.catalog_terms (kind, name, slug, parent_id, status)
select v.kind, v.name, trim(both '-' from regexp_replace(replace(lower(v.name),'&','and'),'[^a-z0-9]+','-','g')), (select p.id from public.catalog_terms p where p.kind='genre' and p.name=v.parent), 'active'
  from (values
  ('genre','Manga',null),
  ('genre','Short stories',null),
  ('genre','Children''s',null),
  ('genre','Christian',null),
  ('genre','Music',null),
  ('genre','Paranormal',null),
  ('genre','Religion',null),
  ('genre','Spirituality',null),
  ('genre','Sports',null),
  ('genre','Cozy',null),
  ('genre','Women''s fiction',null),
  ('subgenre','Epic fantasy','Fantasy'),
  ('subgenre','Urban fantasy','Fantasy'),
  ('subgenre','Cozy mystery','Mystery'),
  ('subgenre','Psychological thriller','Thriller'),
  ('subgenre','Domestic thriller','Thriller'),
  ('subgenre','Legal thriller','Thriller'),
  ('subgenre','Historical romance','Romance'),
  ('subgenre','Contemporary romance','Romance'),
  ('subgenre','Space opera','Science fiction'),
  ('subject','Friendship',null),
  ('subject','Family',null),
  ('subject','Magic',null),
  ('subject','Love',null),
  ('subject','Murder',null),
  ('subject','Social life and customs',null),
  ('collection','New York Times bestseller',null),
  ('collection','Prize winner',null),
  ('collection','Reese''s Book Club',null),
  ('collection','Oprah''s Book Club',null),
  ('collection','Service95 Book Club',null),
  ('collection','Reader favourite',null)
  ) as v(kind, name, parent)
 where not exists (select 1 from public.catalog_terms t where t.kind=v.kind and t.slug=trim(both '-' from regexp_replace(replace(lower(v.name),'&','and'),'[^a-z0-9]+','-','g')));

insert into public.catalog_term_aliases (source, label_norm, term_id, requires_genre, implies_genre)
select v.source, v.label_norm, t.id, v.requires_genre, v.implies_genre
  from (values
  ('apple','fiction & literature','Fiction',null,null),
  ('any','nonfiction','Non-fiction',null,null),
  ('any','fantasy fiction','Fantasy',null,null),
  ('any','fiction, fantasy, general','Fantasy',null,null),
  ('any','fiction, science fiction, general','Science fiction',null,null),
  ('any','fiction, historical, general','Historical fiction',null,null),
  ('any','fiction, romance, contemporary','Contemporary romance',null,'Romance'),
  ('any','fiction, thrillers, suspense','Thriller',null,null),
  ('any','suspense','Thriller',null,null),
  ('apple','mysteries & thrillers','Mystery',null,null),
  ('apple','mysteries & thrillers','Thriller',null,null),
  ('any','juvenile fiction','Children''s',null,null),
  ('any','children''s fiction','Children''s',null,null),
  ('any','children''s stories','Children''s',null,null),
  ('any','juvenile literature','Children''s',null,null),
  ('any','ficción juvenil','Children''s',null,null),
  ('any','young adult fiction','Young adult',null,null),
  ('any','biographies','Biography',null,null),
  ('any','biography & autobiography','Biography',null,null),
  ('any','comic books, strips','Graphic novels',null,null),
  ('any','comics & graphic novels','Graphic novels',null,null),
  ('any','humorous stories','Humor',null,null),
  ('any','sports & recreation','Sports',null,null),
  ('any','christianity','Christian',null,null),
  ('any','christian life','Christian',null,null),
  ('any','cooking','Cookbooks',null,null),
  ('any','special diet cookbooks','Cookbooks',null,null),
  ('any','chick lit','Women''s fiction',null,null),
  ('any','women in their 30s','Women''s fiction',null,null),
  ('any','classic literature','Classic',null,null),
  ('any','classics','Classic',null,null),
  ('any','romans, nouvelles','Fiction',null,null),
  ('any','ficción','Fiction',null,null),
  ('any','novela','Fiction',null,null),
  ('any','new york times bestseller','New York Times bestseller',null,null),
  ('any','prize winner','Prize winner',null,null),
  ('any','reese''s book club','Reese''s Book Club',null,null),
  ('any','oprah''s book club','Oprah''s Book Club',null,null),
  ('any','service95 book club','Service95 Book Club',null,null),
  ('any','reader favourite','Reader favourite',null,null),
  ('any','families','Family',null,null),
  ('any','family life','Family',null,null)
  ) as v(source, label_norm, term_name, requires_genre, implies_genre)
  join public.catalog_terms t on t.name=v.term_name and t.status='active'
 where not exists (select 1 from public.catalog_term_aliases a where a.source=v.source and a.label_norm=v.label_norm and a.term_id=t.id);

-- works.genres for works with an EMPTY array: the PUBLISHED display genre is exactly one genre term (by name, or by alias to a genre term)
update public.catalog_works w set genres = array[x.name]
  from (select d.work_id, min(t.name) as name, count(distinct t.id) as n
          from (select m.work_id, lower(regexp_replace(btrim(trim(both '"' from m.field_value::text)),'\s+',' ','g')) as lbl
                  from public.catalog_metadata_candidates m where m.field_name='genre' and m.status='published') d
          join public.catalog_terms t on t.kind='genre' and t.status='active'
           and (lower(t.name)=d.lbl or exists (select 1 from public.catalog_term_aliases a where a.term_id=t.id and a.label_norm=d.lbl and a.source='any'))
         group by d.work_id) x
 where x.work_id=w.id and x.n=1 and cardinality(w.genres)=0 and w.status='published';

-- work terms from the owner's PUBLISHED display genre (genre or collection term, by name or alias): approved, source app
insert into public.catalog_work_terms (work_id, term_id, source, status, raw_label)
select distinct d.work_id, t.id, 'app', 'approved', d.raw
  from (select m.work_id, trim(both '"' from m.field_value::text) as raw, lower(regexp_replace(btrim(trim(both '"' from m.field_value::text)),'\s+',' ','g')) as lbl
          from public.catalog_metadata_candidates m where m.field_name='genre' and m.status='published') d
  join public.catalog_terms t on t.kind in ('genre','collection') and t.status='active'
   and (lower(t.name)=d.lbl or exists (select 1 from public.catalog_term_aliases a where a.term_id=t.id and a.label_norm=d.lbl and a.source='any'))
  join public.catalog_works w on w.id=d.work_id
on conflict (work_id, term_id, source) do nothing;

-- work terms from the provider labels already saved on the receipts (genres + subjects, Google paths split): candidates, with their receipt. Same rules as the app (catalogTerms.mapLabelsToTerms).
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
