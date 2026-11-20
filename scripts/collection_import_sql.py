#!/usr/bin/env python3
"""Turns a pasted list of picks into the SQL that puts them in a collection (Reese's Book Club, Oprah's Book Club, any list the owner gives).
Usage:  python3 scripts/collection_import_sql.py "Reese's Book Club" picks.txt > /tmp/import.sql      (picks.txt: one "Title | Author" per line, optional third "| note")
Prints (1) the term, (2) a PREVIEW select (matches and misses) and (3) the INSERT. Matching: same title (case/punctuation, leading the/a/an ignored) AND same author last name and first initial, on PUBLISHED books; picks with no match are listed, never guessed.
Writes only catalog_work_terms rows (source 'owner', status 'approved': the owner supplied the list). Undo: delete from catalog_work_terms where source='owner' and term_id=(the term) and created_at >= <run time>."""
import re, sys
def q(s): return "'" + s.replace("'", "''") + "'"
def slug(s): return re.sub(r'(^-|-$)', '', re.sub(r'[^a-z0-9]+', '-', s.lower().replace('&', 'and')))
name, path = sys.argv[1], sys.argv[2]
rows = []
for line in open(path, encoding='utf-8'):
    parts = [p.strip() for p in line.split('|')]
    if len(parts) >= 2 and parts[0] and parts[1]: rows.append((parts[0], parts[1]))
values = ',\n  '.join('(%s, %s)' % (q(t), q(a)) for t, a in rows)
cte = f"""with picks(title, author) as (values
  {values}
), norm as (
  select p.title, p.author, regexp_replace(regexp_replace(lower(p.title), '^(the|a|an) ', ''), '[^a-z0-9]+', '', 'g') t,
         regexp_replace(lower((regexp_split_to_array(regexp_replace(btrim(p.author), '\\s+(jr|sr)\\.?$', '', 'i'), '\\s+'))[array_length(regexp_split_to_array(regexp_replace(btrim(p.author), '\\s+(jr|sr)\\.?$', '', 'i'), '\\s+'), 1)]), '[^a-z]', '', 'g') ln from picks p
), hit as (
  select n.title, n.author, w.id work_id, w.canonical_title, w.canonical_author from norm n
  left join public.catalog_works w on w.status = 'published'
   and regexp_replace(regexp_replace(lower(w.canonical_title), '^(the|a|an) ', ''), '[^a-z0-9]+', '', 'g') = n.t
   and regexp_replace(lower(coalesce(w.canonical_author, '')), '[^a-z]', '', 'g') like left(regexp_replace(lower(n.author), '[^a-z]', '', 'g'), 1) || '%' || n.ln || '%'
)"""
print(f"insert into public.catalog_terms (kind, name, slug) select 'collection', {q(name)}, {q(slug(name))} where not exists (select 1 from public.catalog_terms where kind = 'collection' and slug = {q(slug(name))});")
print("-- PREVIEW: misses first\n" + cte + "\nselect title, author, work_id, canonical_title, canonical_author from hit order by (work_id is null) desc, title;")
print("-- INSERT (after checking the preview)\n" + cte + f"\ninsert into public.catalog_work_terms (work_id, term_id, source, status, raw_label)\nselect distinct work_id, (select id from public.catalog_terms where kind = 'collection' and slug = {q(slug(name))}), 'owner', 'approved', {q(name)} from hit where work_id is not null\non conflict (work_id, term_id, source) do update set status = 'approved';")
