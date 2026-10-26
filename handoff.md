# GreatReads — Architecture, Shared Catalog & Unified Sync: Handoff

Status labels used throughout: **[verified]** (read/ran it myself on 2026-10-26), **[partial]**, **[planned]**, **[unknown]**.
Phase 0 (read-only audit) is **complete**. Nothing in the database or app code was changed in Phase 0; the only repo change is this file.

---

## 1. Mission and architecture principles

Finish GreatReads (reading-companion PWA, React/Vite/TS, hand-written Supabase REST client, no Supabase JS dependency) as reliable, lightweight, fast and maintainable. Three coordinated layers:

1. **Shared catalog** — works, editions, identifiers, approved metadata, cover decisions, curated discovery. Admin-owned.
2. **Personal sync** — one mechanism for all user-owned data across a user's signed-in devices. User-owned.
3. **Local-first cache/offline** — fast render, offline edits, pending queue. A cache, never a competing source of truth.

Principles: one authoritative owner per datum; shared sync never overwrites personal data and vice-versa; no second Supabase project; no new infrastructure/dependencies without measured benefit; reuse working code; do not redesign for appearance; never bulk-replace cloud data from local; never silently merge uncertain book identities; backup/restore stays a separate recovery feature.

## 2. Branches and inspected SHAs  [verified]

| Ref | SHA | Notes |
|---|---|---|
| `origin/Jldata2` (base) | `f3f764f35bfa506faceabb9e98b71cf58f3ea187` | merge-base of the two branches |
| `origin/claude/jldata2-best-of-vscode` (comparison) | `3cea4d38922bdbcabd823143bf16dde83708f86a` | **32 commits ahead, 0 behind** Jldata2 (strict superset), 79 files, +5232/−160 |
| `GreatReads-realtime` (this work) | created from `origin/Jldata2` @ `f3f764f` | feature branch for all work |
| `origin/claude/sync-realtime-fixes` | `074d8cba5160dae5b385c6c6d08e5ce33a78c286` | exists; **not inspected** [unknown] |

Supabase project: **GreatReads**, ref `amvkwwqcepmxxkfeqjox`, Postgres 17, region ap-northeast-1, ACTIVE_HEALTHY. (Other projects in the org — Kipr, Kipr v1.2 — are unrelated; do not touch.)

## 3. Verified implementation and unknowns

**Test/build baseline (commands run 2026-10-26, Node env of the audit session):**

| Branch | `npm ci` | `npm test` | `npx tsc --noEmit` | `npm run build` |
|---|---|---|---|---|
| Jldata2 `f3f764f` | ok | 692 tests, 692 pass, 0 fail | exit 0 | ok (~0.7 s) |
| comparison `3cea4d3` | (node_modules shared) | 836 tests, 836 pass, 0 fail | exit 0 | ok (~0.7 s) |

