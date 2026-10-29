# GreatReads - HANDOFF (short on purpose: read this file only; open the linked docs only for the part you work on)

## START HERE
- Branch: `claude/best-of-vscode-catalog-ids` only. Never `main`; no merge, deploy or force-push. Last full checks 2026-10-29: 891/891 tests, tsc clean, build ok. Nothing device-tested. Claude has made no production DB change except the approved ones in the change log.
- Owner is **not a coder**: plain words, approval asked in plain words. Owner uses several free Claude accounts and may hit quota at any time.
- **Done and pushed:** Phases 0-3 (docs, fill code, `catalog_provider_records`, receipts, 270-work backfill), WP1 genre hygiene, F1, H1 empty-pool fix, **C1** (Store lists, reset marks, shelf covers survive app updates; IndexedDB safety copy `durableCopy.ts` restored in `main.tsx`; covers reused by title+author; lost list rebuilt from last good copy; test `store/durableShelves.test.ts`), cleanup pass (dead code removed). Owner still has to check on iPhone: after an update and after a multi-hour close, no default-list flash, no cover placeholders.
- **CURRENT TASK (owner approved 2026-10-30): "one path for book data" S0-S4 in `docs/cover-one-path-plan.md`.** Read that plan; do ONE stage per session, in order: ~~S1 matcher~~ DONE, ~~S2 `knownCover`~~ DONE, ~~S3~~ DONE (picker lists stored covers first; owner star publishes + force-syncs; conflicting ids kept as `alternateIds` notes), S4 move the old shared-covers list (Cloudflare KV `/api/covers`, `readlife.sharedCovers1`) into Supabase then remove KV (needs approval at the import and at the removal). Picker and the admin `<>` must stay working. Owner answers (S0): star wait = iPhone, same device, ~1-2 min; and after hours/a day covers show placeholders then switch (still after C1): both recorded in the plan (item 4/5), handle in S2/S3. Then Group 2 rest (WP2a startup log, needs one iPhone cold-start log).
- Owner rules kept for WP3: "New release" = tag derived from publication dates; "Reader favourite" = honor attributed to its reader/curator/source when known.
- Last checks 2026-10-30 (S3): 932/932 tests, tsc clean, build ok.
- Admin publish message seen 2026-10-30 (Hollow Bones: 2 Google volume ids on one edition; The Witch: 2 Open Library ids): it is the safety rule working (conflicting ids are reported, never overwritten). S3 now keeps the second id as an unpublished `alternateIds` note. Read-only check 2026-10-30: Hollow Bones (Jodi Picoult) and The Witch (Freida McFadden) each have ONE Work, so nothing to merge there; the extra ids are other provider records (cannot be verified from the container: providers unreachable). Owner's merge policy: same book + same author = one canonical Work, keep the 2nd id as an alternate identifier; different books with one title stay separate; other editions/translations = one Work with several Editions. Verify from stored metadata (ids, ISBN, publisher, year), never title similarity; keep personal links, curated covers and metadata. Likely real duplicates found (unverified, Task B): The Witch by Marie NDiaye (`407c0012-...` vs `7f4d064b-...` "& Jordan Stump", translator credit) and The Lion, the Witch and the Wardrobe (`45f18b3b-...` C. S. Lewis vs `b800a2cb-...` C.S. Lewis); 0 personal links on all of them. Applying any merge needs approval.
- **EVERY COMMIT updates this file:** rewrite CURRENT TASK, add one change-log line, delete finished detail, keep this file under ~80 lines (move reference material to `docs/handoff-reference.md`).
- **PHASE-END ROUTINE:** when a step finishes: run the 3 checks (`npm test`, `npx tsc --noEmit`, `npm run build`; never claim an unrun check passed), update this file, commit, push to this branch only. Pushing the branch is pre-approved; migrations, backfills, merges, deploys and live-database writes always need explicit approval in chat.
- **Token:** the owner pastes a GitHub token each session. Use it only for the push (`git push https://x-access-token:$TOKEN@github.com/jianlubiano25/GreatReads.git HEAD:claude/best-of-vscode-catalog-ids`), never save it in `.git/config`, a file or a commit; remind the owner once to revoke it. The repo is public: never commit data exports, provider payloads or private notes.
- **New Claude:** `git clone -b claude/best-of-vscode-catalog-ids https://github.com/jianlubiano25/GreatReads.git`, `npm ci`, read this file, run the 3 checks, continue from CURRENT TASK. Do not redo finished work or repeat audits. Token saving: read only the files a stage lists; run single test files (`npx tsx --test <file>`) while working and the full suite once at the end.

