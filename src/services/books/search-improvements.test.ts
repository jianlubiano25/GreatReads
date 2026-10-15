// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { searchBooksLive, searchLocal, searchRelevance, forgetRecentSearchesForTests } from './search';
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
