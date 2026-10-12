import test from 'node:test';
import assert from 'node:assert/strict';
import type { CuratedShelf } from '../../data/storeCatalog';
import { cleanSeeds, dynamicCuratedSource, mergeAppend, refreshShelf, type DynamicSpec } from './dynamic';
import { cleanTitle, cleanWiki, parseWikiTables, picksFromTables, splitPairedTitle } from './wikiLists';
import { resolvedMatchesSeed } from './curated';
import { routeFetch } from './testkit';

test('{{sortname}} with named first/last gives the name, not "last=… first=…"', () => {
  assert.equal(cleanWiki('{{sortname|first=Yael|last=van der Wouden}}'), 'Yael van der Wouden');
  assert.equal(cleanWiki('{{sortname|last=van der Wouden|first=Yael|nolink=1}}'), 'Yael van der Wouden');
  assert.equal(cleanWiki('{{sortname|Yael|van der Wouden}}'), 'Yael van der Wouden');
  assert.equal(cleanWiki('{{sortname|Tara|Westover|dab=writer}}'), 'Tara Westover');
});

test('Women\'s Prize table with a named sortname author', () => {
  const rows = [2026, 2025, 2024, 2023, 2022, 2021].map((y, i) => `| ${y} || {{sortname|first=First${i}|last=Last${i}}} || ''[[Book ${i}]]'' || Winner`).join('\n|-\n');
  const picks = picksFromTables(parseWikiTables(`{| class="wikitable"\n! Year !! Author !! Title !! Result\n|-\n${rows}\n|}`), { title: /^(title|novel|book)/i, author: /^(author|writer|winner)/i, when: /^(year|date)/i, result: /^(result|status|outcome)/i, winner: /winner/i, onePerYear: true })!;
  assert.deepEqual([picks[0].title, picks[0].author], ['Book 0', 'First0 Last0']);
});

test('a bad author saved by an older version is dropped, and a fresh pick replaces the same book saved with another author', () => {
  assert.deepEqual(cleanSeeds([['The Safekeep', 'last=van der Wouden first=Yael', 'Women’s Prize 2024'], ['Fine', 'A B']]), [['Fine', 'A B']]);
  const merged = mergeAppend([['The Safekeep', 'Yael van der Wouden', 'Women’s Prize 2024']], [['The Safekeep', 'Yael van der Wouden (b. 1990)', 'old'], ['Older', 'O A']]);
  assert.deepEqual(merged.map(s => s[0]), ['The Safekeep', 'Older']);
  assert.equal(merged[0][1], 'Yael van der Wouden');
});

test('a saved list with a bad entry shows without it, right away', async () => {
  const sh: CuratedShelf = { id: 't-bad-saved', title: 'T', emoji: '📚', genre: 'Fiction', seeds: Array.from({ length: 10 }, (_, i) => [`Base ${i}`, `Author ${i}`] as [string, string]) };
  const spec = (seeds: [string, string, string][]): DynamicSpec => ({ source: 't', kind: 'fallback', refreshMs: 7 * 24 * 3600_000, minSeeds: 8, merge: 'append', fetch: async () => ({ seeds }) });
  const good = Array.from({ length: 9 }, (_, i) => [`Good ${i}`, `Writer ${i}`, 'x'] as [string, string, string]);
  routeFetch([]);
  await refreshShelf(sh, spec([['Bad One', 'last=Smith first=Ann', 'x'], ...good]));
  const books = dynamicCuratedSource(sh, spec(good)).cached();
  assert.ok(books && !books.some(b => b.title === 'Bad One'));
});

test('splitPairedTitle: two books chosen at once become two; one-word halves and single titles stay whole', () => {
  assert.deepEqual(splitPairedTitle('Great Expectations, A Tale of Two Cities'), ['Great Expectations', 'A Tale of Two Cities']);
  assert.deepEqual(splitPairedTitle('A Tale of Two Cities and Great Expectations'), ['A Tale of Two Cities', 'Great Expectations']);
  assert.deepEqual(splitPairedTitle('Great Expectations / A Tale of Two Cities'), ['Great Expectations', 'A Tale of Two Cities']);
  for (const t of ['Pride and Prejudice', 'War and Peace', 'Beloved', 'The Heart and the Fist', 'Hidden Valley Road: Inside the Mind of an American Family']) assert.deepEqual(splitPairedTitle(t), [t], t);
});

