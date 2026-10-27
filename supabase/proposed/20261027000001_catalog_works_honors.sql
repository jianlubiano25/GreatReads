-- PROPOSED, NOT APPLIED. Needs the owner's explicit approval. Additive: old app versions ignore the new key.
-- Live definition captured read-only on 2026-10-27 (also serves as the rollback source).
alter table public.catalog_works add column if not exists honors text[] not null default '{}';
comment on column public.catalog_works.honors is 'Honors & awards and book-club picks (e.g. Oprah''s Book Club - Mar 2026, Women''s Prize 2021). Not genres.';

CREATE OR REPLACE FUNCTION public.catalog_work_json(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare w public.catalog_works%rowtype; rej jsonb;
begin
  select * into w from public.catalog_works where id = p_id;
  if not found then return null; end if;
  select coalesce(jsonb_agg(c.image_url order by c.created_at), '[]'::jsonb) into rej
    from public.catalog_cover_candidates c where c.work_id = w.id and c.status = 'rejected';
  if w.status <> 'published' then
    if jsonb_array_length(rej) = 0 then return null; end if;
    return jsonb_build_object(
      'id', w.id, 'key', w.work_key, 'title', w.canonical_title, 'author', w.canonical_author, 'aliases', w.aliases, 'authorAliases', w.author_aliases,
      'genres', '[]'::jsonb, 'language', w.language_code, 'identifiers', '{}'::jsonb, 'updatedAt', w.updated_at,
      'cover', null, 'content', '[]'::jsonb, 'metadata', '[]'::jsonb, 'ratings', '[]'::jsonb, 'editions', '[]'::jsonb, 'rejectedCovers', rej);
  end if;
  return jsonb_build_object(
    'id', w.id, 'key', w.work_key, 'title', w.canonical_title, 'author', w.canonical_author, 'aliases', w.aliases, 'authorAliases', w.author_aliases,
    'genres', w.genres, 'honors', w.honors, 'language', w.language_code, 'identifiers', w.identifiers, 'updatedAt', w.updated_at,
    'cover', (select c.image_url from public.catalog_cover_candidates c where c.id = w.main_cover_candidate_id and c.status = 'published'),
    'content', coalesce((select jsonb_agg(jsonb_build_object('type', v.content_type, 'language', v.language_code, 'content', v.content, 'source', v.source_name, 'sourceUrl', v.source_url))
                         from public.catalog_content_versions v where v.work_id = w.id and v.status = 'published' and v.is_selected), '[]'::jsonb),
    'metadata', coalesce((select jsonb_agg(jsonb_build_object('field', m.field_name, 'value', m.field_value, 'edition', m.edition_id, 'source', m.source_name))
                          from public.catalog_metadata_candidates m where m.work_id = w.id and m.status = 'published' and m.is_selected), '[]'::jsonb),
    'ratings', coalesce((select jsonb_agg(jsonb_build_object('source', r.source_name, 'average', r.average_rating, 'count', r.rating_count, 'checkedAt', r.checked_at))
                         from public.catalog_rating_candidates r where r.work_id = w.id and r.status = 'published' and r.is_selected), '[]'::jsonb),
    'editions', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'isbn10', e.isbn10, 'isbn13', e.isbn13, 'publisher', e.publisher, 'year', e.publication_year, 'pages', e.page_count, 'language', e.language_code))
                          from public.catalog_editions e where e.work_id = w.id and e.status = 'published'), '[]'::jsonb),
    'rejectedCovers', rej);
end $function$;
