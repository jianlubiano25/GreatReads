# My Reading Life (GreatReads)

Reading companion: daily page goal and streak, reading nook, library, book store, Word Garden and on-device shelf.
React + Vite + Tailwind. Reading data stays in the browser (use Backup to keep copies).

    npm install
    npm run dev          # local
    npm run build        # production build into dist/
    npm run lint         # type check
    npm test             # garden rules (plants earned / taken back / never celebrated twice)
    npm run prefetch:store -- --max-minutes=10   # optional: pre-fill store covers/ratings (needs internet)
    npm run check:shelves                        # live check: what each self-refreshing Store shelf's source returns right now
    NYT_API_KEY=... npm run check:nyt            # live check: are the NYT list names the Store uses real NYT list names (names.json)

Deploy (free): Cloudflare Pages. Build command `npm run build`, output directory `dist`, Node 22 (`.node-version`).
Headers are in `public/_headers`. Pages serves index.html for unknown paths by itself, so no redirect file is needed.
`npm start` (server.js) is only used by AI Studio / Cloud Run.

## How the "new version" prompt works
Each build gets an id that is a hash of the source files. The app only shows "New version ready" when a downloaded
update has a different id than the one running. Redeploying unchanged code never prompts. Settings > App Updates
shows the version and has "Check for updates".

## Garden rules (src/services/garden.ts)
- Plants come from milestones in `src/data/gardenCatalog.ts` (add a plant + a milestone, nothing else changes).
- Reading-log progress (best streak, 10+ page days, biggest day, best week, total pages) is worked out from the pages you logged.
  A streak that ended still counts, but correcting a wrongly typed page count takes the plants and growth it earned back.
- Books finished, highlights and words are high-water marks: removing a word never takes a plant away.
- The "Congratulations" prompt shows once per new plant. Restoring a backup never shows prompts.
- The nook shelf shows books from your Library (reading now, finished, up next, then the rest) that have a cover.

## Store shelves: which refresh themselves
Code: `src/services/store/dynamic.ts` (schedule + sources), `wikiLists.ts` (reads Wikipedia list tables), `bestsellers.ts` (NYT).
A shelf's hand-picked list in `src/data/storeSeeds.json` is always the floor. Fresh lists go through the same resolver, identity
and cache pipeline as any shelf. A failed or too-short refresh changes nothing (the last saved list stays; retry after 1 hour).
Nothing generated is presented as an official ranking.

| Shelf | Source | Refreshes |
|---|---|---|
| Trending Today | GreatReads blend of Open Library trending, Apple Books charts, NYT, ratings (collate.ts); labelled as GreatReads' own | every 6 h |
| Top 15 Fiction / Non-fiction | NYT combined print + e-book lists (official); GreatReads-collated stand-in, labelled, if the NYT is down | every 6 h (NYT publishes weekly) |
| NYT Young Adult, Paperback Fiction, Paperback Non-Fiction, Advice & How-To | NYT lists, official only (hide themselves if unavailable); top 10 | every 6 h |
| New in <year> | Open Library: books first published this year, by reader activity; heading follows the calendar year | weekly |
| Oprah's Book Club | Wikipedia list of picks, newest first, each labelled with its own date | every 3 days |
| Women's Prize, International Booker | Wikipedia winners tables | weekly |
| Romance, Mystery, Sci-fi, Self-help, Fantasy, Memoir, Historical | Open Library: recent (last 5 years), widely read, one book per author, explicit / study guides left out; 4 hand-picked staples stay at the end | monthly |
| Service95, Reese's, Inklings (both), Top Fiction / Non-fiction, Classics | hand-picked: no reliable public machine-readable source has been found or verified (Classics are evergreen); covers and ratings still re-resolve | edit `storeSeeds.json` |

NYT quota: lists are cached 6 h in the browser and at Cloudflare's edge (`functions/api/nyt.js`), and extra lists only load when scrolled into view.
Wikipedia lists are cached 12 h by the service worker (`public/sw.js`). To change a source or schedule, edit its entry in `DYNAMIC_SPECS`.

### Book clubs: where each stands
- **Oprah**: dynamic from Wikipedia's list of picks. This is a *fallback*, not Oprah's own list, and Customize Store says so. An official
  Oprah Daily feed was not found or verified (its pages were not reachable from the build sandbox), so no scraper was written for it.
- **Service95, Reese's, Inklings (Jack Edwards)**: hand-picked. No official feed or structured public source has been verified, and
  scraping a club's marketing page without being able to check its markup would risk replacing good data with junk. If you find a
  source, add an entry to `DYNAMIC_SPECS` (it needs a `fetch`, `refreshMs`, `minSeeds`, `kind`) and everything else (caching, refresh,
  Customize Store) works without further changes. Run `npm run check:shelves` to see what it returns.

## Customize Store
The sliders icon in the footer (Store tab only, next to Backup and Refresh) opens Customize Store.
- Drag the grip (or focus it and use the arrow keys) to reorder shelves; the eye hides or shows a shelf; **Done** exits. Hidden shelves
  stay in the list and load nothing. **Reset layout** restores the default order.
- Layout is saved on the device in `readlife.storeprefs1` (`{ order, hidden }`, `services/store/prefs.ts`). It is separate from shelf
  data (books, caches, refresh times) in both directions: moving or hiding never edits a shelf, and a scheduled or manual refresh never
  edits the layout. Shelves added by a later update appear in their default place. "Reset Everything" also clears it.
- Each row shows the shelf's **last successful update**, its automatic schedule, and where its books come from (official, public-record
  stand-in, GreatReads discovery, or hand-picked). A failed refresh never moves the time.
- The refresh button refreshes only that shelf, through the shelf source's own `refresh()` (the same code as the schedule), via
  `manualRefresh()` in `services/store/refresh.ts`: 10 minutes between manual refreshes after a success, 2 after a failure, and taps
  during a refresh share it. On failure the saved list stays. There is no "Refresh all": it would fire ~25 requests at once for little gain.
