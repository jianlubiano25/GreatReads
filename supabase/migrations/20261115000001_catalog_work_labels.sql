-- Every genre / category / subject / tag label a provider gave a work, one row per work + provider + label (owner go 2026-11-15).
-- Additive: ONE new table. `catalog_work_terms` stays for labels that map to a vocabulary term; this one keeps ALL labels, mapped or not (term_id says which term, null = no term yet).
-- Candidates are admin-only; nothing here is published or changes `catalog_works.genres`. Rollback: supabase/rollbacks/20261115000001_catalog_work_labels.rollback.sql
create table if not exists public.catalog_work_labels (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.catalog_works(id) on delete cascade,
  source text not null check (source in ('apple', 'google', 'openlibrary', 'hardcover', 'app', 'owner')),
  label text not null check (length(btrim(label)) > 0 and length(label) <= 120),
  label_norm text not null check (length(label_norm) > 0),
  label_kind text not null default 'genre' check (label_kind in ('genre', 'subject', 'tag')),
  term_id uuid references public.catalog_terms(id) on delete set null,
  status text not null default 'candidate' check (status in ('candidate', 'approved', 'rejected')),
  provider_record_id uuid references public.catalog_provider_records(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_work_labels_unique unique (work_id, source, label_norm)
);
create index if not exists catalog_work_labels_work_idx on public.catalog_work_labels (work_id, status);
create index if not exists catalog_work_labels_term_idx on public.catalog_work_labels (term_id) where term_id is not null;
create index if not exists catalog_work_labels_record_idx on public.catalog_work_labels (provider_record_id) where provider_record_id is not null;
comment on table public.catalog_work_labels is 'All provider labels per work (genre/category = genre, subject = subject, tag votes = tag). term_id set when the label maps to a vocabulary term. candidate = admin only.';
drop trigger if exists catalog_work_labels_set_updated_at on public.catalog_work_labels;
create trigger catalog_work_labels_set_updated_at before update on public.catalog_work_labels for each row execute function public.catalog_set_updated_at();
alter table public.catalog_work_labels enable row level security;
drop policy if exists "Everyone reads approved labels of published works" on public.catalog_work_labels;
create policy "Everyone reads approved labels of published works" on public.catalog_work_labels as permissive for select to anon, authenticated
  using (status = 'approved' and exists (select 1 from public.catalog_works w where w.id = work_id and w.status = 'published'));
drop policy if exists "Admins manage work labels" on public.catalog_work_labels;
create policy "Admins manage work labels" on public.catalog_work_labels as permissive for all to authenticated
  using (exists (select 1 from public.catalog_admins a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.catalog_admins a where a.user_id = (select auth.uid())));
revoke all on public.catalog_work_labels from anon, authenticated, public;
grant select on public.catalog_work_labels to anon;
grant select, insert, update, delete on public.catalog_work_labels to authenticated;

-- Fill-only backfill from the provider records already saved (payload genres -> genre, subjects -> subject). Hardcover tag votes arrive as genres: kept as genre.
insert into public.catalog_work_labels (work_id, source, label, label_norm, label_kind, term_id, provider_record_id)
select distinct on (r.work_id, r.provider, n.norm) r.work_id, r.provider, left(btrim(x.raw), 120), n.norm, x.kind,
       (select t.id from public.catalog_terms t where t.status = 'active' and lower(t.name) = n.norm limit 1), r.id
  from public.catalog_provider_records r
  cross join lateral (
    select raw, 'genre' as kind from jsonb_array_elements_text(case when jsonb_typeof(r.payload->'genres') = 'array' then r.payload->'genres' else '[]'::jsonb end) raw
    union all
    select raw, 'subject' from jsonb_array_elements_text(case when jsonb_typeof(r.payload->'subjects') = 'array' then r.payload->'subjects' else '[]'::jsonb end) raw) x
  cross join lateral (select lower(regexp_replace(btrim(x.raw), '\s+', ' ', 'g')) as norm) n
 where r.work_id is not null and r.provider in ('apple', 'google', 'openlibrary', 'hardcover') and length(n.norm) between 1 and 120
 order by r.work_id, r.provider, n.norm, x.kind
on conflict (work_id, source, label_norm) do nothing;
