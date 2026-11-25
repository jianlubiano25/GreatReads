-- APPLIED 2026-11-18 with owner go (migration d3_remove_guide_olwork_again; verified: no work holds the guide id, 1 audit note) (D3). The Scholastic literature guide's Open Library id OL31306243W was removed from Work e3f8a77e (HP and the Sorcerer's Stone)
-- on 2026-10-30 (supabase/backfills/20261030_fix_hp_sorcerers_stone_wrong_olwork.sql) and a device wrote it back. The app now refuses it (NOT_THE_BOOK_IDS in books/catalogIdentity.ts).
-- This removes it again. One transaction, idempotent (does nothing if it is gone), nothing deleted: other identifiers (alt_keys, ...) stay, an audit note keeps the snapshot.
-- Undo: update catalog_works set identifiers = identifiers || '{"olWork":"OL31306243W"}'::jsonb where id = 'e3f8a77e-7cb8-4e4a-be3e-f1a8da694980';
do $$
declare w uuid := 'e3f8a77e-7cb8-4e4a-be3e-f1a8da694980'; idb jsonb;
begin
  select identifiers into idb from public.catalog_works where id = w and identifiers->>'olWork' = 'OL31306243W';
  if idb is null then return; end if;
  update public.catalog_works set identifiers = identifiers - 'olWork' where id = w;
  insert into public.catalog_private_notes (work_id, target_table, target_id, kind, note) values
    (w, 'catalog_works', w, 'note', 'FIX HP-SS 2026-11-18 (second time): Open Library work OL31306243W is the Scholastic "Literature Guide: Harry Potter and the Sorcerer''s Stone (Grades 4-8)" (edition OL7510988M, ISBN 9780439211161), not the novel; a device had written it back. Removed from identifiers.olWork again; the app now refuses these ids (NOT_THE_BOOK_IDS). | SNAPSHOT ' || jsonb_build_object('identifiers', idb)::text);
end $$;