## Rules
- Never delete catalog data. Merge = add missing info to one record, keep everything. Never overwrite local data or bulk-replace cloud from local. Never silently merge uncertain identities; list conflicts. Fill-only; keep provenance; never overwrite curated or published values; never touch personal library data. Respect `docs/provider-terms.md`.
- Supabase is the shared source of truth; the device catalog is a cache kept in step with it; personal data and personal cover picks stay separate from catalog rows.
- No new dependencies or migrations without asking. Owner always uses a 12-hour clock (already in code).
- Free plan: no Supabase branches. Catalog deletes cascade (a Work delete destroys its covers/metadata): archive, never delete.

## Work plan after the current task (each group only on the owner's "go"; details `docs/work-packages.md`)
- **Group 3 shelves/Discover:** WP2c failing shelves, open part of H1 (why `classics` returns nothing). Files: `store/genreRows.ts`, `shelves.ts`, `dynamic.ts`, `registry.ts`, `data/searchGenres.ts`.
- **Group 4 vocabulary:** WP3 term tables, "New release" from dates, "Reader favourite" attribution (design `docs/catalog-vocabulary.md`).
- **Group 5 admin:** WP4 "Everything we know" in Book Info, Task A steps 2/4/5 (one shared publish function, same-book rule), Task B merge duplicates (Nettle & Bone, Harry Potter), Task C sync simplification. Details in `docs/handoff-reference.md` sections 4-8.

## 2. Owner goals (plain words)
Three layers (owner's design, keep):
1. **Shared catalog** - works, editions, identifiers, approved metadata, cover decisions, curated discovery. Admin-owned.
2. **Personal sync** - one mechanism for all user-owned data across a user's signed-in devices. User-owned.
3. **Local-first cache/offline** - fast render, offline edits, pending queue. A cache, never a competing source of truth.
Principles: one owner per datum; no data lives only on a device; shared sync never overwrites personal data and vice-versa; no new services or dependencies without measured benefit; reuse working code; backup/restore stays a separate recovery feature.

**Goal 1 - catalog:** when the owner/admin publishes (Save to catalog, cover publish, background capture) EVERYTHING known is stored in the right DB columns/rows: ISBNs, ids, Work, Edition, author, aliases, year, pages, genre, cover candidates, etc. "Prize winner" is a category/shelf, not a genre; real genres go in `genres`. Same book / same author = one record; merge info, never delete.
**Goal 2 - personal sync:** simpler. Everything on iPhone equals iPad (same account, version, branch), live, no conflicts, no master device, cloud is the single copy. Covers: garden, nook look, arrangements, username, reading progress, reading now (Today/Library tabs), pages read counts, shelves, profile photo, settings.

## Reference (not needed every session)
`docs/handoff-reference.md`: what exists (sync + catalog publish code), live data facts and conflicts, Task A/B/C details, open issues, owner decisions D1-D8, older change log. Also: `docs/work-packages.md`, `docs/catalog-field-map.md`, `docs/catalog-live-schema.md`, `docs/catalog-vocabulary.md`, `docs/provider-terms.md`.

## Change log (latest; older ones in the reference file)
- 2026-10-30: S3 done: picker lists stored covers first; owner star publishes + force-syncs; conflicting ids kept as `alternateIds` notes; 932/932 tests, tsc, build. Read-only DB check of Hollow Bones / The Witch (no write).
- 2026-10-30: S2 done: one `knownCover` for cards, search, add-book and preload; cached covers paint in the first frame (layout effect); 929/929 tests, tsc, build. No DB change.
- 2026-10-30: S1 done: one catalog matcher for cover chain, Book Info and rejected covers (ISBN from `identity` now works; author aliases for covers); old raw cover index removed; 926/926 tests, tsc, build. No DB change.
- 2026-10-30: Owner approved the "one path" plan (S0-S4) and decisions (admin star also publishes; shared-covers KV migrates to Supabase; picker and `<>` stay). Docs only: `docs/cover-one-path-plan.md`; HANDOFF slimmed, reference moved to `docs/handoff-reference.md`. No code, no DB change.
- 2026-10-29: cleanup pass (covers/identity): dead helpers removed, ISBN check digit and isHttps merged. Parallel cover paths that remain are listed in the plan.
- 2026-10-29: C1: new builds keep Store lists/reset marks/shelf covers; IndexedDB safety copy; covers by title+author; rebuild from last good copy.
