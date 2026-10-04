# My Reading Life (GreatReads)

Reading companion: daily page goal and streak, reading nook, library, book store, Word Garden and on-device shelf.
React + Vite + Tailwind. Reading data stays in the browser (use Backup to keep copies).

    npm install
    npm run dev          # local
    npm run build        # production build into dist/
    npm run lint         # type check
    npm test             # garden rules (plants earned / taken back / never celebrated twice)
    npm run prefetch:store -- --max-minutes=10   # optional: pre-fill store covers/ratings (needs internet)

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
