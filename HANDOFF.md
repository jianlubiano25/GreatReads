# GreatReads - HANDOFF (read ONLY this file; open a linked doc only for the group you work on)

## START HERE
- Branch `claude/best-of-vscode-catalog-ids` only. Never main; no merge, deploy or force-push. Plain words (owner is not a coder, may hit quota any time: push after each finished step).
- **CURRENT GROUP: A - Covers & catalog read path.** Do tasks A1 -> A4 (A5 needs a device). Other groups B-F below are full tasks too: start one only when it is next or the owner points at it.
- Recently done (do NOT redo): one-path covers S1-S3, merge guard, merges M1-M4a + HP fix, cache policy (DATA_EPOCH), owner order 1-8 (Open Library gate, last-good lists, Hidden-gems rating fallback, one placeholder, fresh diagnostics, shared discovery cache LIVE, version string). Nothing is device-tested yet.
- Owner actions waiting: (1) check the Google Cloud quota of the browser key (Google answers 429 at once) or use the server key; (2) after using the app, Profile > Copy diagnostics and paste it; (3) device checks: no placeholder after hours closed, Hidden gems, Fantasy has Game of Thrones; (4) optional: Supabase leaked-password protection toggle.
- Token saving: read only the files your group lists; run one test file (`npx tsx --test <file>`) while working, the full suite once at the end.

