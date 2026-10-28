-- WP1 data fix (NOT APPLIED; needs owner approval). Dry-run 2026-10-28: 64 published+selected `genre` candidates hold a prize/club/tag label.
-- Never deletes. Rows stay (status published), only is_selected -> false. Honor-type labels are added to catalog_works.honors when missing.
-- "New release" (3) and "Reader favourite" (1) are not honors: only un-selected (new release is derived from dates; tag handling = WP3).
-- Pre-check (must return 64): see the SELECT at the bottom.
begin;
with bad as (
  select c.id, c.work_id, c.field_value #>> '{}' as v from catalog_metadata_candidates c
  where c.field_name='genre' and c.is_selected and c.status='published'
    and (c.field_value #>> '{}') ~* '(prize winner|book club|inklings|^new release$|^reader favou?rite$)'
), add_honor as (
  select work_id, v from bad where v !~* '^(new release|reader favou?rite)$'
)
update catalog_works w set honors = coalesce(w.honors, '{}') || a.v
from add_honor a
where w.id = a.work_id and not exists (select 1 from unnest(coalesce(w.honors,'{}')) h where lower(h)=lower(a.v));
update catalog_metadata_candidates set is_selected = false
where field_name='genre' and is_selected and status='published'
  and (field_value #>> '{}') ~* '(prize winner|book club|inklings|^new release$|^reader favou?rite$)';
-- expect 64 rows updated above; then: commit;   (else rollback;)
-- Pre-check:
-- select count(*) from catalog_metadata_candidates where field_name='genre' and is_selected and status='published' and (field_value #>> '{}') ~* '(prize winner|book club|inklings|^new release$|^reader favou?rite$)';
