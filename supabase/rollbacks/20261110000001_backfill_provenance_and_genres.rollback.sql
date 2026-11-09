-- Undo of 20261110000001 (same rules, run backwards; the rows were empty before, so empty again).
update public.catalog_cover_candidates c set source_record_id = null
  from public.catalog_provider_records r
 where r.provider = 'google' and r.work_id = c.work_id and c.source_name = 'google' and c.source_record_id = r.provider_record_id
   and c.image_url ~ ('[?&]id=' || r.provider_record_id || '(&|$)');
-- genres: only works whose single genre equals their published display genre are emptied again (a hand-curated array is never that shape unless identical).
update public.catalog_works w set genres = '{}'
  from public.catalog_metadata_candidates m
 where m.work_id = w.id and m.field_name = 'genre' and m.status = 'published'
   and cardinality(w.genres) = 1 and lower(w.genres[1]) = lower(trim(both '"' from m.field_value::text));
