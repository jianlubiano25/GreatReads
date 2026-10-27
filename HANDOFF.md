# GreatReads - Handoff

Branch: `claude/best-of-vscode-catalog-ids` (best-of-vscode `3cea4d3` + 3 catalog-identity commits). Last verified 2026-10-27: `npm test` 857/857, `npx tsc --noEmit` clean, `npm run build` ok. Not device-tested. Nothing merged, no DB changes.
App: reading-companion PWA, React/Vite/TS, hand-written Supabase REST client (no supabase-js).

## 1. Rules
- Work only on this branch. Never touch `main`; no merge, deploy or force-push.
- No production Supabase writes, migrations or policy changes without explicit owner approval. Free plan: no Supabase branches.
- Never overwrite local data, bulk-replace cloud from local, or silently merge uncertain book identities.
- After every step run `npm test`, `npx tsc --noEmit`, `npm run build`. Never claim an unrun check passed.
- Report, then stop for approval before the next phase. Update this file at the end of each step.
- Owner goal: **simpler sync that still works**. Owner always uses a 12-hour clock (already in code).
--

## 1. Mission and architecture principles

Finish GreatReads (reading-companion PWA, React/Vite/TS, hand-written Supabase REST client, no Supabase JS dependency) as reliable, lightweight, fast and maintainable. Three coordinated layers:

1. **Shared catalog** — works, editions, identifiers, approved metadata, cover decisions, curated discovery. Admin-owned.
2. **Personal sync** — one mechanism for all user-owned data across a user's signed-in devices. User-owned.
3. **Local-first cache/offline** — fast render, offline edits, pending queue. A cache, never a competing source of truth.

Principles: one authoritative owner per datum; shared sync never overwrites personal data and vice-versa; no second Supabase project; no new infrastructure/dependencies without measured benefit; reuse working code; do not redesign for appearance; never bulk-replace cloud data from local; never silently merge uncertain book identities; backup/restore stays a separate recovery feature.

## 2. Branches
| Ref | Note |
|---|---|
| `claude/best-of-vscode-catalog-ids` | working branch |
| `claude/jldata2-best-of-vscode` @ `3cea4d3` | base; has the per-record sync engine |
| `GreatReads-realtime` | source of the 3 cherry-picked commits (read only) |
| `Jldata2` @ `f3f764f` | older base; only a whole-app backup, no per-record sync |

## 3. What is built
**Sync (in this branch):** per-record sync into Supabase `user_*` tables; Realtime is the fast path, a 30 s revision-only probe and reconnect catch-up give durability. Backup blob (`user_sync_records` type `backup`) is recovery only.
- Files: `librarySync.ts`, `librarySyncMerge.ts` (books, shelves, annotations, prefs); `dailyPagesSync.ts`; `settingsRecordsSync.ts` (`user_settings` per key, `user_words` per word); `editTimes.ts` (timestamps, tombstones); `runGate.ts` (locks); `linkHealth.ts` (realtime watchdog); `changeProbe.ts`; `syncStatus.ts` + `SyncStatusSection.tsx`; hook `usePersonalLibrarySync.ts`; `supabase.ts` (25 s request timeout); `cloudSync.ts` (backup).
- Conflict rules: later edit wins; equal time + different value = recorded tie (nothing overwritten); clock skew over 60 s untrusted; deletes are tombstones.
- Per-setting records are ON for every signed-in account. Kill switch: localStorage `readlife.settingsRecordsSync1="0"` or build var `VITE_SETTINGS_RECORDS_SYNC=0`. Rollback: kill switch, then `supabase/rollbacks/` 000005 then 000004.
- Realtime serializer must stay 2.0.0 (1.0.0 made every join fail).

**Catalog identity (cherry-picked):** `saveIdentityToCatalog` (`src/services/catalog.ts`) with pure rules in `src/services/books/catalogIdentity.ts`, used by admin "Save to catalog", the cover-publish modal and background capture (`capture.ts`). Writes `catalog_works.identifiers.olWork` and creates `catalog_editions` rows only when an edition id is known (ISBN check-digit validated). Invalid, conflicting or other-owned ids are reported, never written or merged. Re-save is a no-op.
Owner device test: sign in as admin, Book Info, tap Save to catalog; toast lists saved/skipped ids; check `catalog_works.identifiers` and `catalog_editions` in Supabase; save again = no new edition row.

