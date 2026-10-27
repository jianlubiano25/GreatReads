# Live catalog schema (read-only snapshot, 2026-10-27, project `amvkwwqcepmxxkfeqjox`)

Structure only, no book data. Counts at the time: works 779, editions 59, cover candidates 1,383, metadata candidates 1,157, content versions 792, rating candidates 919, private notes 3, admins 2.
The DDL is not all in `supabase/migrations/` (see HANDOFF); this file is the reference until it is.

**catalog_works**: id, canonical_title, canonical_author, aliases text[], author_aliases text[], genres text[], honors text[], language_code, identifiers jsonb, status (draft|published|archived), work_key, main_cover_candidate_id, created_at, updated_at. Unique: work_key (when set), identifiers->>'olWork' (when set).
**catalog_editions**: id, work_id, isbn10, isbn13, openlibrary_edition_id, google_volume_id, publisher, publication_date (text), publication_year, page_count (>0), format, language_code, identifiers jsonb, source_name, source_url, status. Unique (when set): isbn13, openlibrary_edition_id, google_volume_id. No unique rule on isbn10.
**catalog_cover_candidates**: id, work_id, edition_id, image_url, source_name, source_record_id, source_url, matched_title/author, match_confidence 0..1, status (candidate|approved|rejected|published|archived), is_preferred, discovered_at, reviewed_at. Unique (work_id, image_url); one preferred published cover per work.
**catalog_content_versions**: id, work_id, edition_id, content_type (book_description|author_bio), language_code, content, source_*, status, is_selected. Unique (work, type, language, md5(content)); one selected published version per (work, type, language).
**catalog_metadata_candidates**: id, work_id, edition_id, field_name, field_value jsonb, language_code, source_*, status, is_selected, verified_at. Unique (work, field, edition, source, md5(value)); one selected published value per (work, field, edition).
**catalog_rating_candidates**: id, work_id, edition_id, source_name (apple_books|google_books|open_library), average_rating 0..5, rating_count, rating_scale, status, is_selected, checked_at.
**catalog_private_notes**: id, work_id, target_table, target_id, kind (note|rejection), note. **catalog_admins**: user_id, note.
**RLS**: everyone reads published works, editions, selected metadata/content/ratings and the main cover; only `catalog_admins` insert, update or delete (delete policies exist on every catalog table).
**Functions**: catalog_work_json, catalog_get, catalog_changes, catalog_publish_{content,cover,metadata,rating,defaults}, catalog_reject_{candidate,cover}, catalog_set_work_status, catalog_is_admin, plus triggers for updated_at and the main-cover check.
**Personal tables (not catalog)**: user_library_books (catalog_work_id / catalog_edition_id are nullable links), user_sync_records, user_settings, user_words, user_daily_pages, user_shelves, user_shelf_books, user_book_annotations, user_reading_sessions, user_library_preferences, user_sync_devices, user_profiles.
