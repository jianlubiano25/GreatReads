-- Fixes the Supabase advisor "function_search_path_mutable" for touch_user_sync_record(). The body only uses new/old/now(), so pinning an empty
-- search_path changes nothing about what it does. Rollback: supabase/rollbacks/20261025000003_pin_touch_user_sync_record_search_path.rollback.sql
alter function public.touch_user_sync_record() set search_path = '';
