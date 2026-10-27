# Phase 3 dry-run: genres and honors backfill (2026-10-27, read-only)

Source: the genre labels already stored as metadata candidates (not rejected). Classified with the app's own tested code (`books/catalogFill.ts`), not ad-hoc SQL. All 780 works were published, with empty `genres` and `honors`.

| | Works |
|---|---|
| Have a stored genre label | 276 |
| **Would be filled with genres** | **226** (Fiction 63, Self-help 30, Mystery 20, Non-fiction 20, Fantasy 14, Cookbooks 10, Romance 10, Memoir 9, ...) |
| **Would be filled with honors** | **44** (Prize winner 22, Reese's Book Club 10, Service95 Book Club 6, Oprah's Book Club 4, The Inklings 1, Inklings Book Club 1) |
| Left alone | 6 (1 "Reader favourite" tag, 3 "New release" which is derived from dates, 2 with only unmapped labels) |
| Get both genres and honors | 0 |
| No stored genre label (need a provider lookup, not part of this backfill) | 504 |

Edition details (publisher, date, pages): **nothing to backfill from stored data**. No stored value holds an edition's publisher, and the stored year and page count are work-level, so they are not copied onto editions.

Labels the classifier does not know are kept as candidates and NOT written (owner review): Translated 3, Historical 3 (alone), Creativity 2, Cooking Methods, Career, Myth, Etiquette for men, Speculative, Romcom, Business & Economics, Political Science, Satire, Literary, Family & Relationships, Literary Criticism, Social Science, Epistolary, Dystopian, Essays. Two mappings were added because they are Google's own category names seen in the data: "Biography & Autobiography" is Biography, and "Fiction / Historical" is Fiction + Historical fiction.

Files (NOT applied): `supabase/backfills/20261027_genres_honors_backfill.sql`, `supabase/rollbacks/20261027_genres_honors_backfill.rollback.sql`, check `supabase/tests/phase3-backfill-scratch-check.mjs` (11/11 on a scratch Postgres: fills 270, leaves existing values alone, writes 270 private audit notes, a re-run changes nothing, rollback empties exactly those works).
Safety: fill-only (a work is touched only if both arrays are empty), one transaction, aborts if the plan is not about 270 on a first run, no schema change.
Known limit of the rollback: genres or honors added to those works after the run are emptied too.