## Rules (stay)
- DB writes, migrations, backfills, merges, deploys need the owner's explicit "go" in chat. No new dependencies without asking. Never delete catalog data (archive; deletes cascade). Never overwrite local/personal data; fill-only; keep provenance; conflicts are listed, not resolved. Respect `docs/provider-terms.md`. Repo is public: never commit exports, provider payloads or private notes.
- Supabase (`amvkwwqcepmxxkfeqjox`, "GreatReads"; ignore Kipr projects) is the shared source of truth; the device catalog is a cache; personal data and personal cover picks stay separate. Container cannot reach the providers (timings come from the owner's device).
- Every commit: update this file (rewrite START HERE if the group changed, tick tasks, add ONE change-log line, keep < ~100 lines). **Raise `BUILD_NUMBER` (root file) by 1 on every push.** Commit ends: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` + `Claude-Session: <url>`.
- PHASE-END ROUTINE: run `npm test`, `npx tsc --noEmit`, `npm run build` (never claim an unrun check passed), update this file, commit, `git push origin HEAD:claude/best-of-vscode-catalog-ids` (pre-approved; no token needed through the proxy; if asked, the owner pastes one: use only for the push, never save it).
- New task? Add it to the group whose files it shares. New session: `git clone -b claude/best-of-vscode-catalog-ids https://github.com/jianlubiano25/GreatReads.git`, `npm ci`, read this file, run the 3 checks.

## GROUP A - Covers & catalog read path (CURRENT)
Files: `services/books/{catalogCovers,bookView,coverPicks,coverLookup,covers,coverAnalysis,infoStore,cache,placeholderCover}.ts`, `components/{BookMeta,CoverPickerModal}.tsx`, `services/catalog.ts`, `services/changeProbe.ts`, `public/sw.js`, `functions/api/{covers,cover-img}.js`. Plan: `docs/cover-one-path-plan.md`.
- A1 **S4 shared-covers list -> Supabase** (old Cloudflare KV `/api/covers`, `readlife.sharedCovers1`): (a) read-only report KV vs catalog covers (container cannot reach KV: export via admin API/dev button); (b) import the differences as catalog cover candidates [needs go]; (c) switch readers to the catalog; (d) remove KV [needs go]. Picker and admin `<>` must keep working.
- A2 **Placeholders on reopen** (steps 1-2 + B3 DONE 2026-11-01, not device-tested): one stand-in look, remembered covers eager + grace, preload2, saved-data budget handling, Apple gate. NEXT: owner log after a reopen: read `storage` (biggest keys, `storage.writeFailed/evicted`) and `resolve.cacheHit` vs `resolve.network`; if `resolved3` is the biggest, slim its entries (summary/bio/subjects) in `books/resolve.ts`; still open: service-worker image cache (`sw.js`, `cover-img.js`).
- A3 **Catalog first:** published catalog (covers, descriptions, bios, ratings, genres) shown before any provider request; trace `catalog_changes` delta sync + work matching for the Nettle & Bone author that stayed stale for hours.
- A4 **Owner star wait** (~1-2 min on iPhone, same device): measure; S3 made the star publish + force-sync, find which step is slow.
- A5 Grey "?" picture seen on a cover: maybe a provider's own "image not available" image; detect in `coverAnalysis`/`vet` (needs the cover URL from the owner).

## GROUP B - Startup, requests & providers
Files: `App.tsx`, `services/capture.ts`, `services/books/{infoQueue,http,perf,hostGate}.ts`, `services/books/sources/{googleBooks,openLibrary,appleBooks,appleCharts}.ts`, `services/refreshApp.ts`, `services/store/sharedDiscovery.ts`, `hooks/useReadingLife.ts`.
- B1 **Request scheduler** (WP2a): foreground (Search, Discover, opened book) before background; background pauses while the user searches; back-off. Use the next cold-start diagnostics (milestones, per-host times).
- B2 **Google key quota:** browser key gets 429 on its first request, the gate then refuses ~250 (by design). Owner checks quota, or switch to the server route (`/api/google-books`, Cloudflare secret `GOOGLE_BOOKS_API_KEY`).
- B3 ~~iTunes gate~~ DONE 2026-11-01 (see change log); check `apple.gateRefused/gateTripped` and the 403 count in the next log.
- B4 **Storage writes** (~9 MB in 5 min: `authorAliases2` 0.9 MB x11, `resolved3` 4.4 MB x11, `bookinfo1`, `coverFlat1`): fewer, lighter saves.
- B6 **Splash screen** (owner idea, build later): dark background, the GreatReads logo in the middle that fades in with a small bounce, "GreatReads" in a serif font below; responsive (phone, iPad, desktop). Shown while the app loads books, Discover, Search, Library, Nook (first-time setup, a new user, after Refresh App & Data) so loading feels seamless; leaves as soon as the first screen is ready (never longer than needed), respects reduced-motion. Files: `index.html` (shown before React), `main.tsx`, `App.tsx`, `index.css`.
- B7 **Saved-data budget (owner log 9:20 PM): `readlife.catalog1` is 1.31 MB of 2.70 MB total (49%)**, then `curated3` 0.33 MB, `captured1` 0.21 MB, `providerfacts1` 0.18 MB. `storage.writeFailed` 41 (genrepool1 17, resolved3 9, authorAliases2 7, seen1 7): caches cannot save. Slim or move `catalog1` (device copy of the Supabase catalog; keep only what a card needs) and trim `captured1`/`providerfacts1`; consider IndexedDB for the big ones. Files: `services/catalog.ts`, `services/capture.ts`, `services/providerFacts.ts`, `books/cache.ts`.
- B5 **Check the shared discovery cache** (`discovery_cache`, live, empty): after an admin device browses genres, diagnostics show `shared.written`; a second device `shared.hit`. Searches are shared only from admin devices.

## GROUP C - Shelves, search & Discover
Files: `services/store/{refresh,refreshAll,shelves,dynamic,goodreadsChoice,bestsellers,wikiLists,genreRows,curated}.ts`, `services/books/{search,genreRank}.ts`, `hooks/useBookSearch.ts`, `components/{BookSearch,tabs/SearchTab,tabs/StoreTab}.tsx`, `data/searchGenres.ts`.
- C1 **Failing shelves** (WP2c): Top Fiction, Top Non-Fiction, New in 2026, Goodreads Choice Awards: check each source URL, timeout, fallback; keep last good data on failure; retry and show cached.
- C2 **Fantasy ranking:** Game of Thrones missing in Fantasy; "Did you mean hurry potter?" with no results seen once (latest log: 39 results, fine).
- C6 **Search by audience/theme** (owner): "women in their thirties" returns 1 book. Wanted: novels and books about or for women in their 30s and older (midlife, friendship, motherhood, reinvention, women's fiction). Add phrase -> search-terms/genre mapping in `books/keywords.ts` + `data/searchGenres.ts`, ranking in `genreRank.ts`; test with golden queries.
- C7 **More Hidden Gems per genre** (Fantasy shows only a few): gem rule is average >= 4.1, 40-5000 ratings; Open Library counts are small and the pool is 40 books. Deepen the gem pool (a second, rating-sorted search per genre, more pages) and keep the rule. Files: `store/genreRows.ts`, `books/search.ts`, `data/searchGenres.ts`.
- C3 **Classics / H1:** latest log gives 40-100 Classics results; confirm on device, then close the open part.
- C4 **Search slower than Jldata2** (unmeasured): compare `useBookSearch.ts`, `BookSearch.tsx`, `search.ts`, `cache.ts`; keep genre picks and Hidden Gems.
- C5 **Regression before any deploy** (WP2d): library/sync untouched, manual cover picks kept, offline/PWA works.

## GROUP D - Catalog data & admin publish
Files: `services/{catalog,capture,captureDevice}.ts`, `services/books/{catalogIdentity,catalogFill}.ts`, `services/store/honors.ts`, `components/{AppleBookDetailModal,CatalogReviewModal,CoverPublishModal}.tsx`, `supabase/{migrations,backfills,rollbacks}`. Details: `docs/handoff-reference.md` sections 6, 9; `docs/catalog-merge-preview-2026-10-30.md`.
- D1 **One shared publish function** (Task A 2/4/5): used by Save to catalog, cover publish and background capture; idempotent, fill-only; same-book rule: exact ids (olWork, ISBN, OL edition, Google volume), then `work_key`, then author alias; uncertain = listed; pure-rule tests.
- D2 **"Everything we know"** in Book Info (WP4): read-only admin view: work, editions and ids, candidates with source/status/receipt, covers, content, ratings, provider receipts, audit notes.
- D3 **Literature-guide guard:** `OL31306243W` is a Scholastic guide, not the novel; a device still holding it can write it back onto HP Sorcerer's Stone (`e3f8a77e`). Make the app refuse it; optional own draft Work for the guide [needs go].
- D4 **HP US/UK merge** (`be350d24` Philosopher's with `e3f8a77e` Sorcerer's): only with edition evidence (own ISBN, publisher, pages) from a source other than more manual Open Library searches; result = one Work, two Editions [needs go].
- D5 **Missing facts:** Nettle & Bone page count 220 vs 320 (needs a source); Apple ISBN `9781250244031` not stored; source-backed metadata repair [needs go]. Devices keep cached duplicates until Refresh App & Data (a server tombstone + app change would need go).
- D6 Optional: keep provider payloads in `catalog_source_records` (owner decision D7 in the reference) [migration needs go].

## GROUP E - Vocabulary, people & awards
Files: `docs/catalog-vocabulary.md`, `supabase/migrations` (new), `services/books/catalogFill.ts`, `services/store/{honors,curated}.ts`, `services/catalog.ts` (read model).
- E1 **Term tables** (WP3): `catalog_terms`, `catalog_term_aliases`, `catalog_work_terms`, `catalog_awards`, `catalog_work_awards` + rollback + scratch check; seed from the mapping table; backfill candidates; `genres`/`honors` arrays stay the read model [migration needs go].
- E2 **"New release"** = tag derived from publication dates; **"Reader favourite"** = honor attributed to its reader/curator/source when known (owner rules); tags column `tags text[]` (owner decision D8).
- E3 **People, name aliases, contributors** (WP5). E4 **Series, structured awards, New Release in the UI** (WP7).

## GROUP F - Personal sync (Task C)
Files: `services/{supabase,changeProbe,linkHealth,syncStatus}.ts`, `services/sync*.ts`, `hooks/useReadingLife.ts`, `components/SyncStatusSection.tsx`. Details: `docs/handoff-reference.md` section 6 (Task C), 7.
- F1 Read-only audit -> `docs/sync-simplification-audit.md` (per sync file: purpose, dependants, remove/merge candidates, risk, test coverage). F2 Coverage check per Goal 2 item (cover picks, hidden books, profile photo still sit in the shared `user_library_preferences` JSON).
- F3 Owner approves specific simplifications, then small steps with two-device simulation tests (offline edit, delete, same-item change, interrupted sync, account switch); owner tests iPhone + iPad. Open decision: per-item edit time vs server time (recommend edit time).
- F4 "Reading now" did not update on the 2nd device (check `user_library_books` status sync + pull after a realtime event). F5 No fake-Supabase test for `syncSettingsRecords`; nook look may flip-flop.

## Owner goals (short)
Layers: (1) shared catalog, admin-owned; (2) personal sync, one mechanism, cloud is the single copy, every device equal; (3) local-first cache, never a competing source. Publishing stores EVERYTHING known in the right rows; same book + same author = one Work; "Prize winner" is a honor/shelf, not a genre. Owner always uses a 12-hour clock.

## Reference docs (open only when needed)
`docs/handoff-reference.md` (what exists, live data facts, Task A/B/C, merge status, M4b evidence), `docs/full-change-log.md` (all older log entries), `docs/work-packages.md`, `docs/cover-one-path-plan.md`, `docs/catalog-field-map.md`, `docs/catalog-live-schema.md`, `docs/catalog-vocabulary.md`, `docs/provider-terms.md`, `docs/catalog-merge-preview-2026-10-30.md`.

## Change log (last 8; older in docs/full-change-log.md)
- 2026-11-01: **FIX Hidden Gems empty after the last update** (my bug in order 6): Open Library hits carry no `ratingSource`, so `slimBooks` dropped EVERY rating from the shared lists, and every device read those rating-less lists first. Now the site is worked out (`source`/`ol_` id), shared rows are versioned (`v2|` key: old rows ignored), and a shared list with no rating is not trusted. Test in `shared-discovery.test.ts`.
- 2026-11-01: B3 (owner log: iTunes 2230 requests in 30 min, 899 x 403 + 641 lost, so covers/ratings never came): `appleGate` in `sources/appleBooks.ts` (requests 2.8 s apart = Apple's ~20/min, 403/429 or 3 lost in a row close it 30 s/60 s/2 min/5 min, extra background lookups refused at once); a 403 is now a FAILURE, no longer remembered as "Apple has none". Test `apple-gate.test.ts`. Not device-tested.
- 2026-11-01: A2 step 2 (saved-data budget; owner log: 233 MB written in 30 min, caches ~2.2M chars of a 2.5-5M budget): diagnostics `storage` (total + biggest keys) and `storage.writeFailed/evicted/cacheTrimmed` counters; a failed cache save keeps the newest half and retries; big caches write every 2.5 s not 0.4 s; storage-full now frees ONE key at a time (biggest non-cover first, cover memory last) instead of wiping every cache (`freeSpaceThenRun`). Next: read `storage` in the next log; slim `resolved3` entries if it is the biggest.
- 2026-11-01: A2 step 1: ONE stand-in look (`coverBackdrop`: the box behind every cover has the stand-in colour, no spine-colour/grey); remembered covers are eager at once + 250 ms grace before the stand-in draws; `readlife.preload2` (80 most recently shown covers) preloaded by index.html. Not device-tested.
- 2026-11-01: `discovery_cache` migration APPLIED (owner Go; RLS on, admin write, 0 rows); rollback `supabase/rollbacks/20261101000001_discovery_cache.rollback.sql`. Device log: searches 1.0-1.8 s, Open Library 52 req/23 s, first shelf 11 s, Google key quota empty.
- 2026-11-01: order 6: shared discovery cache code (`store/sharedDiscovery.ts`: slim books, no Google data, admin writes, never empty/thinner, skipped if table missing).
- 2026-11-01: orders 7+8: version `GreatReads 0.1.<build>.<sha>.<branch>` (bovci/jl2/main), `BUILD_NUMBER` counter, in Profile, Sync status, diagnostics.
- 2026-11-01: order 5: Copy diagnostics is a fresh reading each tap (own 12-hour time, app-open minutes).
