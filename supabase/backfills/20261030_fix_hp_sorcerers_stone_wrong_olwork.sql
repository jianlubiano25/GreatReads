-- Fix (owner "approve fix" 2026-10-30): Work e3f8a77e (HP and the Sorcerer's Stone) carried olWork OL31306243W = a Scholastic literature guide (not the novel).
-- ONE transaction: un-select its guide-derived pageCount 16 and year 2000 (rows kept), remove the wrong olWork from identifiers (alt_keys kept), add an audit note with a snapshot. Nothing deleted.
do $$
declare w uuid := 'e3f8a77e-7cb8-4e4a-be3e-f1a8da694980'; pc uuid; yr uuid; idb jsonb;
begin
  select identifiers into idb from catalog_works where id=w and status='published' and identifiers->>'olWork'='OL31306243W';
  if idb is null then raise exception 'work state differs: stop'; end if;
  select id into pc from catalog_metadata_candidates where work_id=w and field_name='pageCount' and is_selected and status='published' and field_value='16'::jsonb;
  select id into yr from catalog_metadata_candidates where work_id=w and field_name='year' and is_selected and status='published' and field_value='"2000"'::jsonb;
  if pc is null or yr is null then raise exception 'pageCount/year rows differ: stop'; end if;
  update catalog_metadata_candidates set is_selected=false where id in (pc,yr);
  update catalog_works set identifiers = identifiers - 'olWork' where id=w;
  insert into catalog_private_notes (work_id, target_table, target_id, kind, note) values
    (w,'catalog_works',w,'note','FIX HP-SS 2026-10-30: Open Library work OL31306243W is the Scholastic "Literature Guide: Harry Potter and the Sorcerer''s Stone (Grades 4-8)" (edition OL7510988M, ISBN 9780439211161), not the novel. Removed from identifiers.olWork; pageCount 16 and year 2000 (from that guide) un-selected, rows kept. | SNAPSHOT '||jsonb_build_object('identifiers',idb,'pc',pc,'yr',yr)::text);
  if (select identifiers ? 'olWork' from catalog_works where id=w) then raise exception 'olWork still set'; end if;
end $$;
