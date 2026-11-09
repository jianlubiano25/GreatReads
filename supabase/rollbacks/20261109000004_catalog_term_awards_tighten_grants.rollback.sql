-- Gives signed-in users the broader default privileges back (not needed unless something unexpectedly depends on them).
grant truncate, trigger, references on public.catalog_terms, public.catalog_term_aliases, public.catalog_work_terms, public.catalog_awards, public.catalog_work_awards to authenticated;
