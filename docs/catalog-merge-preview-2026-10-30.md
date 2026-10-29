# Catalog merge preview (Task B) - 2026-10-30

**Report only. Nothing was written.** Every query was a SELECT on project `amvkwwqcepmxxkfeqjox`. Applying any of this needs the owner's approval, and a merge function/script is a new migration (also needs approval). The sandbox cannot reach Apple, Google or Open Library, so no provider id could be verified; evidence below is what the catalog itself stores.

Policy used (owner, 2026-10-30): same book + same author = one canonical Work, second id kept as an alternate identifier; different books with one title stay separate; other editions/translations = one Work with several Editions. Verify from stored ids, ISBN, publisher, year, content; never title similarity. Keep covers, metadata, content, ratings, notes and personal links; delete nothing (the duplicate is archived).

**Personal data:** 0 `user_library_books` rows link to any of the 9 Works or their editions. Nothing personal moves.

**Why "re-point, then archive" and never delete:** 8 child tables reference `catalog_works` and 5 of them `ON DELETE CASCADE` (content, covers, editions, metadata, private notes, ratings). Deleting a Work would delete its data. `catalog_provider_records` and `user_library_books` are SET NULL.

## Live state (differs from the 2026-10-27 table in HANDOFF; Phase 3/WP1 and receipts happened since)

| Work (first 8 of id) | Title / author | olWork | Editions | Covers | Meta | Content | Ratings | Notes |
|---|---|---|---|---|---|---|---|---|
| `a1a46652` | Nettle & Bone / T. Kingfisher (alias Ursula Vernon) | OL24510090W | 1 (OL32480153M) | 3 | 3 | 2 | 2 | 2 |
| `806d8475` | Nettle & Bone / T. Kingfisher | none | 0 | 8 | 4 | 4 | 3 | 2 |
| `407c0012` | The Witch / Marie NDiaye | none | 0 | 1 | 1 | 2 | 2 | 0 |
| `7f4d064b` | The Witch / Marie NDiaye & Jordan Stump | none | 0 | 4 | 0 | 0 | 0 | 0 |
| `b800a2cb` | The Lion, the Witch and the Wardrobe / C.S. Lewis | none | 0 | 1 | 2 | 2 | 3 | 0 |
| `45f18b3b` | The Lion, the Witch and the Wardrobe / C. S. Lewis | none | 0 | 10 | 0 | 0 | 0 | 0 |
| `e3f8a77e` | HP and the Sorcerer's Stone / J.K. Rowling | OL31306243W | 0 | 2 | 3 | 2 | 3 | 1 |
| `1f36b07f` | HP and the Sorcerer's Stone / J. K. Rowling | none | 0 | 3 | 3 | 2 | 3 | 1 |
| `be350d24` | HP and the Philosopher's Stone / J. K. Rowling | OL82563W (+1 receipt) | 1 (OL61027601M) | 9 | 8 | 3 | 2 | 1 |

Full ids: `a1a46652-be9b-482f-ac3c-e8d16700a552`, `806d8475-69b3-4ee0-ba46-8780c053c17d`, `407c0012-14de-41e0-ac50-ba4d2e405293`, `7f4d064b-dfcb-4f4e-b52d-e589dd4f55f9`, `b800a2cb-7873-44a1-b140-742772338a8b`, `45f18b3b-e6b1-44a4-90aa-395fbd630f27`, `e3f8a77e-7cb8-4e4a-be3e-f1a8da694980`, `1f36b07f-f181-4ffe-86fc-11ac75612bcc`, `be350d24-3b7a-48e5-81e3-09733b54737c`.