(The comparison branch's own HANDOFF.md says "811 pass"; it is stale — actual is 836.)

**Jldata2 sync today [verified]:** the only cloud sync of personal data is `src/services/cloudSync.ts`: ONE whole-app JSON backup record (`user_sync_records`, type `backup`, id `main`) with revision-checked upload, conflict refusal, safety copy before restore, auto-upload off by default. This is a backup, not incremental sync. The per-record tables exist in the DB but Jldata2 code does not use them.

**Comparison branch sync [verified by reading code headers + file list; deep logic review not done → partial]:** adds per-record sync: `librarySync.ts` (722 lines; books, annotations, shelves, memberships, preferences into the `user_*` tables), `librarySyncMerge.ts`, `dailyPagesSync.ts` (`user_daily_pages`), `settingsRecordsSync.ts` (`user_settings` per key, `user_words` per word), `editTimes.ts` (timestamped edits/tombstones), `runGate.ts` (locks), `linkHealth.ts` (realtime watchdog), `changeProbe.ts` (30 s revision-only safety check), `syncStatus.ts` + `SyncStatusSection.tsx`, hook `usePersonalLibrarySync.ts`. Realtime serializer bug fixed (2.0.0). Phase 4 per-setting records are **ON by default** in code (`settingsRecordsFlag.ts` returns true unless `readlife.settingsRecordsSync1="0"` or `VITE_SETTINGS_RECORDS_SYNC=0`); the header comment in `settingsRecordsSync.ts` still says "OFF by default" — stale comment.

**Shared Supabase client [verified]:** `src/services/supabase.ts` (176 lines on Jldata2) — email/password + Google redirect, PostgREST `rest()`/`rpc()`; the comparison branch adds a 25 s request timeout. Session stored in `readlife.sb1` (device-local, not in backups).

**Unknowns / not done in Phase 0:**
- Bodies of the `catalog_*` SQL functions (publish/reject/get/changes) were not read; whether each re-checks admin inside the function is **[unknown]** (none are SECURITY DEFINER, so table RLS applies to the caller — see §7).
- Real two-device behaviour: comparison HANDOFF lists real-device tests still owed, and an unresolved bug ("Reading now" not updating on 2nd device) **[unknown]**.
- Search speed regression claim (comparison HANDOFF): not measured. Search-path diffs vs Jldata2 are small (`search.ts` +15, `useBookSearch.ts` 8 lines, `BookSearch.tsx` 6, `cache.ts` 13, `googleBooks.ts`/`openLibrary.ts` few lines, `identity.ts` 11) — candidates to review before porting.
- Why `user_library_books.book_snapshot` stores a full `Book` copy per row (duplicated data) and whether notes/highlights land in `user_book_annotations` (live table has 0 rows) or in `personal_data` **[unknown]**.

## 4. Book identity and catalog field inventory

**App side [verified]:** `Book.id` (string|number) is the GreatReads record id, never derived/changed by identity code. `Book.identity?: BookIdentity` = `{olWork, olEdition, gbVolume, isbn13, isbn10}`. `src/services/books/identity.ts` (265 lines) is the single "which book is this" module: `titleKey` (NFKD, subtitle/brackets/article stripping, multi-script safe), `subtitleKey` (ignores generic/marketing subtitles), `primaryAuthor`, author-alias matching via `authorAliases.ts`; the comparison branch adds ISBN check-digit validation (`4be58e0`) and "never pick a catalog work by storage order when duplicates fit equally" (`d5ad2f9`).

**DB side [verified live]:**
- `catalog_works` (748 rows, all `published`): `canonical_title`, `canonical_author`, `aliases[]`, `author_aliases[]`, `genres[]`, `language_code`, `identifiers jsonb`, `work_key` (748 non-null, 748 distinct, unique index), `main_cover_candidate_id` (697 set), `status`.
- `catalog_editions` (**0 rows**): `isbn10`, `isbn13`, `openlibrary_edition_id`, `google_volume_id`, publisher, publication_date/year, page_count (>0), format, language, `identifiers jsonb`, source_name/url, status. Partial **unique** indexes on isbn13, openlibrary_edition_id, google_volume_id (isbn10 has no unique index).
- `catalog_cover_candidates` (1309), `catalog_metadata_candidates` (1074, field_name + jsonb value + provenance + selected flag), `catalog_content_versions` (734; description/author_bio), `catalog_rating_candidates` (884; per-provider, never combined), `catalog_private_notes` (3), `catalog_admins` (1). One-preferred-cover-per-work and one-selected-value partial unique indexes exist.
- **Identifier coverage is the real gap:** only **3 of 748** works have non-empty `identifiers`, and the only key present is `alt_keys` — no `olWork`, ISBN or provider IDs at all. (Unique index `catalog_works_ol_work_unique` on `identifiers->>'olWork'` exists but is unused.) Work identity today rests on `work_key` (a normalized title+author key).
- Personal links: `user_library_books` 21 rows, 1 user, **0 linked** to a catalog work, **0** to an edition; 2 rows soft-deleted.

**Field support vs requirement:** work/edition separation ✓ schema; ISBN-10/13, OL edition, Google volume ✓ edition columns; OL work ✓ (jsonb key); extra providers ✓ (`identifiers` jsonb); translated/alternate titles ✓ (`aliases`, plus metadata candidates); author aliases ✓ (`author_aliases`); preferred jacket author name ⚠ partial — lives client-side (`nameChoices1`, authorAliases store) and in metadata candidates [unknown which]; descriptions/author bio ✓ content_versions; provenance ✓ source_* columns; admin-only cover/rejection ✓ (RLS, §7). **Schema is sufficient; data population and linking are missing.**

## 5. Personal-data inventory and sync coverage

Storage locations come from `readlife.*` localStorage keys found in the code (names are the evidence; per-key contents not individually inspected → **[partial]**). "Sync (Jldata2)" = what Jldata2 does; "Sync (compare)" = what the comparison branch does per its code/HANDOFF (needs real-device validation).

| Category | Local storage (key) | Sync (Jldata2) | Sync (compare) | Intended authority |
|---|---|---|---|---|
| Library books, status, progress, history, ratings, notes, highlights, words, goals, hidden books, edit times | `readlife.v2` (+`.backup`,`.recovery`; legacy `readlife.library`,`readlife.v1`) | backup blob only | per-record: `user_library_books`, `user_book_annotations`, `user_words`, timestamped edits + tombstones | Cloud per-record tables; local = cache + pending |
| Custom shelves / collections | `readlife.libcollections1` | backup blob only | `user_shelves`, `user_shelf_books` | Cloud |
| Daily pages / totals | in state (per day) | backup blob only | `user_daily_pages` (latest edit wins) | Cloud; **totals derived**, not stored |
| Settings: goal, intention, profile name, theme, garden, nook look/toggles, store layout, fonts, name choices | `readlife.fonts1`, `nameChoices1`, `storeprefs1`, nook prefs, state | backup blob only | `user_settings` per key (10 keys); garden merged as high-water marks | Cloud |
| Cover picks, profile photo, other prefs | `readlife.coverPicks1`, state | backup blob | still in shared `user_library_preferences` JSON (compare HANDOFF: "Phase 6 not started") | Cloud (move off shared JSON later) |
| Achievements | derived/garden state | backup blob | garden record (peaks are high-water marks) | Permanent records kept in cloud |
| Device-only (must NOT sync) | `sb1` session, `deviceId1`, `cloudRev1/Hash1/Last1/Auto1`, `autoUpdate1`, `googleKey1`, `perflog`, `captured1`/capture flags, `recentSearches` | n/a | n/a | Local only |
| Shared-data caches (rebuildable) | `appleCharts1`, `catalog1`, `covers1`, `sharedCovers1`, `coverCands1`, `bookinfo1`, `curated*`, `store1-3`, `shelves1-3`, `resolved*`, `genrepool1`, `honors1`, `nyt1`, `meta2-6`, `ratingsrc*` … | local | local | Shared catalog/discovery; cache only |

Live cloud contents [verified]: `user_settings` 6 rows (theme, garden, nook_look, nook_toggles, profile_name, store_layout), `user_words` 4, `user_daily_pages` 4, `user_library_books` 21, `user_shelves` 1, `user_shelf_books` 7, `user_library_preferences` 1, `user_sync_records` 2 (both `backup`). Empty/unused: `user_book_annotations` 0, `user_reading_sessions` 0, `user_profiles` 0, `user_sync_devices` 0.

## 6. Data ownership and authority matrix

| Data | Authority | Writers | Local role |
|---|---|---|---|
| Work/edition identities, identifiers, approved metadata, descriptions, bios, ratings, genres | Supabase `catalog_*` | admins only (RLS) | read cache |
| Cover candidates, preferred/rejected/published cover, protected overrides | `catalog_cover_candidates` + `catalog_works.main_cover_candidate_id` | admins only | read cache; owner "settled" picks preserved |
| Discovery shelves (Hidden Gems, prizes, genres, new, trending) | **[planned]** shared shelf definitions + membership/rank (today: client-computed/seeded JSON; no DB tables) | admins / build job | cached ranks; no full records per shelf |
| Personal library, progress, history, ratings, annotations, custom shelves, words, settings, daily pages | per-user rows (`user_*`), RLS `auth.uid()=user_id` | that user's devices | cache + durable pending edits |
| Backup snapshot | `user_sync_records` type `backup` | that user | recovery only, never routine sync |
| Session/device ids, caches | device | device | local only |

## 7. Supabase schema, security, migration and sync findings  [verified unless noted]

- **RLS:** enabled on all 20 public tables. `user_*` tables: single `ALL` policy `auth.uid() = user_id` (authenticated). `catalog_*`: anon/authenticated read only published rows (covers: only the published main cover); all writes gated by `EXISTS (select 1 from catalog_admins where user_id = auth.uid())`; `catalog_admins` readable only by self. Admin enforcement is in the database, as required.
- **Grants:** `authenticated` holds DELETE/INSERT/UPDATE on every `catalog_*` table (safe only because RLS gates it; consider revoking write grants and routing writes through admin RPCs — defense in depth, not an urgent bug). `anon` has SELECT on published catalog tables only; no anon grants on `user_*`.
- **Functions:** 17 public functions, **none SECURITY DEFINER**; `touch_user_sync_record` search_path pinned (migration 3). Bodies unread → admin checks inside `catalog_publish_*`/`catalog_reject_*` **[unknown]** (RLS still protects the underlying writes).
- **Advisors (security):** only WARN = *Leaked Password Protection disabled* (Auth setting; dashboard toggle, needs owner approval). Performance advisors **not run** [unknown].
- **Realtime publication:** `user_library_books, user_book_annotations, user_shelves, user_shelf_books, user_reading_sessions, user_library_preferences, user_daily_pages, user_settings, user_words`. `user_sync_records` and `catalog_*` are not published (fine: catalog is pulled via `catalog_changes(p_since, p_limit)`).
- **Indexes:** `(user_id, updated_at)` incremental-sync indexes exist on books, shelves, shelf_books, annotations(user,book,updated), sync_records; settings/words/daily_pages use PKs only (small tables). Catalog has GIN on aliases and identifiers, partial uniques as above. No missing-index problem identified at current scale (748 works, 21 books).
- **Migration drift [verified]:** live migration list (14) ends at `20261025055919 pin_touch_user_sync_record_search_path`. Tables `user_settings` and `user_words` **exist live with data** but their migrations (`20261025000004/5`, present on the comparison branch) are **not in the migration history** — applied outside `apply_migration` or history was not recorded. Also, Jldata2's `supabase/migrations/` holds only one file (`20261022_catalog_rejected_covers_and_publish_defaults.sql`); the other live catalog migrations are not in the repo. Repo and database history are therefore out of sync. Fix by exporting the live DDL into the repo (read-only) rather than re-applying.
- **Duplicated state / competing sources [verified or strongly indicated]:** (1) `user_sync_records` backup blob vs per-record tables; (2) `user_library_preferences` shared JSON vs `user_settings` (compare branch makes the JSON fill-only-empty when Phase 4 is on); (3) `book_snapshot` jsonb copies a full Book into each personal row beside the catalog; (4) unused tables `user_sync_devices`, `user_reading_sessions`, `user_profiles`.
- **Conflict design in compare branch:** per-record `revision` (optimistic), per-setting `edited_at/edit_seq/device_id` (later edit wins; equal-time/different-value = recorded tie, nothing overwritten; clock skew >60 s untrusted), tombstones via `deleted_at`, first-sync field-by-field merge, "use cloud" and safety-copy before resolving. Sound in design; needs real two-device proof.

## 8. Recommended target architecture (smallest suitable)

**Option chosen: #2, refactor incrementally** — keep the Supabase schema; adopt the comparison branch's per-record sync as the single sync engine; fix data (not schema) for the catalog.

1. **Catalog:** keep `catalog_works` + `catalog_editions` + candidate/content/rating/notes tables unchanged. Add only: (a) an admin-only backfill that fills `identifiers` (olWork, isbn13, google volume, etc.) on works and creates `catalog_editions` rows **only when edition data is actually known**; (b) a safe linker setting `user_library_books.catalog_work_id/catalog_edition_id` by **exact identifier match first, then unique `work_key` match; ambiguous → left NULL and listed**; (c) `isbn10` unique partial index (after checking for duplicates); (d) `isbn13/isbn10` check-digit CHECK or validation in the write RPC. No new tables for titles/aliases/authors (existing arrays + candidates suffice). Not requiring an ISBN/edition remains true (columns nullable; `work_key` identity).
2. **Personal sync:** one engine = the comparison branch's (`librarySync*`, `settingsRecordsSync`, `dailyPagesSync`, `editTimes`, runGate/linkHealth/changeProbe, status screen). Realtime = fast path; `changeProbe` + reconnect catch-up = durability. `user_sync_records:backup` stays as backup/restore only. Move cover picks/hidden books/profile photo off the shared preferences JSON later (small additive records or `user_settings` keys; photo → storage reference). Drop duplicate derived totals; keep permanent achievements.
3. **Local-first:** unchanged rendering path (local state first, background catalog pull via `catalog_changes`), pending edits preserved; don't touch search ranking.
4. **Discovery shelves:** shared definition + ordered membership of work ids (small tables or one JSON per shelf, decided in Phase 4); results cached locally.
5. **Housekeeping:** export live DDL into repo migrations; reconcile history; decide fate of unused tables.

**Why simplest:** the schema already models work/edition/provenance/admin-control correctly; the problems are empty data, unlinked rows, schema/repo drift, and a sync engine that exists only on the other branch. Reusing it avoids writing a second engine.

## 9. Rejected alternatives

- **Keep Jldata2 as-is (option 1):** its only "sync" is a whole-state backup; fails offline/incremental/conflict/deletion requirements.
- **New clean schema + gradual migration (option 3):** no verified defect justifies it; the existing catalog schema meets the work/edition/identifier/provenance needs; migration risk with live user rows for no benefit.
- **Blind merge of comparison into Jldata2:** it is a superset (fast-forward-able) but carries unverified search-path changes the owner reports as slower, plus stale docs; port in reviewed groups instead.
- **Realtime-only sync:** not durable (missed events while offline); keep pull/probe catch-up.
- **Backup snapshot as sync:** whole-state uploads, conflict-prone; keep as recovery only.
- **Second Supabase project / extra services / new dependencies:** no justification.
- **Normalizing every metadata field into its own table:** unnecessary; candidates + selected flag already do it.

## 10. Ordered implementation phases and acceptance criteria

(Each phase: small, reviewable, rollback-able; update this file at the end of each.)

- **Phase 1 – Decisions (no code):** owner answers §13 decisions. *Done when* approvals recorded here.
- **Phase 2 – Catalog identity foundation.**
  Scope: read-only DDL export into repo; dry-run report of identifier backfill + link matches (counts: exact / key / ambiguous / none) **before** any write; then approved backfill + linking via admin-gated RPC/migration.
  Tables: `catalog_works`, `catalog_editions`, `user_library_books` (nullable FK columns only). Files: `src/services/books/identity.ts`, `catalog.ts`, new migration + rollback.
  *Accept:* all 21 personal `local_book_id`s unchanged; zero rows silently merged; ambiguous list empty-or-listed; ISBN validation tests; RLS tests (non-admin cannot write); rollback script restores NULL links.
- **Phase 3 – One end-to-end sync path.** Port (cherry-pick, in groups) comparison-branch sync for library books + daily pages + settings + words, with `supabase.ts` timeout/gate pieces; exclude search-path diffs. *Accept:* automated two-device simulation, offline edit + reconnect, delete/tombstone, conflict/tie, interrupted-sync recovery, sign-out/account-switch isolation tests pass; real iPhone+iPad test by owner.
- **Phase 4 – Remaining categories + discovery:** cover picks/hidden books/photo off shared JSON; shared discovery shelves; admin cover decisions end-to-end; decide unused tables. *Accept:* no category left only in the preferences blob or only local; shelves cached, no duplicated book records.
- **Phase 5 – Release validation:** migration validation, regression (search relevance/speed vs Jldata2 baseline), security re-check (advisors, RLS tests), PWA update check on iOS (no reinstall), performance check (request counts, no full-state writes). *Accept:* all tests/build green, owner sign-off.

## 11. Migration, compatibility, recovery, rollback

- No Phase 0 data change. All later DDL: additive, with a rollback script beside it (pattern already used in compare branch: `supabase/rollbacks/`).
- Before any data write: JSON backup (app's Backup) + SQL export of affected `user_*` and `catalog_*` rows.
- Linking is reversible (set the two FK columns back to NULL); `Book.id`/`local_book_id` never rewritten.
- Compare-branch kill switch: `localStorage readlife.settingsRecordsSync1="0"` / `VITE_SETTINGS_RECORDS_SYNC=0`; rollbacks `…000005` then `…000004` (note live drift in §7 — confirm tables/history before relying on them).
- Backward compatibility: older installed PWAs keep using the backup record + shared preferences; per-record tables are additive. Keep `preferences` JSON writable until Phase 4 completes.
- Free plan: no Supabase branches → test DDL on a scratch project/local only, never production, without approval.

## 12. Completed work, outstanding, blockers, test results

- **Completed (Phase 0):** repo cloned; branch `GreatReads-realtime` created from Jldata2 `f3f764f`; both branches baselined (table in §3); live schema/RLS/policies/grants/indexes/functions/publication/advisors/migration list inspected read-only; counts in §4–5; this file written.
- **Outstanding:** §10 Phases 1–5; function-body review; performance advisors; search-speed measurement; real-device tests.
- **Blockers:** none for Phase 1. Phase 2 writes need explicit approval.
- **Test results (Phase 0, run, not assumed):** see §3 table.

## 13. Approval gates and safety requirements

Decisions needed from owner (Phase 1):
1. **Sync source:** approve porting the comparison branch's sync into `GreatReads-realtime` in reviewed groups (excluding search-path diffs until measured)?
2. **Catalog backfill/linking:** approve a *read-only dry run* first, then separately approve the write?
3. **Migration drift:** approve exporting live DDL into repo (read-only) and recording `…000004/5` as already applied?
4. **Unused tables** (`user_sync_devices`, `user_reading_sessions`, `user_profiles`): keep for future or drop later?
5. **Leaked-password protection** (Auth setting): approve enabling?
6. **Security hygiene:** a GitHub fine-grained token was pasted into chat to allow this push — **revoke/rotate it now**; use a fresh short-lived token for later phases.

Standing safety rules: work only on `GreatReads-realtime`; never touch `main`; no merge/deploy/force-push without approval; no production schema/data/policy/function change without approval; never clear/overwrite local data; never bulk-replace cloud from local; never silently merge uncertain identities; record exact commands and results; never claim an unrun test passed.

## 14. Exact next task for the next Claude account

Phase 1, then Phase 2 step 1 (read-only): (a) obtain answers to §13; (b) export live DDL (tables, policies, functions, indexes, publication) to `supabase/schema-snapshot-2026-10-26.sql` via read-only queries; (c) write `scripts/catalog-link-dryrun.ts` (read-only) that, for the 21 `user_library_books` rows and the 748 works, reports exact-ID / `work_key` / ambiguous / unmatched counts using `src/services/books/identity.ts`; (d) update this file; **stop and report before any write.**

## 15. Change log

- **2026-10-26** — Phase 0 audit complete; branch `GreatReads-realtime` created from Jldata2 `f3f764f`; baselines recorded (Jldata2 692/692, comparison 836/836, tsc/build clean); `handoff.md` created. No app-code or database changes.
