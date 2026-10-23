// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { searchBooksLive, searchLocal, searchRelevance, forgetRecentSearchesForTests, rank } from './search';
import { forgetSeenForTests } from './localIndex';
import { applySearchView, genreOptions, DEFAULT_SEARCH_VIEW } from './searchView';

const book = (o: any) => ({ id: o.title, title: 'T', author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2020', genre: 'Fiction', summary: 'x'.repeat(80), authorBio: '', pageCount: 300, ...o }) as any;
const gb = (id: string, v: any) => ({ id, volumeInfo: { pageCount: 300, publishedDate: '2015', ...v } });
const ol = (key: string, title: string, author: string, extra: any = {}) => ({ key: `/works/${key}`, title, author_name: [author], first_publish_year: 2001, ...extra });
function mockFetch(handler: (url: URL) => unknown) {
  const seen: URL[] = [];
  (globalThis as any).fetch = async (input: string) => {
    const url = new URL(String(input), 'https://example.test');
    seen.push(url);
    const body = handler(url);
    return { ok: body !== null, status: body === null ? 404 : 200, json: async () => body };
  };
  return seen;
}
const reset = () => { store.clear(); forgetRecentSearchesForTests(); forgetSeenForTests(); };

test('a title typed in full is an exact match even without its leading article ("threshing" -> "The Threshing")', () => {
  const exact = book({ title: 'The Threshing', author: 'Someone' });
  const longer = book({ title: 'Threshing Machines of the Midwest', author: 'Other', ratingAverage: 4.2, ratingCount: 900 });
  // the box cannot tell "finished" from "still typing": partial is true even for a whole word
  assert.ok(searchRelevance(exact, 'threshing', '', true) >= 95);
  assert.ok(searchRelevance(exact, 'threshing', '', true) > searchRelevance(longer, 'threshing', '', true));
  // and a title with a leading article is matched by the beginning of its real title
  assert.ok(searchRelevance(book({ title: 'The Threshing Floor' }), 'threshing', '', true) >= 70);
});

test('an author\'s full name lists that author\'s books before books about the author', () => {
  const emma = book({ title: 'Emma', author: 'Jane Austen' });
  const life = book({ title: 'Jane Austen: A Life', author: 'Carol Shields', ratingAverage: 4, ratingCount: 3000 });
  assert.ok(searchRelevance(emma, 'jane austen', '', true) > searchRelevance(life, 'jane austen', '', true));
  // a half-typed surname still counts as an author match (less than a whole name)
  assert.ok(searchRelevance(emma, 'jane aust', '', true) > searchRelevance(book({ title: 'Plain Jane', author: 'Other' }), 'jane aust', '', true));
});

test('"jane austen": once a source shows it is an author, that author\'s books are asked for and come first', async () => {
  reset();
  const seen = mockFetch(url => {
    if (url.hostname === 'openlibrary.org') {
      if (url.searchParams.get('author') === 'Jane Austen') return { docs: [ol('OL1W', 'Emma', 'Jane Austen'), ol('OL2W', 'Persuasion', 'Jane Austen'), ol('OL3W', 'Sense and Sensibility', 'Jane Austen')] };
      return { docs: [ol('OL9W', 'Jane Austen: A Life', 'Carol Shields', { ratings_count: 3000, ratings_average: 4 }), ol('OL1W', 'Emma', 'Jane Austen')] };
    }
    return { items: [] };
  });
  const found = await searchBooksLive('jane austen', { limit: 36 });
  assert.ok(seen.some(u => u.searchParams.get('author') === 'Jane Austen'), 'asked Open Library for the author\'s own books');
  assert.ok(seen.some(u => u.searchParams.get('q') === 'inauthor:"Jane Austen"'), 'and Google Books');
  assert.deepEqual(found.slice(0, 3).map(b => b.author), ['Jane Austen', 'Jane Austen', 'Jane Austen']);
  assert.equal(found[found.length - 1].title, 'Jane Austen: A Life');
});

test('an ordinary title costs no extra request', async () => {
  reset();
  const seen = mockFetch(() => ({ docs: [ol('OL1W', 'The Hobbit', 'J. R. R. Tolkien')], items: [] }));
  await searchBooksLive('hobbit', { local: false });
  assert.equal(seen.length, 2);
});

test('a book you asked for by its exact title is still shown when only its description / maturity flag is against it; an explicit title or category stays out', async () => {
  reset();
  mockFetch(url => (url.hostname === 'openlibrary.org'
    ? { docs: [ol('OL1W', 'Verity', 'Colleen Hoover', { ratings_count: 8000, ratings_average: 4.1 })] }
    : { items: [
      gb('v1', { title: 'Verity', authors: ['Colleen Hoover'], maturityRating: 'MATURE', description: 'A dark romance with sex scenes and a steamy, spicy romance thread inside a thriller.', categories: ['Fiction / Thrillers / Suspense'] }),
      gb('e1', { title: 'Verity: An Erotica Collection', authors: ['Nobody'], categories: ['Fiction / Erotica'] }),
    ] }));
  const titles = (await searchBooksLive('verity', { local: false, final: true })).map(b => b.title);
  assert.ok(titles.includes('Verity'), `Verity shown: ${titles.join(' | ')}`);
  assert.ok(!titles.some(t => /erotica/i.test(t)), 'an explicit title is still hidden');
  // the same flag on a book that was NOT asked for by name still filters it out (discovery stays clean)
  reset();
  mockFetch(url => (url.hostname === 'openlibrary.org' ? { docs: [] } : { items: [gb('v1', { title: 'Verity', authors: ['Colleen Hoover'], maturityRating: 'MATURE', description: 'A dark romance with sex scenes.', categories: ['Fiction'] })] }));
  assert.deepEqual((await searchBooksLive('colleen hoover', { local: false, final: true })).map(b => b.title), []);
});

test('a book on your own shelf comes ahead of an equally good match you do not have', () => {
  reset();
  const mine = [book({ id: 'mine1', title: 'Verity', author: 'Colleen Hoover' })];
  assert.equal(searchLocal('verity', '', 10, mine)[0].id, 'mine1');
});

test('sort and filter the results: newest, top rated, most rated, genre, cover, rated', () => {
  const a = book({ id: 'a', title: 'A', year: '2010', genre: 'Fantasy', ratingAverage: 4.8, ratingCount: 5, coverUrl: 'x' });
  const b = book({ id: 'b', title: 'B', year: '2024', genre: 'Romance', ratingAverage: 4.2, ratingCount: 9000 });
  const c = book({ id: 'c', title: 'C', year: '', genre: 'Fantasy', coverId: 3 });
  const all = [a, b, c];
  assert.deepEqual(applySearchView(all, DEFAULT_SEARCH_VIEW).map(x => x.id), ['a', 'b', 'c'], 'the default view changes nothing');
  assert.deepEqual(applySearchView(all, { ...DEFAULT_SEARCH_VIEW, sort: 'newest' }).map(x => x.id), ['b', 'a', 'c'], 'no year sorts last');
  assert.deepEqual(applySearchView(all, { ...DEFAULT_SEARCH_VIEW, sort: 'popular' }).map(x => x.id), ['b', 'a', 'c']);
  assert.deepEqual(applySearchView(all, { ...DEFAULT_SEARCH_VIEW, sort: 'rating' }).map(x => x.id)[0], 'b', 'a 4.8 from 5 votes does not beat 4.2 from 9000');
  assert.deepEqual(applySearchView(all, { ...DEFAULT_SEARCH_VIEW, genre: 'fantasy' }).map(x => x.id), ['a', 'c']);
  assert.deepEqual(applySearchView(all, { ...DEFAULT_SEARCH_VIEW, coverOnly: true }).map(x => x.id), ['a', 'c']);
  assert.deepEqual(applySearchView(all, { ...DEFAULT_SEARCH_VIEW, ratedOnly: true }).map(x => x.id), ['a', 'b']);
  assert.deepEqual(genreOptions(all), ['Fantasy', 'Romance']);
});

/* ---------- Title / Author selector, totals, paging, published filter ---------- */

test('Title scope searches titles only (Open Library title field) and keeps only books whose title matches', async () => {
  reset();
  const seen = mockFetch(url => (url.hostname === 'openlibrary.org'
    ? { numFound: 584, docs: [ol('OL1W', 'The Threshing', 'A. Writer'), ol('OL2W', 'Farm Life', 'Threshing Smith')] } // the second matches only through its author
    : { items: [gb('g1', { title: 'Threshing Floor Stories', authors: ['B. Writer'] }), gb('g2', { title: 'Unrelated', authors: ['C. Writer'], description: 'threshing threshing threshing' })] }));
  const found = await searchBooksLive('threshing', { scope: 'title', limit: 20, local: false });
  const titles = found.map(b => b.title);
  assert.deepEqual(titles.sort(), ['The Threshing', 'Threshing Floor Stories'].sort(), `only title matches: ${titles.join(' | ')}`);
  assert.ok(seen.some(u => u.hostname === 'openlibrary.org' && u.searchParams.get('title') === 'threshing*' && !u.searchParams.get('q')));
});

test('Author scope treats everything typed as an author and keeps only that author\'s books', async () => {
  reset();
  const seen = mockFetch(url => (url.hostname === 'openlibrary.org'
    ? { numFound: 90, docs: [ol('OL1W', 'Emma', 'Jane Austen'), ol('OL2W', 'Jane Austen: A Life', 'Carol Shields')] }
    : { items: [gb('g1', { title: 'Persuasion', authors: ['Jane Austen'] })] }));
  const found = await searchBooksLive('jane aust', { scope: 'author', limit: 20, local: false });
  assert.deepEqual(found.map(b => b.title).sort(), ['Emma', 'Persuasion']);
  assert.ok(seen.some(u => u.searchParams.get('author') === 'jane aust'));
  // the same words in the All scope are not split off as a title
  assert.equal(searchLocal('jane', '', 10, [book({ id: 'x', title: 'Jane Eyre', author: 'Charlotte Bronte' })], 'author').length, 0, 'a title word is not an author match');
  assert.equal(searchLocal('bronte', '', 10, [book({ id: 'x', title: 'Jane Eyre', author: 'Charlotte Bronte' })], 'author').length, 1);
  assert.equal(searchLocal('bronte', '', 10, [book({ id: 'x', title: 'Jane Eyre', author: 'Charlotte Bronte' })], 'title').length, 0, 'an author word is not a title match');
});

test('the progress reports how many books the catalog says match (Open Library\'s count, else Google\'s)', async () => {
  reset();
  mockFetch(url => (url.hostname === 'openlibrary.org' ? { numFound: 584, docs: [ol('OL1W', 'The Threshing', 'A. Writer')] } : { totalItems: 900, items: [gb('g1', { title: 'Threshing', authors: ['B'] })] }));
  const totals: number[] = [];
  await searchBooksLive('threshing', { local: false, onUpdate: (_b, p) => totals.push(p.total) });
  assert.equal(totals[totals.length - 1], 584);
  reset();
  mockFetch(url => (url.hostname === 'openlibrary.org' ? { docs: [] } : { totalItems: 900, items: [gb('g1', { title: 'Threshing', authors: ['B'] })] }));
  const t2: number[] = [];
  await searchBooksLive('threshing', { local: false, onUpdate: (_b, p) => t2.push(p.total) });
  assert.equal(t2[t2.length - 1], 900);
});

test('a later page asks each source for its next batch and never repeats books already shown', async () => {
  reset();
  const seen = mockFetch(url => (url.hostname === 'openlibrary.org'
    ? { numFound: 584, docs: url.searchParams.get('page') === '2' ? [ol('OL1W', 'The Threshing', 'A. Writer'), ol('OL7W', 'Threshing Days', 'D. Writer')] : [ol('OL1W', 'The Threshing', 'A. Writer')] }
    : { items: [] }));
  const first = await searchBooksLive('threshing', { local: false, limit: 20 });
  const second = await searchBooksLive('threshing', { local: false, limit: 20, page: 2, exclude: first });
  assert.deepEqual(second.map(b => b.title), ['Threshing Days']);
  assert.ok(seen.some(u => u.hostname === 'openlibrary.org' && u.searchParams.get('page') === '2'));
  assert.ok(seen.every(u => u.hostname === 'openlibrary.org' || u.searchParams.get('startIndex') === null || Number(u.searchParams.get('startIndex')) > 0));
});

test('"published within" keeps recent books and leaves out books with no year', () => {
  const now = new Date().getFullYear();
  const recent = book({ id: 'r', title: 'R', year: String(now - 1) });
  const old = book({ id: 'o', title: 'O', year: '1999' });
  const none = book({ id: 'n', title: 'N', year: '' });
  assert.deepEqual(applySearchView([recent, old, none], { ...DEFAULT_SEARCH_VIEW, years: 5 }).map(b => b.id), ['r']);
  assert.deepEqual(applySearchView([recent, old, none], DEFAULT_SEARCH_VIEW).length, 3);
});

test('a report with the word in its title AND its author never beats the book with that exact title ("Threshing")', () => {
  const exact = book({ title: 'Threshing', author: 'Faye Reineberg Holt', ratingCount: 0, ratingAverage: 0 });
  const day = book({ title: 'Threshing Day', author: 'Somebody Else' });
  const report = book({ title: 'The 2000 Import and Export Market for Harvesting and Threshing Machinery', author: 'The Harvesting and Threshing Machinery Research Group', coverUrl: undefined });
  const reportWithCover = { ...report, coverUrl: 'https://example.test/c.jpg', ratingCount: 50, ratingAverage: 4 };
  const s = (b: any) => searchRelevance(b, 'threshing', '', true);
  assert.ok(s(exact) > s(day), 'the exact title comes first');
  assert.ok(s(day) > s(report), 'a title that starts with the word beats one that merely contains it');
  assert.ok(s(exact) > s(reportWithCover) && s(day) > s(reportWithCover));
});

test('a well-rated book that merely starts with the word does not pass an exact title ("Verity")', () => {
  const exact = book({ title: 'Verity', author: 'Colleen Hoover' });
  const famous = book({ title: 'Verity Lambert: A Life in Television', author: 'Verity Lambert', ratingAverage: 4.8, ratingCount: 50000, coverUrl: 'https://example.test/c.jpg' });
  assert.ok(searchRelevance(exact, 'verity', '', true) > searchRelevance(famous, 'verity', '', true));
});

test('both same-title Witch books remain visible, and metadata cannot lift a subtitle above either exact title', () => {
  const freida = book({ id: 'freida', title: 'The Witch', author: 'Freida McFadden', ratingCount: 20, ratingAverage: 3.8 });
  const marie = book({ id: 'marie', title: 'The Witch', author: 'Marie Ndiaye', ratingCount: 10, ratingAverage: 3.7 });
  const subtitle = book({ id: 'subtitle', title: 'The Witch: A Novel', author: 'Another Author', ratingCount: 50000, ratingAverage: 4.9, coverUrl: 'https://example.test/c.jpg', pageCount: 500, year: '2025' });
  const found = rank([subtitle, marie, freida], parseQuery('The Witch'), 10);
  assert.deepEqual(new Set(found.slice(0, 2).map(b => b.id)), new Set(['freida', 'marie']));
  assert.ok(found.indexOf(subtitle) > found.indexOf(freida));
  assert.ok(found.indexOf(subtitle) > found.indexOf(marie));
});

test('title search normalization keeps non-Latin text usable through the shared identity normalizer', () => {
  const japanese = book({ id: 'jp', title: '変な絵', author: 'Uketsu' });
  assert.deepEqual(searchLocal('変な絵', '', 10, [japanese], 'title').map(b => b.id), ['jp']);
});

test('Author scope keeps a provider candidate with missing author metadata as an uncertain result', () => {
  const unknown = book({ id: 'unknown-author', title: 'The Witch', author: 'Unknown Author' });
  const found = rank([unknown], parseQuery('Freida McFadden', '', true, 'author'), 10);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, unknown.id);
});

test('market-report spam and "study guide" editions rank far down unless asked for', () => {
  const real = book({ title: 'Threshing', author: 'A' });
  const spam = book({ title: 'The 2000 World Forecasts of Harvesting and Threshing', author: 'B' });
  assert.ok(searchRelevance(real, 'threshing', '', true) - searchRelevance(spam, 'threshing', '', true) > 60);
});

import { parseQuery } from './query';
test('an ISBN is recognised from every scope, and Keywords searches subjects', () => {
  for (const scope of ['all', 'title', 'author', 'keywords'] as const) assert.equal(parseQuery('978-0-8021-4853-7', '', true, scope).isbn, '9780802148537');
  assert.equal(parseQuery('cozy mystery', '', true, 'keywords').keywords, true);
});