## M1 Nettle & Bone: merge `806d8475` into `a1a46652` (evidence: strong)
- Stored evidence: identical author bio text (md5 `706dc0b3`) and a book description with identical text (`a04e78ca`) on both; the same Open Library cover ids (14409612, 11135584, preferred 15107782); the same Open Library and Google ratings (4.5/12, 4.0/1); same year 2022. `a1a46652` already records author alias Ursula Vernon (T. Kingfisher is Ursula Vernon's pen name; not provider-verified here).
- Canonical: `a1a46652` (has the Open Library work id, the edition and the author alias).
- Moves to canonical: 5 covers not there yet (Apple `9781250244031` as approved, 3 Google, Open Library `isbn/9781250244031`); Apple rating 4.5/501; description candidate `cde207ad`; the 500-char description `3e2cccd5` as an unselected candidate; 2 private notes (re-pointed). Already on canonical, so skipped: 3 covers, the `a04e78ca` description, the bio, `year`, the "Prize winner" row (already unselected by WP1).
- **Conflicts (nothing picked):**
  1. `pageCount`: `806d8475` has 220 (selected) and 320 (approved, unselected); `a1a46652` has 320 (selected); no Edition `page_count` is stored and every row's source is just "app". Canonical keeps its selected 320; 220 moves in as an unselected candidate. Needs a source to settle.
  2. Selected description: 500 chars (`806d8475`) vs 600 chars (`a1a46652`). Canonical's stays selected; the other moves unselected.
  3. The Apple cover filename carries ISBN `9781250244031`, but the catalog stores no ISBN for the edition. Proposal: leave `isbn13` empty until a provider confirms it.

## M2 The Witch (Marie NDiaye): merge `7f4d064b` into `407c0012` (evidence: strong)
- Stored evidence: both have the same preferred Apple cover URL (the same Apple listing, file `9798217006816`); the author differs only by the added translator credit "& Jordan Stump". The other "The Witch" (Freida McFadden) is a different author and stays separate.
- Canonical: `407c0012` (has the description, bio, year 2026 and ratings).
- Moves: 2 Open Library covers (`isbn/9781464249648`, id 15263335) and the Google cover **with its rejected status kept** (it must not become a candidate again). Apple cover skipped as a duplicate.
- Add author alias "Marie NDiaye & Jordan Stump" (plus the old `work_key`) so the old spelling still resolves. No conflicts. Not recorded: that Stump is the translator (taken from the owner's note, unverified).

## M3 The Lion, the Witch and the Wardrobe: merge `45f18b3b` into `b800a2cb` (evidence: moderate, no ids)
- Stored evidence: same title; authors "C. S. Lewis" and "C.S. Lewis" differ only by a space (the two `work_key`s differ for the same reason). No ISBN, edition or provider id is stored on either side to corroborate, so this rests on the exact title plus the same author written two ways, not on ids.
- Canonical: `b800a2cb` (has the description, bio, year 1950, 186 pages, 3 ratings, Apple cover). Display author stays "C.S. Lewis" unless the owner prefers "C. S. Lewis" (a one-field change).
- Moves: all 10 covers (9 Open Library candidates, plus the preferred Google cover as a non-preferred candidate). No conflicts.
- Recommend applying only with the owner's explicit OK because of the missing id evidence.

## M4a Sorcerer's Stone: merge `1f36b07f` into `e3f8a77e` (evidence: strong)
- Stored evidence: the two Works carry the same description text (`a5bbdf9c`), the same bio, the same 3 ratings (Apple 4.5/10803, Google 4.5/9, Open Library 4.0/1), the same `pageCount` 16 and year 2000. Only the author spacing ("J. K." vs "J.K.") differs.
- Canonical: `e3f8a77e` (has olWork OL31306243W and the Apple cover). Moves: Open Library `isbn/9781338299144` candidate, the Google candidate/preferred covers (non-preferred), 1 note. No conflicts.
- **Side finding (not fixed):** `pageCount` 16 and year 2000 look wrong for the novel. Needs a source-backed repair (Task B step 4), separate from this merge.

## M4b Philosopher's Stone `be350d24` vs the Sorcerer's Stone Work: HOLD (cannot be shown from stored data)
- It is the same first novel under the UK and US titles, but the catalog has no shared id: the Open Library works differ (OL82563W vs OL31306243W), no edition has an ISBN, publisher or date, pages differ (302 vs 16), years differ (1997 vs 2000), descriptions differ.
- Under the policy this is "other editions of one Work" only if ids/ISBNs show it. Needed: Open Library's work and ISBN for edition OL61027601M and for ISBNs 9781338299144 / 9781781105849 (found in stored cover URLs), checked from somewhere that can reach the provider (the owner's device or a machine with network).
- If confirmed: one Work, the two Editions kept separate, each title stored as a searchable alias of the other. Until then: do not merge.

## How a merge would be applied (not built; needs approval)
No merge function exists in the live catalog (functions: `catalog_get`, `catalog_changes`, `catalog_publish_*`, `catalog_reject_*`, `catalog_set_work_status`, ...). Proposal for approval: one admin-only function (or one reviewed SQL transaction) per pair, dry-run by default:
1. Snapshot every affected row as JSON in an audit note (`catalog_private_notes`) so a rollback script can restore it.
2. Re-point children first (covers, metadata, content, ratings, notes, editions); skip a row that already exists on the canonical (the unique indexes would reject it) and move it as unselected; never change a selected/preferred value on the canonical.
3. Add alias / author alias / alternate-id notes; archive the duplicate (`status = 'archived'`), never delete.
4. Re-run the counts above and compare before and after.
Unverified: how devices that cached the archived Work id react (`catalog_changes` handling of archived Works was not checked).

**Order if approved:** M2, M4a, M1 (no data loss, strongest evidence) then M3; M4b stays on hold.