## 4. Data facts (live Supabase, project `GreatReads`, ref `amvkwwqcepmxxkfeqjox`)
- Ignore other org projects (Kipr, Kipr v1.2).
- `catalog_works` 748 rows, but only 3 have non-empty `identifiers` (only `alt_keys`); `catalog_editions` had 0 rows at audit; on 2026-10-27 it has at least 1 (on the `nettle & bone|ursula vernon` work; origin not verified). Identity today = `work_key` (normalized title+author). Schema is sufficient; **data population and linking are the gap**.
- **Delete danger:** `catalog_editions`, `catalog_cover_candidates`, `catalog_content_versions`, `catalog_metadata_candidates`, `catalog_rating_candidates`, `catalog_private_notes` all reference `catalog_works(id)` **ON DELETE CASCADE**. Deleting a duplicate work destroys its data. `user_library_books.catalog_work_id/catalog_edition_id` and `catalog_works.main_cover_candidate_id` are SET NULL. Unique rules that will collide on re-pointing: `work_key`, `identifiers->>'olWork'`, one preferred cover per work, one selected value per metadata field.
- `user_library_books` 21 rows (1 user), 0 linked to a work or edition. `local_book_id` / `Book.id` must never be rewritten.
- RLS on all public tables: `user_*` = `auth.uid()=user_id`; `catalog_*` public-read published rows, writes only for users in `catalog_admins`. `authenticated` holds write grants on `catalog_*` (RLS gates them; consider revoking later).
- **Migration drift:** `user_settings` and `user_words` exist live with data, but migrations `20261025000004/5` are not in the live migration history. The repo also lacks most live catalog migrations. Fix by exporting live DDL (read only) and recording them as applied, not by re-applying.
- Unused tables: `user_sync_devices`, `user_reading_sessions`, `user_profiles`. Advisor warning: leaked-password protection is off (Auth setting).

## 5. Open issues and unknowns
- "Reading now" page did not update on the second device; cause not found. Check `user_library_books` status sync and the pull after a realtime event.
- Book search felt slower than Jldata2; not measured. Compare `useBookSearch.ts`, `BookSearch.tsx`, `search.ts`, `cache.ts` against Jldata2 before changing; keep genre picks and Hidden Gems.
- Real two-device tests (iPhone + iPad) still owed for everything.
- No test of `syncSettingsRecords` against a fake Supabase; nook look may flip-flop between devices.
- Cover picks, hidden books and profile photo still live in the shared `user_library_preferences` JSON.
- While an upload is pending, only stamped edits are received; unstamped items (custom book details, cover picks, removals) wait.
- `settingsRecordsSync.ts` header comment says "OFF by default" (stale; it is ON).
- Bodies of `catalog_*` SQL functions unread; unknown whether they re-check admin (RLS still protects writes).
- Owner's other queued items: Hidden Gems cache check, genre tabs.

## 6. Phases
1. **Next tasks (section 8):** catalog merge preview, then sync simplification audit. Both read only.
2. **Catalog identity foundation:** read-only dry run (exact-id / `work_key` / ambiguous / unmatched counts), then separately approved backfill and linking via admin-gated migration with a rollback script. Accept: the 21 `local_book_id`s unchanged, nothing silently merged, ambiguous rows listed, ISBN and RLS tests pass.
3. **Apply approved sync simplifications**, with two-device simulation tests (offline edit, tombstone, tie, interrupted sync, account switch) plus owner real-device test.
4. **Remaining categories and discovery:** move cover picks / hidden books / photo off the shared JSON; shared discovery shelves; decide unused tables.
5. **Release validation:** search speed vs Jldata2, security re-check, iOS PWA update check, request counts.

## 7. Owner decisions still open
Backfill: approve dry run first, write later. Export live DDL and record 000004/5 as applied. Keep or drop unused tables. Enable leaked-password protection.

## 8. Next tasks for the next Claude account (all read-only first; stop and report before any write)

### Task 1 - Catalog merge preview and safe merge (owner's in-flight work from GreatReads-realtime; nothing of it was pushed, build it fresh here)
Applicability checked 2026-10-27 (read-only SQL): the records exist, no merge code or RPC exists on any branch, `aliases[]` and `author_aliases[]` columns already exist (alternate titles need **no schema change**; verify `catalog_work_json` / `catalog_changes` actually send them to devices). The client already maps T. Kingfisher = Ursula Vernon (commit `954a598`).