test('a found book is only used when it is the book the shelf asked for (no other book\'s cover under the right name)', () => {
  assert.equal(resolvedMatchesSeed({ title: 'Beloved', author: 'Toni Morrison' }, 'Great Expectations', 'Charles Dickens'), false);
  assert.equal(resolvedMatchesSeed({ title: 'Beloved', author: 'Toni Morrison' }, 'Great Expectations, A Tale of Two Cities', 'Charles Dickens'), false);
  assert.equal(resolvedMatchesSeed({ title: 'Home', author: 'Marilynne Robinson' }, 'Gilead', 'Marilynne Robinson'), false); // same author, other book
  assert.equal(resolvedMatchesSeed({ title: 'Demon Copperhead: A Novel', author: 'Barbara Kingsolver' }, 'Demon Copperhead', 'Barbara Kingsolver'), true);
  assert.equal(resolvedMatchesSeed({ title: 'The Underground Railroad', author: 'Colson Whitehead' }, 'Underground Railroad', 'Colson Whitehead'), true);
  assert.equal(resolvedMatchesSeed({ title: "Harry Potter and the Philosopher's Stone", author: 'J.K. Rowling' }, "Harry Potter and the Sorcerer's Stone", 'J. K. Rowling'), true); // another edition's title
});

test('numbered template values never reach a title: "1=The 2=Book of Form and Emptiness" is "The Book of Form and Emptiness"', () => {
  assert.equal(cleanWiki('{{sortname|1=The|2=Book of Form and Emptiness}}'), 'The Book of Form and Emptiness');
  assert.equal(cleanWiki('{{nowrap|1=The Book of Form and Emptiness}}'), 'The Book of Form and Emptiness');
  assert.equal(cleanWiki('{{sortname|Ruth|2=Ozeki}}'), 'Ruth Ozeki');
  assert.equal(cleanTitle('1=The 2=Book of Form and Emptiness'), 'The Book of Form and Emptiness'); // the safety net, for anything already saved
  assert.equal(cleanTitle('Catch-22'), 'Catch-22');
});

test('a saved "1=The 2=Book…" title is repaired and is not shown twice next to the real one', () => {
  const seeds = cleanSeeds([['1=The 2=Book of Form and Emptiness', 'Ruth Ozeki', "Women's Prize 2022"], ['The Book of Form and Emptiness', 'Ruth Ozeki', "Women's Prize 2022"]]);
  assert.deepEqual(seeds, [['The Book of Form and Emptiness', 'Ruth Ozeki', "Women's Prize 2022"]]);
  const merged = mergeAppend([['1=The 2=Book of Form and Emptiness', 'Ruth Ozeki', "Women's Prize 2022"]], [['The Book of Form and Emptiness', 'Ruth Ozeki', "Women's Prize 2022"]]);
  assert.deepEqual(merged.map(s => s[0]), ['The Book of Form and Emptiness']);
});

test('a translated prize winner keeps only its English title (the original-language title on the next line is dropped)', () => {
  const rows = [[2021, 'At Night All Blood Is Black', "Frère d'âme", 'David Diop'], [2020, 'The Discomfort of Evening', 'De avonden', 'Marieke Lucas Rijneveld'], [2019, 'Celestial Bodies', 'Sayyidat al-Qamar', 'Jokha al-Harthi'], [2018, 'Flights', 'Bieguni', 'Olga Tokarczuk'], [2017, 'A Horse Walks into a Bar', 'Sus al-Ta', 'David Grossman'], [2016, 'The Vegetarian', '채식주의자', 'Han Kang']]
    .map(([y, en, orig, a]) => `| ${y} || ''[[${en}]]''<br>''${orig}'' || [[${a}]] || Winner`).join('\n|-\n');
  const wt = `{| class="wikitable"\n! Year !! Title !! Author !! Result\n|-\n${rows}\n|}`;
  const picks = picksFromTables(parseWikiTables(wt), { title: /^(title)/i, author: /^(author)/i, when: /^year/i, result: /^result/i, winner: /winner/i, onePerYear: true, firstTitleLine: true })!;
  assert.deepEqual(picks.map(p => p.title), ['At Night All Blood Is Black', 'The Discomfort of Evening', 'Celestial Bodies', 'Flights', 'A Horse Walks into a Bar', 'The Vegetarian']);
  // a second author on the next line is still two authors
  const two = picksFromTables(parseWikiTables(`{| class="wikitable"\n! Year !! Title !! Author\n|-\n${[1,2,3,4,5,6].map(i => `| 20${10 + i} || Book ${i} || A${i} One<br>B${i} Two`).join('\n|-\n')}\n|}`), { title: /^title/i, author: /^author/i, when: /^year/i })!;
  assert.equal(two[0].author, 'A6 One & B6 Two');
});

