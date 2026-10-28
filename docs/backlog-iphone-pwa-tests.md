# Backlog D/E: findings from the iPhone Home Screen (Safari PWA) tests, 2026-10-27

Owner asked to ARRANGE these only (saves tokens); start when the owner says so. Nothing here is started. Do not start a task without "go" in chat; each ends with the PHASE-END ROUTINE in HANDOFF.md; production writes, migrations and deploys need approval.

## What is already known (verified 2026-10-27)
- **Prize winner as a genre has two causes outside the Phase 3 backfill:** (1) 64 *selected/published* `genre` metadata values in the database are shelf or honor names (works.genres has 0 of them, so the backfill is fine); the app displays the published metadata value. (2) `store/curated.ts` sets each book's genre to its shelf's genre (`genre: shelf.genre`), so Store books on a "Prize winner" shelf carry it. Suspected, NOT verified: the admin capture backfill (`rowsFor` in `capture.ts`) re-sends such a genre candidate on reload, which would "put it back"; check `isKnownGenre('Prize winner')` first.
- Cover/shelf/info slowness is not yet measured. The container cannot reach the providers, so timings must come from the owner's phone (see D1).

## Order I recommend (small and safe first, diagnose before fixing)
| # | Task | Covers owner items | Type | Needs |
|---|---|---|---|---|
| D0 | **Honor/shelf names out of genres.** Client: a shelf/honor/tag label never becomes `book.genre` (use `classifyLabel`); capture never re-sends it. Data: for the 64 published rows, un-select (do not delete) honor-like values and keep them as candidates/honors; check LibraryTab/StoreTab/BookMeta display. | "Prize Winner shown as a genre", shelves | code + tests, then a small data fix | approval for the data fix |
| D1 | **Startup timeline (diagnosis, no behaviour change).** Dev-mode log of every startup task with start/end/ms: catalog sync, admin backfill/capture, cover resolution, shelf refresh, Search/Discover calls, provider host and status. Owner does ONE cold start on the iPhone and copies the log into chat. | startup contention, slow home, slow shelves, Discover "try again" | code + tests | one iPhone cold-start log |
| D2 | **Covers survive close/reopen.** Find where cover URLs/images are cached (localStorage, Cache API, service worker) and why placeholders return (iOS evicts PWA storage; image cache keyed by a changing URL?). Persist resolved cover URL per work and show it before any network. | placeholders after reopen, Garden Nook covers | code + tests | D1 helps |
| D3 | **Catalog-first loading.** Published catalog data (works, covers, descriptions, bios, ratings, genres) is fetched and shown before any provider request; providers only fill gaps in the background, with timeouts and a concurrency limit, and never block Home/Search/Discover. | slow home, slow book info, catalog-first, slow descriptions/bios/ratings | code + tests | D1 |
| D4 | **Request priority and cancellation.** Foreground (Search, Discover, opened book) beats background (capture, shelf refresh, covers); pause background while the user searches; retry-with-backoff instead of "try again". | Discover/Search failing, contention | code + tests | D1, D3 |
| D5 | **Shelves that fail** (Top Fiction, Top Non-Fiction, New in 2026, Goodreads Choice Awards). Inspect each shelf's source URL, timeout and fallback; show last good data when a refresh fails; check whether the Goodreads URL still returns data; make 5-10 minute refresh lag visible and fix its cause. | shelf refresh, failing shelves | investigation first, then code + tests | D1 |
| D6 | **Author/title change not showing for hours** (Nettle & Bone: Ursula Vernon -> T. Kingfisher). Trace `catalog_changes` delta sync, work matching (title|author key) and when the UI re-reads the catalog. | delayed refresh, record matching | investigation + code + tests | D3 |
| D7 | **Regression suite for D0-D6**: user library/sync untouched, manual cover picks kept, offline/PWA still works, tests on this branch before any deploy. | regression testing | tests | each step |

**When it is best to start:** D0 any time (small). D1 next, because it tells us which of D2-D6 matter most; it needs only one cold-start log from the phone. Do D2-D6 after D1, in the table order. Phase 4 (term tables) does not block any of these and can wait.

## Also queued (owner requests)
- **E1 "Everything we know" in Book Info (admin/developer mode, read-only):** work row, editions and all ids, genres/honors/tags, every candidate with source, status, selected flag and receipt, covers with status, content versions, ratings, provider receipts, audit notes. Can start now with what exists; E2 adds the Phase 4 terms.
- **Phase 4 addition:** subgenres and subject/theme/keyword terms. `catalog_terms.kind` = genre, subgenre (parent = a genre), subject, theme, keyword, collection, tag; the stored unmapped labels (Dystopian, Satire, Myth, Epistolary, Creativity, ...) become subject candidates there. "Translated" goes to edition/contributor data.
