-- Data backfill (fill only, nothing overwritten, nothing deleted). Owner go 2026-11-10.
-- 1) Google cover candidates: record WHERE the picture came from, but only when the Google volume id is in the image address and the same work has a receipt for that volume.
--    (Apple/Open Library covers are NOT guessed: their addresses do not name the record, and a guessed source would be invented provenance.)
update public.catalog_cover_candidates c
   set source_record_id = r.provider_record_id
  from public.catalog_provider_records r
 where r.provider = 'google' and r.work_id = c.work_id
   and c.source_name = 'google' and c.source_record_id is null
   and c.image_url ~ ('[?&]id=' || r.provider_record_id || '(&|$)');

-- 2) Works with an EMPTY genres array whose PUBLISHED display genre is exactly the name of one genre term (Fiction, Fantasy, Romance, ...): the array gets that one term.
--    Labels that are not genre terms (prize winner, Oprah's Book Club, manga, sports...) are left alone. The updated_at trigger makes the app's catalog sync pick the change up.
update public.catalog_works w
   set genres = array[x.name]
  from (select m.work_id, min(t.name) as name, count(distinct t.name) as n
          from public.catalog_metadata_candidates m
          join public.catalog_terms t on lower(t.name) = lower(trim(both '"' from m.field_value::text)) and t.kind = 'genre'
         where m.field_name = 'genre' and m.status = 'published'
         group by m.work_id) x
 where x.work_id = w.id and x.n = 1 and cardinality(w.genres) = 0 and w.status = 'published';
