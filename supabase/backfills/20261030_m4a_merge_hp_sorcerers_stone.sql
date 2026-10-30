-- Merge M4a (owner "Go" 2026-10-30). ONE transaction (a single DO block): guarded counts, re-point children, archive the duplicate, audit notes with a snapshot. Nothing is deleted.
-- Rules: canonical keeps its selected/preferred values; moved covers are not preferred, moved metadata/content are unselected, a rating from a source the canonical lacks keeps its flag; rows already on the canonical stay on the archived Work.
do $$
declare
  s uuid := '1f36b07f-f181-4ffe-86fc-11ac75612bcc'; c uuid := 'e3f8a77e-7cb8-4e4a-be3e-f1a8da694980'; tag text := 'M4a';
  cov jsonb; meta jsonb; con jsonb; rat uuid[]; nts uuid[]; snap jsonb;
  st text; sa text; skey text; ct text; ca text; c_cov_before int; moved_n int;
begin
  if (select count(*) from catalog_works where id in (s,c) and status='published') <> 2 then raise exception 'both works must be published'; end if;
  if exists (select 1 from catalog_works where id in (s,c) and identifiers ? 'mergedInto') then raise exception 'already merged'; end if;
  if exists (select 1 from catalog_editions where work_id=s) then raise exception 'source has editions: not supported'; end if;
  if exists (select 1 from catalog_rating_candidates where work_id=s and edition_id is not null) then raise exception 'source has edition ratings'; end if;
  if exists (select 1 from user_library_books where catalog_work_id in (s,c)) then raise exception 'personal library link found'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'pref',x.is_preferred)),'[]') into cov from catalog_cover_candidates x
    where x.work_id=s and not exists (select 1 from catalog_cover_candidates y where y.work_id=c and y.image_url=x.image_url);
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'sel',x.is_selected)),'[]') into meta from catalog_metadata_candidates x
    where x.work_id=s and not exists (select 1 from catalog_metadata_candidates y where y.work_id=c and y.field_name=x.field_name and coalesce(y.source_name,'')=coalesce(x.source_name,'') and md5(y.field_value::text)=md5(x.field_value::text));
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'sel',x.is_selected)),'[]') into con from catalog_content_versions x
    where x.work_id=s and not exists (select 1 from catalog_content_versions y where y.work_id=c and y.content_type=x.content_type and y.language_code=x.language_code and md5(y.content)=md5(x.content));
  select coalesce(array_agg(x.id),'{}') into rat from catalog_rating_candidates x
    where x.work_id=s and not exists (select 1 from catalog_rating_candidates y where y.work_id=c and y.source_name=x.source_name and y.edition_id is null);
  select coalesce(array_agg(id),'{}') into nts from catalog_private_notes where work_id=s;

  if (select count(*) from catalog_cover_candidates where work_id=s) <> 3 or jsonb_array_length(cov) <> 2
   or (select count(*) from catalog_metadata_candidates where work_id=s) <> 3 or jsonb_array_length(meta) <> 0
   or (select count(*) from catalog_content_versions where work_id=s) <> 2 or jsonb_array_length(con) <> 0
   or (select count(*) from catalog_rating_candidates where work_id=s) <> 3 or coalesce(array_length(rat,1),0) <> 0
   or coalesce(array_length(nts,1),0) <> 1 then raise exception 'counts differ from the dry-run: stop'; end if;

  select canonical_title, canonical_author, work_key into st, sa, skey from catalog_works where id=s;
  select canonical_title, canonical_author into ct, ca from catalog_works where id=c;
  select count(*) into c_cov_before from catalog_cover_candidates where work_id=c;
  snap := jsonb_build_object('s',s,'c',c,
    'c_before',(select jsonb_build_object('aliases',aliases,'author_aliases',author_aliases,'identifiers',identifiers) from catalog_works where id=c),
    's_before',(select jsonb_build_object('status',status,'identifiers',identifiers,'main',main_cover_candidate_id) from catalog_works where id=s),
    'cov',cov,'meta',meta,'con',con,'rat',to_jsonb(rat),'notes',to_jsonb(nts));

  update catalog_works set main_cover_candidate_id=null where id=s;   -- trigger: a main cover must belong to its Work
  update catalog_cover_candidates set work_id=c, is_preferred=false where id in (select (e->>'id')::uuid from jsonb_array_elements(cov) e);
  update catalog_metadata_candidates set work_id=c, is_selected=false where id in (select (e->>'id')::uuid from jsonb_array_elements(meta) e);
  update catalog_content_versions set work_id=c, is_selected=false where id in (select (e->>'id')::uuid from jsonb_array_elements(con) e);
  update catalog_rating_candidates set work_id=c where id = any(rat);
  update catalog_private_notes set work_id=c where id = any(nts);
  update catalog_works set
    aliases = case when st is not null and lower(st)<>lower(ct) and not (st = any(aliases)) then aliases||st else aliases end,
    author_aliases = case when sa is not null and ca is not null and sa<>ca and not (sa = any(author_aliases)) then author_aliases||sa else author_aliases end,
    identifiers = case when skey is not null and skey <> coalesce(work_key,'') and not (coalesce(identifiers->'alt_keys','[]'::jsonb) ? skey)
      then jsonb_set(identifiers,'{alt_keys}', coalesce(identifiers->'alt_keys','[]'::jsonb) || to_jsonb(skey)) else identifiers end
  where id=c;
  update catalog_works set status='archived', identifiers = identifiers || jsonb_build_object('mergedInto', c::text) where id=s;
  insert into catalog_private_notes (work_id, target_table, target_id, kind, note) values
    (c,'catalog_works',s,'note','MERGE '||tag||' 2026-10-30: merged duplicate '||s||' into this Work (moved '||jsonb_array_length(cov)||' covers, '||jsonb_array_length(meta)||' metadata, '||jsonb_array_length(con)||' content, '||coalesce(array_length(rat,1),0)||' ratings, '||coalesce(array_length(nts,1),0)||' notes) | SNAPSHOT '||snap::text),
    (s,'catalog_works',c,'note','MERGED into '||c||' ('||tag||') 2026-10-30; nothing deleted');

  select count(*) into moved_n from catalog_cover_candidates where work_id=c;
  if moved_n <> c_cov_before + jsonb_array_length(cov) then raise exception 'cover count mismatch'; end if;
  if (select count(*) from catalog_cover_candidates where work_id=c and is_preferred and status='published') > 1 then raise exception 'more than one preferred cover'; end if;
  if (select status from catalog_works where id=s) <> 'archived' then raise exception 'source not archived'; end if;
end $$;
