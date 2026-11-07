# Provider terms and what we may keep (Phase 0, checked 2026-10-27)

Not legal advice. Sources are the providers' own developer pages; re-check before widening what is stored.

| Provider | What the terms say (verified) | Policy in `catalog_provider_records` (planned) |
|---|---|---|
| **Apple Books** (iTunes Search API) | Apple's Search API page: artwork and previews may be used only to promote store content; roughly 20 calls a minute; "large websites should set up caching". Nothing found that forbids keeping the response fields. | `trimmed`: keep the fields we extract, the track id, the store URL, the date fetched. Cache lookups (do not re-ask). Keep cover use as it is today (promotion of the book). |
| **Google Books** | Books API terms: no charging users, remove infringing content on request, privacy notice. The general Google APIs terms bar building databases or permanent copies of returned content unless the content owner or the law allows, and keeping caches longer than the cache header says. | `trimmed` at most: IDs, URL, bibliographic facts (publisher, date, pages, language, categories, ISBNs). **No full raw JSON.** Descriptions are the weakest point: the app already stores a 500-character Google blurb as a content version; flagged for the owner, unchanged in Phase 1. |
| **Open Library** | Developer page: cache responses, identify the app with a `User-Agent` (name + contact), do not harvest in bulk or make hundreds of single-book requests, use the monthly data dumps for bulk. Licensing page: the Internet Archive asserts no new rights over the database; some contributions may have their own rights issues. | `full` for the single records the owner looks up by hand. No crawling or backfill by API (use the dumps if ever needed). Browsers cannot set `User-Agent`, so the planned catalog capture should run from a script that does. |

Rules that follow:
1. A lookup result is stored once and reused; refresh only when it is old (about 90 days, "not found" about 14 days).
2. Never loop the providers over the whole catalog. The 779-book backfill uses what is already stored plus the owner's own lookups.
3. Keep source name, record id and URL beside every stored provider fact so a takedown request can be met by deleting exactly that source's rows.
4. The repo is public: no provider payloads, exports or private notes are committed.
