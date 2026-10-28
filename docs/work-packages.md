# Work packages (grouped by shared files, to spend fewer tokens)

**Rules for every session:** do ONE package; read only the files listed; run the single test file while working (`npx tsx --test <file>`) and the full suite once at the end; finish with the PHASE-END ROUTINE in HANDOFF.md. Do not start a package without the owner's "go". Production writes, migrations and deploys need approval.

## Known facts (verified 2026-10-27)
- "Prize winner" shows as a genre because (1) 64 published/selected `genre` metadata values are honor or shelf names (works.genres has none; the Phase 3 backfill is fine) and (2) `store/curated.ts` sets each book's genre from its shelf (`genre: shelf.genre`). Suspected, not verified: admin capture (`rowsFor` in `capture.ts`) re-sends such a genre on reload; check `isKnownGenre('Prize winner')`.
- Slowness is not measured yet. The container cannot reach the providers, so timings must come from the owner's iPhone (WP2a).

## Recommended order: WP1 -> WP2a -> WP2b -> WP2c -> WP3 -> WP4 -> later
Why: WP1 is small and fixes visible bad data. WP2a tells us which slowness matters. WP3 (vocabulary) does not block anything and can wait.

### WP1 Genre hygiene (small)
Tasks: **D0** shelf/honor/tag labels never become `book.genre` or a genre candidate; the 64 published values corrected (un-select, never delete; keep as honors/candidates); apply the 4 approved mappings to the few existing works.
Files: `services/books/catalogFill.ts` (+test), `services/store/curated.ts`, `services/store/honors.ts`, `services/capture.ts` (rowsFor), `services/captureDevice.ts`, `services/catalog.ts` (meta genre), display in `components/BookMeta.tsx`, `components/tabs/LibraryTab.tsx`, `components/tabs/StoreTab.tsx`. Data fix needs approval.

### WP2 Startup, loading and shelves (owner's iPhone Home Screen findings)
Owner items: slow first Home load; Garden/Nook placeholders for minutes; Search, Genre search and Discover slow or "try again" (also Hidden gems); shelves take 5-10 min to refresh; descriptions/bios/ratings late although saved in Supabase; covers reload with placeholders after closing the app; catalog-first loading; Nettle & Bone author stale for hours; startup contention; failing shelves (Top Fiction, Top Non-Fiction, New in 2026, Goodreads Choice Awards); regression testing.
- **WP2a Startup timeline + priority (D1 + D4):** dev-mode log of every startup task (catalog sync, admin capture, covers, shelf refresh, Search/Discover) with ms, host and status; then a request scheduler: foreground (Search, Discover, opened book) beats background; background pauses while the user searches; retry with backoff. Owner does ONE cold start and pastes the log. Files: `App.tsx`, `services/capture.ts`, `services/books/infoQueue.ts`, `services/books/http.ts`, `services/books/perf.ts`, `services/store/refreshAll.ts`.
- **WP2b Catalog read path and caches (D2 + D3 + D6):** published catalog (works, covers, descriptions, bios, ratings, genres) shown before any provider request; resolved cover per work persisted so reopen shows no placeholders (check iOS storage eviction and the service worker); trace `catalog_changes` delta sync and work matching for the Nettle & Bone author lag. Files: `services/books/catalogCovers.ts`, `services/books/cache.ts`, `services/books/infoStore.ts`, `services/books/coverPicks.ts`, `services/books/placeholderCover.ts`, `services/changeProbe.ts`, `public/sw.js`, `services/catalog.ts`.
- **WP2c Shelves and Discover (D5):** inspect each failing shelf's source URL, timeout and fallback (Open Library slow? Goodreads Choice URL still valid?); keep last good data when a refresh fails; make Search/Discover failures retry and show cached results. Files: `services/store/refresh.ts`, `refreshAll.ts`, `shelves.ts`, `dynamic.ts`, `goodreadsChoice.ts` (test), `bestsellers.ts`, `wikiLists.ts`, `services/books/search.ts`, `components/tabs/SearchTab.tsx`, `components/tabs/StoreTab.tsx`.
- **WP2d Regression (D7):** user library/sync untouched, manual cover picks kept, offline/PWA works; run on this branch before any deploy. Test files across the above.

### WP3 Vocabulary tables (Phase 4): design in `docs/catalog-vocabulary.md`
Migration (`catalog_terms`, `catalog_term_aliases`, `catalog_work_terms`, `catalog_awards`, `catalog_work_awards`) + rollback + scratch check; seed from the mapping table; backfill existing candidates; keep `genres`/`honors` arrays as the derived read model. Files: `supabase/migrations/*`, `services/books/catalogFill.ts`, `services/catalog.ts`. Approval needed to apply.

### WP4 Admin "Everything we know" in Book Info (E1, then E2)
Read-only admin/developer view: work row, editions and all ids, genres/subgenres/subjects/keywords/collections/honors/tags, every candidate with source, status, selected flag and receipt, covers, content versions, ratings, provider receipts, audit notes. E1 can start now with what exists; E2 adds WP3 terms. Files: `components/AppleBookDetailModal.tsx`, `components/BookMeta.tsx`, `services/catalog.ts`.

### Later (unchanged plan)
WP5 people, name aliases, contributors (Phase 5). WP6 safe duplicate merge with audit, Nettle & Bone and Harry Potter first (Phase 6). WP7 series, structured awards, New Release in the UI (Phase 7). Task B personal sync (Reading now bug, simplify). Task C offline protection. Open Library `full` payload.
