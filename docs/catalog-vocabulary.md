# Catalog vocabulary: names, rules and mapping seed (design for Phase 4, agreed direction 2026-10-27)

## How the sources name things
| Idea | Apple Books | Google Books | Open Library | Goodreads | GreatReads (decided) |
|---|---|---|---|---|---|
| Browse category | `genres` (list) | `categories` (paths like "Fiction / Fantasy / Epic") | no genre field; `subjects` | "Genres", crowd-sourced from users' shelves | **`genres`** (controlled, owner-curated) |
| More specific | none | deeper parts of the category path | `subjects` | popular shelves | **`subgenres`** (each has a parent genre) |
| Topics and themes | none | none | `subjects`, plus separate `subject_places`, `subject_people`, `subject_times` | shelves | **`subjects`** (shown as "Subjects & themes") |
| Search wording | none | none | none | none | **`keywords`** (hidden, matching only) |
| Curated groups | store collections/charts | none | none | "Lists" | **`collections`** |
| Awards | none | none | none | not checked | **`honors`** (display, live) + **`awards`** (structured) |
| Editorial flag | none | none | none | none | **`tags`** |
Verified: Open Library names (API docs), Goodreads genres are derived from user shelves (Goodreads Librarians discussions); Apple `genres` and Google `categories` were verified from this app's own parsers. Goodreads awards, Amazon/KDP keyword naming and BISAC/Thema subject codes were not checked.

## Decisions
1. Kinds in `catalog_terms`: `genre`, `subgenre` (parent = a genre), `subject`, `keyword`, `collection`, `tag`. No separate `theme` kind: themes live in `subject` (UI label "Subjects & themes"); split later only if needed. Awards are their own tables (name, year, result: won / shortlisted / nominated).
2. Use **subjects** (not "categories": Google uses that word for genre paths) and **collections** (not "categories").
3. `genres` stay few and controlled (max 5 per work). Subgenres, subjects and keywords can be many.
4. **A source label is mapped by meaning and never replaces the specific label by its parent:** the specific label is kept as subgenre/subject, and a parent genre is added only when the context agrees (the label arrived under that root, or the work already has that genre). A label that is ambiguous stays a subject only. The owner can override per work.
5. The mapping lives in data (`catalog_term_aliases`: source, label, term, requires_genre, implies_genre) so it can be edited without a deploy; the code classifier remains the fallback.
6. "New release" is never a term (derived from edition dates, 90 days). "Prize winner", "Reese's Book Club" and similar are honors or collections, never genres.

## Mapping seed (owner's table, adjusted where a label is ambiguous)
| Source label | Store as | Genre added | Condition / note |
|---|---|---|---|
| Romcom | subgenre Romantic comedy | Romance | under Fiction |
| Dystopian | subgenre Dystopian | Science fiction | only if the work is Fiction |
| Literary | genre Literary fiction | (Fiction) | already coded |
| Historical | genre Historical fiction | Fiction | ONLY as "Fiction / Historical"; alone it is ambiguous (history vs historical fiction), so subject candidate |
| Business & Economics | genre Business | Non-fiction | already coded |
| Speculative | subgenre Speculative fiction | none | umbrella over SF, fantasy and horror, so it must not imply Science fiction |
| Satire | subgenre Satire | none by default | owner decision: Humor is right for comic books, wrong for political satire |
| Essays | subgenre Essays | Non-fiction | |
| Myth | subject Mythology | Fantasy | only for Fiction (retellings); nonfiction stays subject-only |
| Creativity | subject Creativity | Self-help | only under "Self-help / ..." |
| Career | subject Career | Self-help | only under "Self-help / ..." |
| Family & Relationships | subject Family & relationships | Non-fiction | it is a top-level Google category (parenting, marriage); Self-help only if also labeled |
| Political Science | subject Politics | Non-fiction | |
| Social Science | subject Social science | Non-fiction | |
| Translated | NOT a term | none | a fact about the edition/translator (edition and contributor data) |

## Example record (shape the app and Book Info should show)
- **Genres:** Fantasy, Adventure. **Subgenres:** Epic fantasy, Quest fantasy.
- **Subjects & themes:** Found family, Friendship, Political corruption, Resistance.
- **Keywords (hidden):** found-family fantasy, band of heroes, rebellion, political intrigue.
- **Collections:** Best Fantasy Books of 2026. **Honors:** Hugo Award (won, 2026). **Tags:** Staff pick.
