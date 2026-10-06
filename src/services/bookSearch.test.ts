// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { searchOnlineBooks, searchRelevance } from './bookSearch';

type Handler = (url: URL) => unknown;
function mockFetch(handler: Handler) {
  const calls: string[] = [];
  (globalThis as any).fetch = async (input: string) => {
    calls.push(String(input));
    const body = handler(new URL(String(input)));
    return { ok: body !== null, json: async () => body };
  };
  return calls;
}

const science = Array.from({ length: 10 }, (_, i) => ({
  key: `/works/OL${i}W`, title: i % 2 ? `Fruit Fly Genetics ${i}` : `The Fruit Fly: a Biology`, author_name: ['A. Scientist'], first_publish_year: 1990 + i,
}));
const novel = { id: 'abc123', volumeInfo: { title: 'Fruit Fly', authors: ['Josh Silver'], publishedDate: '2026-02-03', pageCount: 384, imageLinks: { thumbnail: 'http://books.google.com/x.jpg' } } };

test('a title-only search finds a brand-new book that only Google Books has', async () => {
  mockFetch(url => (url.hostname === 'openlibrary.org' ? { docs: science } : { items: [novel] }));
  const results = await searchOnlineBooks('Fruit Fly');
  assert.equal(results[0].title, 'Fruit Fly');
  assert.equal(results[0].author, 'Josh Silver');
  assert.equal(results[0].coverUrl, 'https://books.google.com/x.jpg');
});

test('title + author still works (what Add Book does)', async () => {
  mockFetch(url => (url.hostname === 'openlibrary.org' ? { docs: [] } : { items: [novel] }));
  const results = await searchOnlineBooks('Fruit Fly', 'Josh Silver');
  assert.equal(results[0].author, 'Josh Silver');
});

test('the same book from both sources becomes one result with the best of both', async () => {
  const ol = { docs: [{ key: '/works/OL9W', title: 'Fruit Fly', author_name: ['Josh Silver'], cover_i: 555, first_publish_year: 2026 }] };
  mockFetch(url => (url.hostname === 'openlibrary.org' ? ol : { items: [novel] }));
  const results = await searchOnlineBooks('fruit fly');
  assert.equal(results.filter(r => r.author === 'Josh Silver').length, 1);
  assert.equal(results[0].coverId, 555);
  assert.equal(results[0].pageCount, 384);
});

test('one source being down never hides the other', async () => {
  mockFetch(url => (url.hostname === 'openlibrary.org' ? null : { items: [novel] }));
  assert.equal((await searchOnlineBooks('Fruit Fly')).length, 1);
  mockFetch(url => (url.hostname === 'openlibrary.org' ? { docs: science } : null));
  assert.ok((await searchOnlineBooks('Fruit Fly')).length > 0);
});

test('typing an author name ranks that author first', () => {
  const silver = { title: 'Fruit Fly', author: 'Josh Silver' } as any;
  const other = { title: 'Silver Spoons', author: 'Someone Else' } as any;
  assert.ok(searchRelevance(silver, 'josh silver') > searchRelevance(other, 'josh silver'));
});

test('a cancelled search returns nothing', async () => {
  mockFetch(() => ({ docs: science }));
  const c = new AbortController();
  c.abort();
  assert.deepEqual(await searchOnlineBooks('Fruit Fly', '', 10, c.signal), []);
});
