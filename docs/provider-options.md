# Provider options and the "Goodreads speed" plan (2026-11-02)

Not legal advice. Re-check each provider's terms before storing more of its data (see provider-terms.md).

## What we use now
- Apple Books (iTunes Search): fast, flat modern covers, ratings; ~20 calls/min, gate in `appleBooks.ts`.
- Google Books: ratings, descriptions, covers; the browser key answers 429 at once (quota empty), so it is mostly unusable until fixed.
- Open Library: subjects, popularity, works; free, slow (1-6 s, many 6.5 s timeouts in the owner's logs), ~100 calls/5 min/IP; monthly data dumps exist for bulk use.
- NYT Books API (via our /api/nyt function): official lists only, ~5 calls/min for the whole site.
- Wikipedia/Wikidata: author facts, prizes.

## Other providers worth testing (none added yet; each needs the owner's OK)
- Hardcover (GraphQL, built for Goodreads-style data: ratings, lists, readers, good search). Free API with a token and rate limit; check terms for caching; would be a server-side (Cloudflare function) call, never a key in the app.
- ISBNdb (paid, large ISBN/price/cover catalog), Bookcover/Amazon-style cover APIs (terms limited), Internet Archive (full-text and out-of-print), Gutendex/Project Gutenberg (public-domain classics, free), Library of Congress / WorldCat / HathiTrust (metadata, slow), Wikidata (works, awards, genres, cheap).
- No free API offers Goodreads-scale ratings: Goodreads closed its public API in Dec 2020 and nothing replaced it.

## Why Goodreads feels fast
Goodreads does not call other sites when you search. It owns the catalog (tens of millions of books, ratings, covers on its own CDN) in its own search index, close to the user, with results and covers cached. GreatReads asks Apple, Google and Open Library live from the phone, each with its own limit and delay.

## How GreatReads gets close (in order of payoff)
1. Our own copy first: the Supabase tables (`discovery_cache` for genre lists/searches, the published catalog for books and covers) are read before any live site. A page built from our rows takes one fast request. Populate them completely (all genres, popular searches) with the admin account.
2. Pre-build on a server, not in each phone: a scheduled job (owner go needed) fills genre pools, searches and cover choices once a day from Open Library dumps + Apple + Hardcover; phones only read.
3. Covers: paint the fastest available picture at once, then swap in the best (starred > admin > Apple > other modern) when it loads. Cover picks live in the catalog so every device agrees.
4. Search: query our own table first (title/author/ISBN with a text index), show it instantly, then top up from live sources in the background.
5. Reliability: one gate per site (done: Open Library, Apple, Google), last-good lists kept (done).