test('a saved "Flights, Bieguni" is repaired to the hand-picked "Flights" and not shown twice', async () => {
  const sh: CuratedShelf = { id: 'intbooker', title: 'T', emoji: '📚', genre: 'Fiction', seeds: Array.from({ length: 10 }, (_, i) => [`Base ${i}`, `Author ${i}`] as [string, string]) };
  const spec: DynamicSpec = { source: 't', kind: 'fallback', refreshMs: 7 * 24 * 3600_000, minSeeds: 8, merge: 'append', fetch: async () => ({ seeds: [['Flights, Bieguni', 'Olga Tokarczuk', 'International Booker 2018'], ...Array.from({ length: 9 }, (_, i) => [`Good ${i}`, `Writer ${i}`, 'x'] as [string, string, string])] }) };
  routeFetch([]);
  await refreshShelf(sh, spec);
  const books = dynamicCuratedSource(sh, spec).cached()!;
  assert.ok(books.some(b => b.title === 'Flights') && !books.some(b => /Bieguni/.test(b.title)));
});

test('author names: "Jokha al-Harthi" and "Jokha Alharthi" are one author; hyphen variants for searching', async () => {
  const { authorsCompatible, authorVariants, mainTitle } = await import('../books/identity');
  assert.ok(authorsCompatible('Jokha al-Harthi', 'Jokha Alharthi'));
  assert.ok(!authorsCompatible('Jokha al-Harthi', 'Jokha Smith'));
  assert.deepEqual(authorVariants('Jokha al-Harthi'), ['Jokha al-Harthi', 'Jokha alHarthi', 'Jokha al Harthi']);
  assert.deepEqual(authorVariants('Han Kang'), ['Han Kang']);
  assert.equal(mainTitle('All the Way to the River: Love, Loss, and Liberation'), 'All the Way to the River');
  assert.equal(mainTitle('Beloved'), 'Beloved');
});

test('cover lookup: a subtitled title is found under its short title, and a hyphenated author under the closed-up spelling', async () => {
  const { findOpenLibrary } = await import('../books/sources/openLibrary');
  const doc = (title: string, author: string) => ({ docs: [{ key: '/works/OL1W', title, author_name: [author], cover_i: 7, first_publish_year: 2025 }] });
  // Open Library lists it as "All the Way to the River" only: the full-subtitle search finds nothing
  const calls = routeFetch([u => {
    if (u.pathname !== '/search.json') return undefined;
    return u.searchParams.get('title') === 'All the Way to the River' ? { body: doc('All the Way to the River', 'Elizabeth Gilbert') } : { body: { docs: [] } };
  }]);
  const hit = await findOpenLibrary({ title: 'All the Way to the River: Love, Loss, and Liberation', author: 'Elizabeth Gilbert' });
  assert.equal(hit?.book.coverId, 7);
  assert.equal(calls.length, 2);

  // The catalogue spells the name Alharthi
  routeFetch([u => (u.pathname === '/search.json' ? (u.searchParams.get('author') === 'Jokha alHarthi' ? { body: doc('Celestial Bodies', 'Jokha Alharthi') } : { body: { docs: [] } }) : undefined)]);
  assert.equal((await findOpenLibrary({ title: 'Celestial Bodies', author: 'Jokha al-Harthi' }))?.book.coverId, 7);
});
