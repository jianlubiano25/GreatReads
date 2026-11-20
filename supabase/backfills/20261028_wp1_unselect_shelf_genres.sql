-- WP1 data fix. Owner approved 2026-10-28 (applied the same day; see change log). Data only, no schema change, nothing deleted.
-- 64 selected+published `genre` candidates hold a prize/club/tag label (dry-run 2026-10-28).
-- Owner rules: "New release" = a TAG, not a genre (to be derived from publication dates when reliable); "Reader favourite" is RETAINED as an honor
-- (attribute it to the specific reader/curator/source when known: these 4 rows only say source "app", so that is noted for later);
-- both labels are preserved in an audit note before being un-selected as genres. Honor-type labels are added to works.honors when missing.
do $$
declare n_notes int; n_unsel int;
begin
  create temp table _bad on commit drop as
    select c.id, c.work_id, c.field_value #>> '{}' as v, c.source_name
    from public.catalog_metadata_candidates c
    where c.field_name='genre' and c.is_selected and c.status='published'
      and (c.field_value #>> '{}') ~* '(prize winner|book club|inklings|^new release$|^reader favou?rite$)';
  if (select count(*) from _bad) <> 64 then raise exception 'expected 64 rows, found %: stop and re-run the dry-run', (select count(*) from _bad); end if;

  insert into public.catalog_private_notes (work_id, target_table, target_id, kind, note)
  select work_id, 'catalog_metadata_candidates', id, 'note',
    'WP1 2026-10-28: unselected as genre; label "' || v || '" (source: ' || coalesce(source_name,'unknown') || ') ' ||
    case when v ~* '^new release$' then 'kept as TAG (derive from publication dates when reliable)'
         when v ~* '^reader favou?rite$' then 'kept as HONOR; reader/curator not recorded, attribute when known'
         else 'kept as HONOR' end
  from _bad;
  get diagnostics n_notes = row_count;

  update public.catalog_works w set honors = coalesce(w.honors,'{}') || b.v
  from _bad b
  where w.id = b.work_id and b.v !~* '^new release$'
    and not exists (select 1 from unnest(coalesce(w.honors,'{}')) h where lower(h)=lower(b.v));

  update public.catalog_metadata_candidates c set is_selected = false from _bad b where c.id = b.id;
  get diagnostics n_unsel = row_count;
  if n_notes <> 64 or n_unsel <> 64 then raise exception 'notes %, unselected %: expected 64 each, rolled back', n_notes, n_unsel; end if;
end $$;
