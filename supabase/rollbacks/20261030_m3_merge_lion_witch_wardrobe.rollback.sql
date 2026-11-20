-- Rollback of merge M3 (applied to production 2026-10-30 with owner approval). Reads the snapshot the merge saved in its audit note on the canonical Work.
-- Moves the same rows back with their old selected/preferred flags, restores aliases/identifiers, un-archives the source, removes the two audit notes. Aborts if the source or the moved rows changed since.
do $$
declare s uuid := '45f18b3b-e6b1-44a4-90aa-395fbd630f27'; c uuid := 'b800a2cb-7873-44a1-b140-742772338a8b'; tag text := 'M3'; snap jsonb; b jsonb; sb jsonb;
begin
  select substring(note from 'SNAPSHOT (.*)$')::jsonb into snap from catalog_private_notes where work_id=c and kind='note' and note like 'MERGE '||tag||' 2026-10-30%';
  if snap is null then raise exception 'no snapshot found'; end if;
  b := snap->'c_before'; sb := snap->'s_before';
  if (select count(*) from catalog_works where id=s and status='archived' and identifiers->>'mergedInto' = c::text) <> 1 then raise exception 'source changed since the merge: restore by hand'; end if;
  if (select count(*) from catalog_cover_candidates where work_id=c and id in (select (e->>'id')::uuid from jsonb_array_elements(snap->'cov') e)) <> jsonb_array_length(snap->'cov') then raise exception 'moved covers changed since the merge'; end if;
  update catalog_cover_candidates x set work_id=s, is_preferred=(e->>'pref')::boolean from jsonb_array_elements(snap->'cov') e where x.id=(e->>'id')::uuid;
  update catalog_metadata_candidates x set work_id=s, is_selected=(e->>'sel')::boolean from jsonb_array_elements(snap->'meta') e where x.id=(e->>'id')::uuid;
  update catalog_content_versions x set work_id=s, is_selected=(e->>'sel')::boolean from jsonb_array_elements(snap->'con') e where x.id=(e->>'id')::uuid;
  update catalog_rating_candidates set work_id=s where id in (select (e#>>'{}')::uuid from jsonb_array_elements(snap->'rat') e);
  update catalog_private_notes set work_id=s where id in (select (e#>>'{}')::uuid from jsonb_array_elements(snap->'notes') e);
  update catalog_works set aliases=array(select jsonb_array_elements_text(b->'aliases')), author_aliases=array(select jsonb_array_elements_text(b->'author_aliases')), identifiers=b->'identifiers' where id=c;
  update catalog_works set status=sb->>'status', identifiers=sb->'identifiers' where id=s;
  update catalog_works set main_cover_candidate_id=nullif(sb->>'main','')::uuid where id=s;
  delete from catalog_private_notes where kind='note' and ((work_id=c and note like 'MERGE '||tag||' 2026-10-30%') or (work_id=s and note like 'MERGED into %('||tag||') 2026-10-30%'));
end $$;
