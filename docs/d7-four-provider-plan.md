# D7 - Four-provider audit and plan (verified 2026-11-09; PLAN ONLY, nothing built, nothing written to the database)

Providers: Open Library (OL), Google Books (GB), Apple Books (AB), Hardcover (HC). An outside (ChatGPT) audit was checked line by line against the live Supabase project (read-only SQL) and the code. Verdicts below.

## 1. What the outside audit got right (checked live)
| Claim | Live check |
|---|---|
| 639 provider records | apple 43 + google 119 + openlibrary 477 = 639. TRUE |
| Ratings: Apple 723, Google 341, OL 807, Hardcover 0 | TRUE |
| Covers 9,658; metadata candidates 6,242; works 2,818 (2,813 published); editions 593 | TRUE |
| Only 609 of 2,813 published works have genres (21.7%) | TRUE |
| Edition fills: ISBN-13 282, OL edition 382, Google volume 235, publisher 84, year 108, pages 69, language 111 | TRUE (all match) |
| Descriptions and biographies lose their provider: all 2,005 content versions have `source_name = 'app'` | TRUE (`source_record_id` and `source_url` columns exist and are unused) |
| The database cannot hold Hardcover | TRUE: `catalog_provider_records.provider` allows only apple/google/openlibrary; `catalog_rating_candidates.source_name` allows only apple_books/google_books/open_library |
| The Hardcover function returns id, slug, title, authors, rating, count, readers, year, cover, description, but the app only uses rating + count | TRUE (`functions/api/hardcover.js`, `sources/hardcover.ts`) |
| Hardcover search takes the 10 most-read title matches and filters author afterwards, so an author's book outside the top 10 is missed | TRUE (`limit: 10`, `order_by users_read_count desc`) |
| Hidden Gems can stay at 1-2 books: a shared list is shown as soon as 1 book qualifies, and the extra rating lookup only runs when 0 qualify | TRUE (`genreRows.ts`: `showable` needs >= 1 for gems; richer ratings only `if (!books)`) |
| New Releases comes from the same 40-book pool (needs 3, current/previous year, cover) | TRUE (`MIN_ROW = 3`) |
| Travel pool has 12 books (below the 20-book Fill gate); `v4|travel` = 12 | TRUE (it was written before the gate existed, Nov 7) |
| "Women in their 30s" searches `women's fiction`, a separate list | TRUE (searchGenres.ts line 44) |

## 2. What it got wrong, overstated or could not know
- It says no new tables are needed: right, but it missed that the two naming styles differ (`openlibrary` in provider records vs `open_library` in ratings, `apple_books` vs `apple`). A new Hardcover value must be added to BOTH checks with the spelling each table uses (`hardcover` / `hardcover`), and the cover-candidate and metadata tables must be checked for their own checks (none found on `source_name` there).
- "All 38 pools fetched Nov 5-7, still within 7 days": TRUE today, but they EXPIRE on Nov 12-14. After that the app builds them live again (and shows the last good list). Nothing is wrong, but the owner should know the audit of "what is saved" is a snapshot.
- Its genre grades are qualitative reading of titles; the shared rows hold only slim title/author/genre/rating, so it could not see WHY a book was admitted. Treat the grades as a pointer, not a measurement. Two examples it lists (Fantasy v3 holding 1984-style titles) are in the v3 row, which is the one the app reads for Fantasy.
- Hardcover "terms" (storing ratings/covers/descriptions, attribution) were NOT verified by the audit (it says so itself) and `docs/provider-terms.md` has NO Hardcover section yet. The owner must read Hardcover's current terms before we store anything beyond the rating.
- Hardcover field names are unverified against a live call (the container cannot reach it); the first real check is `/api/hardcover?op=books&q=dune` on the preview address.
- It treats Apple as incomplete "coverage"; true: 43 provider records and 1,582 cover candidates, but Apple genre labels exist only for those 43.

## 3. Plan (each step small, tests first, owner "go" where marked)
1. **Owner decisions (before code):** (a) read Hardcover's terms and say what we may store (rating+count only, or also id/slug/year/cover URL/description link); (b) confirm the Google and Open Library storage rules in `docs/provider-terms.md` (Google: no long-term copies of text unless allowed; OL: not a bulk backend) so capture stores IDs, links, ratings and short facts, not whole descriptions, where terms forbid it.
2. **Migration [needs go]:** `supabase/migrations/<date>_catalog_hardcover.sql` (+ rollback + scratch check): add `'hardcover'` to the two CHECK constraints above. No new tables.
3. **App, Hardcover capture:** save one provider record per matched book (id, slug, year, readers, rating + count, cover URL, description link if terms allow) and a rating candidate (`source_name = 'hardcover'`); label stays "Hardcover" in the UI; keep ratings per provider, never one blended score.
4. **Hardcover search fix:** add an author condition in the GraphQL query (after the field names are verified live) so an author's book outside the top 10 by readers is still found; keep one fixed query, variables only.
5. **Provenance for new writes:** content versions and metadata the app saves from a provider get that provider as `source_name` plus `source_record_id`/`source_url`. Existing 2,005 `app` rows are NOT guessed back to a provider (not reliably known); they stay `app`.
6. **Edition completeness:** copy publisher, pages, year, language that each provider returned into the edition/provider facts (OL page count and year are kept only as generic app metadata today). Fill-only, never overwrite.
7. **Genre provenance:** the 1,090 generic `genre` candidates have no receipt; mark how each was derived before any classification. (Classification and shelf fixes are a LATER task, owner said no shelf work now.)
8. **Tests + HANDOFF:** pure-rule tests for each step, one change-log line per step.

Out of scope now (owner: shelves later): refilling genre shelves, classifying the 2,813 works, New Releases feed, Hidden Gems widening.
