// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { titlesMatch, titleVariants, dualTitleParts, subtitleKey, sameWork, authorsCompatible } from './identity';
import { chooseRating, knownRating, withKnownRating, ratingOf, starFills, otherRatings, inferRatingSource } from './ratings';
import { fetchRatingSources } from './details';
import { repairSeeds } from '../store/dynamic';
import { mergeBooks } from './merge';
import { resolveBook } from './resolve';
import { findApple } from './sources/appleBooks';
import { resolveCuratedShelf, resolvedMatchesSeed } from '../store/curated';
import { routeFetch } from '../store/testkit';

const book = (o: any) => ({ id: o.title, title: 'T', author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2020', genre: 'Fiction', summary: 'x'.repeat(80), authorBio: '', pageCount: 300, ...o }) as any;

/* ---------- matching ---------- */

test('main titles equal: a long, club or edition subtitle on either side never blocks a match', () => {
  const full = 'All the Way to the River: Love, Loss, and Liberation';
  assert.ok(titlesMatch(full, 'All the Way to the River'));
  assert.ok(titlesMatch(full, 'All the Way to the River: A Book Club Pick'));
  assert.ok(titlesMatch(full, 'All the Way to the River: Special Edition'));
  assert.ok(titlesMatch('The Road: Oprah\'s Book Club', 'The Road: A Novel'));
  assert.equal(subtitleKey(full), ''); // descriptive, so it is not part of the identity
});

test('series volumes stay distinct', () => {
  assert.ok(!titlesMatch('Mistborn: The Final Empire', 'Mistborn: The Well of Ascension'));
  assert.ok(!titlesMatch('Dune: Messiah', 'Dune: Children of Dune'));
  assert.ok(titlesMatch('Mistborn: The Final Empire', 'Mistborn: Final Empire')); // shortened is the same volume
  assert.ok(titlesMatch('Mistborn: The Final Empire', 'Mistborn')); // one-sided subtitle
  assert.ok(!titlesMatch('Mistborn', 'Mistwalker'));
});

test('dual titles ("English, Original") match either half and search with each', () => {
  const dual = 'The Discomfort of Evening, De avond is ongemak';
  assert.deepEqual(dualTitleParts(dual), ['The Discomfort of Evening', 'De avond is ongemak']);
  assert.ok(titlesMatch(dual, 'The Discomfort of Evening'));
  assert.ok(titlesMatch('De avond is ongemak', dual));
  assert.deepEqual(titleVariants(dual), [dual, 'The Discomfort of Evening', 'De avond is ongemak']);
  // single titles that merely contain commas are not split
  for (const t of ['Hello, Goodbye', 'Shine, Shine, Shine', 'Love, Loss: A Memoir']) assert.deepEqual(dualTitleParts(t), [], t);
  assert.ok(!titlesMatch('Hello, Goodbye', 'Hello'));
});

test('titleVariants: full title, then main title', () => {
  assert.deepEqual(titleVariants('All the Way to the River: Love, Loss, and Liberation'), ['All the Way to the River: Love, Loss, and Liberation', 'All the Way to the River']);
  assert.deepEqual(titleVariants('Piranesi'), ['Piranesi']);
});

/* ---------- ratings policy ---------- */

test('ratings ladder: library pair, else Open Library, else Google; one source only', () => {
  const lib = { average: 4.6, count: 18400 };
  const ol = { average: 4.0, count: 500 };
  const gb = { average: 3.2, count: 90000 };
  assert.deepEqual(chooseRating({ library: lib, ol, google: gb }), lib);
  assert.deepEqual(chooseRating({ ol, google: gb }), ol); // not the bigger Google audience, and never a sum
  assert.deepEqual(chooseRating({ google: gb }), gb);
  assert.equal(chooseRating({}), undefined);
  // a thin preferred source yields to a solid lower one; with nothing solid the preferred one is kept
  assert.deepEqual(chooseRating({ ol: { average: 5, count: 2 }, google: gb }), gb);
  assert.deepEqual(chooseRating({ ol: { average: 5, count: 2 }, google: { average: 4, count: 3 } }), { average: 5, count: 2 });
  assert.equal(ratingOf({ ratingAverage: 0, ratingCount: 50 }), undefined);
});

test('same book in the library lends its rating as a pair, whatever the record id or subtitle', () => {
  const mine = book({ id: 0, title: 'Piranesi', author: 'Susanna Clarke', ratingAverage: 4.4, ratingCount: 1200 });
  const store = book({ id: 'ol__works_OL1W', title: 'Piranesi: A Novel', author: 'Clarke, Susanna', ratingAverage: 4.1, ratingCount: 99999 });
  const other = book({ id: 'x', title: 'Piranesi', author: 'Somebody Else', ratingAverage: 3, ratingCount: 7 });
  assert.deepEqual(knownRating(store, [mine]), { average: 4.4, count: 1200, source: 'library' });
  const shown = withKnownRating(store, [mine]);
  assert.equal(shown.ratingAverage, 4.4);
  assert.equal(shown.ratingCount, 1200); // not 99999, not 1200 + 99999
  assert.equal(shown.id, store.id);
  assert.equal(withKnownRating(other, [mine]), other); // a different author is a different book
  const noRating = book({ id: 1, title: 'Piranesi', author: 'Susanna Clarke' });
  assert.equal(withKnownRating(store, [noRating]), store); // nothing to reuse
  assert.ok(sameWork(mine, store, true));
});

test('merging never mixes or sums ratings: the first record keeps its pair', () => {
  const a = book({ ratingAverage: 4.0, ratingCount: 10 });
  const b = book({ ratingAverage: 3.0, ratingCount: 100000 });
  const m = mergeBooks(a, b);
  assert.equal(m.ratingAverage, 4.0);
  assert.equal(m.ratingCount, 10);
  const empty = mergeBooks(book({}), b);
  assert.equal(empty.ratingAverage, 3.0);
  assert.equal(empty.ratingCount, 100000);
  const noCount = mergeBooks(book({ ratingAverage: 4.5 }), b);
  assert.equal(noCount.ratingCount, undefined); // 4.5 is never shown with b's count
});

/* ---------- resolver ---------- */

const gbVolume = (title: string, author: string, extra: any = {}) => ({ items: [{ id: `v_${title.length}`, volumeInfo: { title, authors: [author], publishedDate: '2020', pageCount: 222, ...extra } }] });
const olDoc = (key: string, title: string, author: string, extra: any = {}) => ({ docs: [{ key, title, author_name: [author], first_publish_year: 2020, cover_i: 4242, number_of_pages_median: 250, ...extra }] });

test('resolveBook: Open Library average + count, never Google\'s count or a sum', async () => {
  routeFetch([
    u => (u.hostname === 'openlibrary.org' ? { body: olDoc('/works/OL81W', 'Ladder Alpha', 'Ann Author', { ratings_average: 4.04, ratings_count: 321 }) } : undefined),
    u => (u.hostname === 'www.googleapis.com' ? { body: gbVolume('Ladder Alpha', 'Ann Author', { averageRating: 3, ratingsCount: 9000 }) } : undefined),
  ]);
  const r = await resolveBook({ title: 'Ladder Alpha', author: 'Ann Author' });
  assert.equal(r?.book.ratingAverage, 4);
  assert.equal(r?.book.ratingCount, 321);
  assert.equal(r?.book.identity?.olWork, 'OL81W');
});

test('resolveBook: Google pair when Open Library has no rating; none when neither does', async () => {
  routeFetch([
    u => (u.hostname === 'openlibrary.org' && u.pathname === '/search.json' ? { body: olDoc('/works/OL82W', 'Ladder Beta', 'Ben Author') } : undefined),
    u => (u.hostname === 'openlibrary.org' ? { body: { summary: {} } } : undefined),
    u => (u.hostname === 'www.googleapis.com' ? { body: gbVolume('Ladder Beta', 'Ben Author', { averageRating: 3.5, ratingsCount: 40 }) } : undefined),
  ]);
  const g = await resolveBook({ title: 'Ladder Beta', author: 'Ben Author' });
  assert.equal(g?.book.ratingAverage, 3.5);
  assert.equal(g?.book.ratingCount, 40);

  routeFetch([
    u => (u.hostname === 'openlibrary.org' && u.pathname === '/search.json' ? { body: olDoc('/works/OL83W', 'Ladder Gamma', 'Cy Author') } : undefined),
    u => (u.hostname === 'openlibrary.org' ? { body: { summary: {} } } : undefined),
    u => (u.hostname === 'www.googleapis.com' ? { body: gbVolume('Ladder Gamma', 'Cy Author') } : undefined),
  ]);
  const none = await resolveBook({ title: 'Ladder Gamma', author: 'Cy Author' });
  assert.equal(none?.book.ratingAverage, undefined);
  assert.equal(none?.book.ratingCount, undefined);
});

test('resolveBook: Apple readers never become the stars', async () => {
  routeFetch([
    u => (u.hostname === 'openlibrary.org' && u.pathname === '/search.json' ? { body: olDoc('/works/OL84W', 'Ladder Delta', 'Di Author') } : undefined),
    u => (u.hostname === 'openlibrary.org' ? { body: { summary: {} } } : undefined),
    u => (u.hostname === 'www.googleapis.com' ? { body: { items: [] } } : undefined),
    u => (u.hostname === 'itunes.apple.com' ? { body: { results: [{ trackId: 1, trackName: 'Ladder Delta', artistName: 'Di Author', artworkUrl100: 'https://a/100x100bb.jpg', averageUserRating: 4.9, userRatingCount: 70000 }] } } : undefined),
  ]);
  const r = await resolveBook({ title: 'Ladder Delta', author: 'Di Author', apple: true });
  assert.equal(r?.book.ratingAverage, undefined);
  assert.equal(r?.readers?.apple, 70000); // still available to the popularity score
});

/* ---------- Apple search ---------- */

test('findApple retries with the main title, then each half of a dual title', async () => {
  const calls = routeFetch([
    u => {
      if (u.hostname !== 'itunes.apple.com') return undefined;
      const term = u.searchParams.get('term') || '';
      if (term.includes(':')) return { body: { results: [] } }; // the full, subtitled title finds nothing
      return { body: { results: [{ trackId: 7, trackName: 'Marketed Title: The Club Edition', artistName: 'Eve Author', artworkUrl100: 'https://a/100x100bb.jpg' }] } };
    },
  ]);
  const hit = await findApple({ title: 'Marketed Title: Long, Descriptive, Subtitle', author: 'Eve Author' });
  assert.ok(hit);
  assert.equal(calls.length, 2);

  routeFetch([
    u => {
      if (u.hostname !== 'itunes.apple.com') return undefined;
      const term = u.searchParams.get('term') || '';
      return term.startsWith('The Dual Evening,')
        ? { body: { results: [] } }
        : { body: { results: [{ trackId: 8, trackName: 'The Dual Evening', artistName: 'Fay Author', artworkUrl100: 'https://a/100x100bb.jpg' }] } };
    },
  ]);
  const dual = await findApple({ title: 'The Dual Evening, De avond is anders', author: 'Fay Author' });
  assert.equal(dual?.book.title, 'The Dual Evening');
});

/* ---------- curated shelf enrichment ---------- */

test('resolveCuratedShelf looks a book up when only the rating or pages are missing, and keeps what it has', async () => {
  routeFetch([
    u => (u.hostname === 'openlibrary.org' ? { body: olDoc('/works/OL85W', 'Shelf Book', 'Gil Author', { ratings_average: 4.2, ratings_count: 80, cover_i: 999, number_of_pages_median: 321 }) } : undefined),
    u => (u.hostname === 'www.googleapis.com' ? { body: { items: [] } } : undefined),
  ]);
  const shelf = { id: 'test', title: 'Test', genre: 'Fiction', seeds: [['Shelf Book', 'Gil Author', 'Pick of the Month']] } as any;
  const have = [book({ id: 'seed_test_shelf-book', title: 'Shelf Book', author: 'Gil Author', coverUrl: 'https://bundled/cover.jpg', ratingAverage: undefined, ratingCount: undefined, pageCount: 0, awardLabel: 'Pick of the Month' })];
  let last: any[] = [];
  await resolveCuratedShelf(shelf, have, b => (last = b));
  assert.equal(last[0].ratingAverage, 4.2);
  assert.equal(last[0].ratingCount, 80);
  assert.equal(last[0].pageCount, 321);
  assert.equal(last[0].coverUrl, 'https://bundled/cover.jpg'); // the bundled cover is kept
  assert.equal(last[0].identity?.olWork, 'OL85W');
  assert.equal(last[0].title, 'Shelf Book');
  assert.equal(last[0].awardLabel, 'Pick of the Month');
});

test('resolvedMatchesSeed accepts a dual or club-subtitled title for the same book', () => {
  assert.ok(resolvedMatchesSeed({ title: 'De avond is ongemak', author: 'Marieke Lucas Rijneveld' }, 'The Discomfort of Evening, De avond is ongemak', 'Marieke Lucas Rijneveld'));
  assert.ok(!resolvedMatchesSeed({ title: 'Something Else Entirely', author: 'Other Person' }, 'The Discomfort of Evening, De avond is ongemak', 'Marieke Lucas Rijneveld'));
});

/* ---------- translated books: author spelling and original-language titles ---------- */

test('an author written with or without a given name is the same author', () => {
  assert.ok(authorsCompatible('Marieke Lucas Rijneveld', 'Lucas Rijneveld'));
  assert.ok(authorsCompatible('Lucas Rijneveld', 'Marieke Lucas Rijneveld'));
  assert.ok(!authorsCompatible('Lucas Rijneveld', 'Lucas Smith'));
  assert.ok(!authorsCompatible('Ann Brown', 'Bob Brown'));
});

test('a prize pick under its original-language title becomes the hand-picked book with the same pick label', () => {
  // intbooker's bundled list holds "The Discomfort of Evening" labelled "International Booker 2020"
  const dutch: [string, string, string] = ['De avond is ongemak', 'Marieke Lucas Rijneveld', 'International Booker 2020'];
  const other: [string, string, string] = ['Celestial Bodies', 'Jokha Alharthi', 'International Booker 2019'];
  const out = repairSeeds('intbooker', [dutch, other]);
  assert.equal(out[0][0], 'The Discomfort of Evening');
  assert.equal(out[0][2], 'International Booker 2020');
  assert.equal(out[1][0], 'Celestial Bodies'); // untouched
  // when the English pick is already in the list, the Dutch duplicate goes
  const both = repairSeeds('intbooker', [['The Discomfort of Evening', 'Marieke Lucas Rijneveld', 'International Booker 2020'], dutch]);
  assert.equal(both.filter(s => /Discomfort|ongemak/.test(s[0])).length, 1);
});

/* ---------- ratings from every site ---------- */

test('starFills: exact fractions per star', () => {
  assert.deepEqual(starFills(4), [1, 1, 1, 1, 0]);
  assert.deepEqual(starFills(4.5), [1, 1, 1, 1, 0.5]);
  assert.deepEqual(starFills(3.2), [1, 1, 1, 0.2, 0]);
  assert.deepEqual(starFills(0), [0, 0, 0, 0, 0]);
  assert.deepEqual(starFills(9), [1, 1, 1, 1, 1]);
});

test('the main rating names its site and the others are listed after it', () => {
  const found = [
    { source: 'apple' as const, average: 4, count: 80 },
    { source: 'openlibrary' as const, average: 4.2, count: 300 },
    { source: 'google' as const, average: 3.9, count: 125 },
  ];
  assert.equal(inferRatingSource({ id: 'x', ratingAverage: 4.2, ratingCount: 300 } as any, found), 'openlibrary'); // matched by its own pair
  assert.equal(inferRatingSource({ id: 'x', ratingAverage: 4.2, ratingCount: 999 } as any, found), undefined); // matches no site exactly: no claim
  assert.equal(inferRatingSource({ id: 0, source: 'curated', ratingAverage: 4.6, ratingCount: 18400 } as any, found), 'library');
  assert.equal(inferRatingSource({ id: 'x', ratingAverage: 4.2, ratingSource: 'google' } as any, found), 'google'); // what the book says wins
  assert.deepEqual(otherRatings(found, 'openlibrary').map(f => f.source), ['google', 'apple']);
  assert.deepEqual(otherRatings(found, 'library').map(f => f.source), ['openlibrary', 'google', 'apple']);
});

test('fetchRatingSources returns each site\'s own average and count, never combined, and skips sites without a rating', async () => {
  routeFetch([
    u => (u.hostname === 'openlibrary.org' ? { body: olDoc('/works/OL91W', 'Sources Alpha', 'Hal Author', { ratings_average: 4.04, ratings_count: 321 }) } : undefined),
    u => (u.hostname === 'www.googleapis.com' ? { body: gbVolume('Sources Alpha', 'Hal Author', { averageRating: 3.5, ratingsCount: 125 }) } : undefined),
    u => (u.hostname === 'itunes.apple.com' ? { body: { results: [{ trackId: 3, trackName: 'Sources Alpha', artistName: 'Hal Author', artworkUrl100: 'https://a/100x100bb.jpg' }] } } : undefined), // Apple: no rating
  ]);
  const r = await fetchRatingSources(book({ id: 'q1', title: 'Sources Alpha', author: 'Hal Author' }));
  assert.deepEqual(r, [{ average: 4, count: 321, source: 'openlibrary' }, { average: 3.5, count: 125, source: 'google' }]);
});
