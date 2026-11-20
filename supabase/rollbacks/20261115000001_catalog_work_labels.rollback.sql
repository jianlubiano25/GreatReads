-- Undo 20261115000001: the table holds only copies of provider labels (the originals stay in catalog_provider_records.payload), so dropping it loses nothing else.
drop table if exists public.catalog_work_labels;
