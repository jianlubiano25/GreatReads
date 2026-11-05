-- Rollback of merge M2 (The Witch, Marie NDiaye), applied to production 2026-10-30 with owner approval.
-- The merge changed only two work rows and added two notes; no child row was moved or deleted. Restores the exact pre-merge state; aborts if anything was changed since.
do $$
declare s uuid := '7f4d064b-dfcb-4f4e-b52d-e589dd4f55f9'; c uuid := '407c0012-14de-41e0-ac50-ba4d2e405293';
begin
  if (select count(*) from catalog_works where id=c and author_aliases=array['Marie NDiaye & Jordan Stump'] and identifiers='{"alt_keys":["the witch|marie ndiaye & jordan stump"]}'::jsonb) <> 1 then raise exception 'canonical changed since the merge: restore by hand'; end if;
  if (select count(*) from catalog_works where id=s and status='archived' and identifiers=jsonb_build_object('mergedInto', c::text)) <> 1 then raise exception 'source changed since the merge: restore by hand'; end if;
  update catalog_works set author_aliases='{}', identifiers='{}'::jsonb where id=c;   -- before: author_aliases {} , identifiers {}
  update catalog_works set status='published', identifiers='{}'::jsonb where id=s;    -- before: published, identifiers {}
  delete from catalog_private_notes where kind='note' and note like 'MERGE M2 2026-10-30%' and work_id=c;
  delete from catalog_private_notes where kind='note' and note like 'MERGED into %(M2)%' and work_id=s;
end $$;
