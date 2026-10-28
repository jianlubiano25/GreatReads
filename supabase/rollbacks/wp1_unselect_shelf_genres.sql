-- Rollback for wp1_unselect_shelf_genres.sql. Exact because all 64 matching rows were selected+published before and none are selected now.
-- Re-selects them (expect 64). Honors added to catalog_works.honors are harmless extras and are kept (un-selecting is the only change to undo).
update catalog_metadata_candidates set is_selected = true
where field_name='genre' and not is_selected and status='published'
  and (field_value #>> '{}') ~* '(prize winner|book club|inklings|^new release$|^reader favou?rite$)';