Records (all `published`, none with rejected covers, none linked to personal books):
| Work id | Title / author | work_key | ids | covers / meta / content / ratings / editions |
|---|---|---|---|---|
| `a1a46652-be9b-482f-ac3c-e8d16700a552` | Nettle & Bone / T. Kingfisher (author_aliases: Ursula Vernon) | `nettle & bone\|ursula vernon` | olWork OL24510090W, alt_keys | 3 / 3 / 1 / 2 / **1** |
| `806d8475-69b3-4ee0-ba46-8780c053c17d` | Nettle & Bone / T. Kingfisher | `nettle & bone\|t. kingfisher` | none | 8 / 4 / 3 / 3 / 0 |
| `1f36b07f-f181-4ffe-86fc-11ac75612bcc` | HP and the Sorcerer's Stone / J. K. Rowling | `...sorcerer's stone\|j. k. rowling` | none | 3 / 3 / 2 / 3 / 0 |
| `e3f8a77e-7cb8-4e4a-be3e-f1a8da694980` | HP and the Sorcerer's Stone / J.K. Rowling | `...sorcerer's stone\|j.k. rowling` | olWork OL31306243W | 2 / 3 / 2 / 3 / 0 |
| `be350d24-3b7a-48e5-81e3-09733b54737c` | HP and the Philosopher's Stone / J. K. Rowling | `...philosopher's stone\|j. k. rowling` | none | 1 / 3 / 2 / 2 / 0 |
All five have empty `aliases` and `genres`; "Prize winner" is not in these works' `genres`, so find where it is stored before preserving it.

Do, in order:
1. **Read-only merge preview** (`scripts/catalog-merge-preview.ts`, output a report; no writes) for Nettle & Bone, the two Sorcerer's Stone works, and Philosopher's Stone vs Sorcerer's Stone. Per group: proposed canonical Work, what moves (identifiers, `alt_keys`, aliases, author aliases, editions, cover/metadata/content/rating candidates, rejection state, selected-cover pointer, personal links), and a **conflict list** (unique-rule collisions, differing values, ids owned by another work). Never decide an ambiguity silently.
2. **Nettle & Bone is the pilot.** Verify Ursula Vernon = T. Kingfisher from the audit evidence and records. Investigate the conflicting page counts (compare `catalog_metadata_candidates` page_count rows and the edition's `page_count`, with source/provenance) and report; do not pick one without evidence. Keep Work-level vs Edition-level metadata separate.
3. **Harry Potter:** same first novel under US and UK titles, but do not merge on title similarity alone; confirm identity by ids and edition data. Plan = one canonical Work, distinct Editions (own ISBN, publisher, date, page count, cover), the other title kept as a searchable alias. Report any schema limit before proposing a schema change.
4. **Safe merge design (needs owner approval to apply):** admin-gated function, dry-run by default; **re-point children first, never delete a source work** (cascade deletes); archive the loser via `catalog_set_work_status`; write an audit record with a JSON snapshot of every affected row so it can be rolled back; ship a rollback script. Any new table or function is a migration needing explicit approval.
5. **Source-backed missing-metadata repair workflow:** every proposed value carries a source URL/name, is labelled Work-level or Edition-level, and is applied only after owner approval.
Do not classify "Prize winner" as a genre unless the schema separates genres from categories/shelves. Export the live catalog DDL first (not in the repo), as in Phase 2.

### Task 2 - Sync simplification audit (read only)
For each sync file in section 3 (plus its tests): what it does, what depends on it, whether it can be removed or merged without losing reliability, risk (low/med/high), test coverage. Write to `docs/sync-simplification-audit.md` ending with a ranked list. No code changes until the owner approves specific items.

## 9. Change log
- 2026-10-27: Branch created from best-of-vscode; 3 GreatReads-realtime commits cherry-picked cleanly (only `src/App.tsx` overlapped); handoff files merged and slimmed into this one file.
- 2026-10-27: Added Task 1 (catalog merge preview) after read-only checks of the live catalog; found cascade-delete risk and 1 edition row now exists.
