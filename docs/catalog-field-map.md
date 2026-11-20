# Catalog field map (Task A step 1) - checked 2026-10-27, read-only

Where each piece of book data goes in the catalog DB. "Today" = what Save to catalog / cover publish / background capture write now.

## Work-level (table `catalog_works`)
| Data | DB destination | Today | Plan |
|---|---|---|---|
| title, author, `work_key` | `canonical_title`, `canonical_author`, `work_key` | saved | keep |
| other titles (English / original / US-UK) | `aliases[]` | NOT saved | save (`originalTitle`, OL alternative titles) |
| other author names (Vernon = Kingfisher, J.K. = J. K.) | `author_aliases[]` | NOT saved (only set by hand) | save (OL `author_alternative_name`, jacket names) |
| language | `language_code` | NOT saved | save |
| Open Library work id and other ids | `identifiers` (jsonb) | olWork saved | add other ids that are known |
| real genres (Fiction, Mystery, Fantasy...) | `genres[]` | NOT saved: **empty on all 779 works**; genre only exists as `genre` metadata candidates | fill from clean genre values |
| honors & awards, book-club picks (Prize winner, Reese's, Oprah's, Service95, The Inklings, Women's Prize 2021...) | **new column `honors text[]`** (proposed, not applied) | NOT saved anywhere in the DB: only the device cache `readlife.honors1` + `Book.awardLabel` | save |
| first publication year | metadata candidate `year` | saved (candidate only) | keep + also on Edition `publication_year` |
| pages | metadata candidate `pageCount` | saved (candidate only) | keep + Edition `page_count` (page counts differ by edition) |
| description, author bio | `catalog_content_versions` | saved | keep |
| ratings, one row per site | `catalog_rating_candidates` | saved | keep |
| cover | `catalog_cover_candidates` + `main_cover_candidate_id` | cover publish only | save every cover found as a candidate with its source |

## Edition-level (table `catalog_editions`)
| Data | DB column | Today |
|---|---|---|
| ISBN-10 / ISBN-13 | `isbn10`, `isbn13` | saved (validated) |
| Open Library edition id, Google volume id | `openlibrary_edition_id`, `google_volume_id` | saved |
| publisher, publication date/year, pages, format, language | `publisher`, `publication_date`, `publication_year`, `page_count`, `format`, `language_code` | NOT saved |
| where it came from | `source_name`, `source_url` | `app` only |

## What devices receive (`catalog_work_json`, verified)
id, key, title, author, aliases, authorAliases, genres, language, identifiers, updatedAt, main cover, selected content, selected metadata (field/value/edition/source), selected ratings, editions (id, isbn10/13, publisher, year, pages, language), rejected covers. The client type (`CatalogWork`, `catalogCovers.ts`) already reads genres, aliases, authorAliases, identifiers, editions. **Not sent yet: honors.** New column + one extra key in `catalog_work_json` is needed (additive, old app versions ignore it).

## Why shelf names end up as genres (root cause)
`src/services/store/curated.ts` (~line 161) sets `genre: shelf.genre` on every book of a curated shelf, so a book on the Reese's shelf gets genre "Reese's Book Club". `awardLabel` (e.g. "Oprah's Book Club - Mar 2026") feeds the app's own "Honors & Awards" list (`store/honors.ts`: prize = trophy, shortlist = medal, club pick = book) but is never published.

## What the genre values look like today (301 `genre` candidates)
- Real genres: Fiction 46, Self-help 26, Mystery 20, Non-fiction 18, Fantasy 13, Romance 9, Memoir 9, Graphic Novels 8, Science fiction 6, Classic 6, Biography, Horror, Historical fiction, Philosophy, Science and more. Some are lower case (cookbooks, contemporary, young adult, crime, humor, horror) and some are "Fiction / Historical" style (genre / sub-genre).
- Honors / club picks stored as genre: Prize winner 22, Reese's Book Club 10, Service95 Book Club 6, Oprah's Book Club 4, The Inklings 1, Inklings Book Club 1.
- Neither (owner to decide): "New release" 3 (time-limited), "Reader favourite" 1.
- Never delete candidates: clean values go to `genres`/`honors`, the original candidate rows stay.

## Data in network responses that the app reads but mostly drops (verify per parser in step 2)
Google Books: publisher, publishedDate, categories, printType, maturityRating, subtitle, industryIdentifiers. Open Library: subjects, series, subtitle, languages, publish_date, author_alternative_name, number_of_pages(_median). Apple: genres, releaseDate. Step 2 must decide per field: keep as a metadata candidate with source (nothing lost) and/or fill a column.
