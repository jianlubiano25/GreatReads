-- Rollback of the HP Sorcerer's Stone wrong-olWork fix (applied 2026-10-30 with owner approval): re-selects pageCount 16 / year 2000, restores identifiers from the snapshot, removes the audit note. Aborts if olWork was set again since.
do $$
declare w uuid := 'e3f8a77e-7cb8-4e4a-be3e-f1a8da694980'; snap jsonb;
begin
  select substring(note from 'SNAPSHOT (.*)$')::jsonb into snap from catalog_private_notes where work_id=w and kind='note' and note like 'FIX HP-SS 2026-10-30%';
  if snap is null then raise exception 'no snapshot found'; end if;
  if (select identifiers ? 'olWork' from catalog_works where id=w) then raise exception 'olWork was set again since the fix: restore by hand'; end if;
  update catalog_metadata_candidates set is_selected=true where id in ((snap->>'pc')::uuid,(snap->>'yr')::uuid);
  update catalog_works set identifiers = snap->'identifiers' where id=w;
  delete from catalog_private_notes where work_id=w and kind='note' and note like 'FIX HP-SS 2026-10-30%';
end $$;
