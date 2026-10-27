-- Restores Supabase's broader default privileges for signed-in users on catalog_provider_records (not recommended). Row security still limits rows to admins.
grant truncate, references, trigger on public.catalog_provider_records to authenticated;
