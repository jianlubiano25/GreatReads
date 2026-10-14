// Run with: npm test
// Google Books: the strict intitle:"..." inauthor:"..." search often returns 0 volumes although a plain "Title Author" search returns many.
// After the strict attempts find nothing, ONE loose search is tried, with the same title / author filter.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { findGoogle, findGoogleRating } from './sources/googleBooks';
import { routeFetch } from '../store/testkit';

const gbItem = (id: string, title: string, author: string, extra: any = {}) => ({ id, volumeInfo: { title, authors: [author], publishedDate: '1965', pageCount: 412, ...extra } });
const google = (u: URL) => u.hostname === 'www.googleapis.com';
const q = (u: URL) => u.searchParams.get('q') || '';
const strict = (u: URL) => q(u).includes('intitle:');
const googleQueries = (calls: string[]) => calls.filter(c => c.includes('googleapis.com')).map(c => new URL(c).searchParams.get('q') || '');

test('strict search empty + loose search returns a rated matching volume: that rating is used, with one extra request', async () => {
  const calls = routeFetch([u => (google(u) ? (strict(u) ? { body: { totalItems: 0 } } : { body: { items: [
    gbItem('o1', 'Dune Messiah', 'Frank Herbert', { averageRating: 3.0, ratingsCount: 9999 }), // another book: must not lend its rating
    gbItem('o2', 'Dune', 'Someone Else', { averageRating: 2.0, ratingsCount: 5000 }), // right title, wrong author
    gbItem('d1', 'Dune', 'Frank Herbert'), // unrated edition
    gbItem('d2', 'Dune', 'Frank Herbert', { averageRating: 4.5, ratingsCount: 120 }),
    gbItem('d3', 'Dune', 'Frank Herbert', { averageRating: 4.4, ratingsCount: 80 }),
  ] } }) : undefined)]);
  const r = await findGoogleRating({ title: 'Dune', author: 'Frank Herbert' });
  assert.deepEqual([r.hit?.book.ratingAverage, r.hit?.book.ratingCount, r.hit?.book.identity?.gbVolume, r.failed], [4.5, 120, 'd2', false]); // best-rated MATCHING edition
  const queries = googleQueries(calls);
  assert.equal(queries.filter(x => !x.includes('intitle:')).length, 1); // exactly one loose search
  assert.equal(queries[queries.length - 1], 'Dune Frank Herbert'); // it is the plain "Title Author" query, tried last
});

test('the loose fallback keeps the title / author filter: unrelated volumes never lend a rating', async () => {
  routeFetch([u => (google(u) ? (strict(u) ? { body: { totalItems: 0 } } : { body: { items: [gbItem('x1', 'Dune Messiah', 'Frank Herbert', { averageRating: 4.8, ratingsCount: 900 }), gbItem('x2', 'Dune', 'Brian Herbert', { averageRating: 4.1, ratingsCount: 50 })] } }) : undefined)]);
  const r = await findGoogleRating({ title: 'Dune', author: 'Frank Herbert' });
  assert.deepEqual([r.hit, r.failed], [null, false]); // a successful "no rating", not an error
});

test('the loose fallback is not used when the strict search already found a rating, nor after an API outage', async () => {
  const calls = routeFetch([u => (google(u) ? { body: { items: [gbItem('s1', 'Strict Alpha', 'Ann Author', { averageRating: 4.0, ratingsCount: 30 })] } } : undefined)]);
  assert.equal((await findGoogleRating({ title: 'Strict Alpha', author: 'Ann Author' })).hit?.book.ratingCount, 30);
  assert.equal(googleQueries(calls).filter(x => !x.includes('intitle:')).length, 0);

  const down = routeFetch([u => (google(u) ? { status: 429, body: {} } : undefined)]);
  const r = await findGoogleRating({ title: 'Down Alpha', author: 'Ann Author' });
  assert.deepEqual([r.hit, r.failed], [null, true]);
  assert.equal(googleQueries(down).filter(x => !x.includes('intitle:')).length, 0); // no extra request when Google is rate limited
});

test('findGoogle (covers / metadata): strict empty + loose finds the book; an exact-ISBN gap search stays capped', async () => {
  const calls = routeFetch([u => (google(u) ? (strict(u) ? { body: { totalItems: 0 } } : q(u).startsWith('isbn:') ? { body: { items: [gbItem('i1', 'Dune', 'Frank Herbert')] } } : { body: { items: [gbItem('d9', 'Dune', 'Frank Herbert', { imageLinks: { thumbnail: 'http://img/dune.jpg' }, description: 'A'.repeat(120) })] } }) : undefined)]);
  const found = await findGoogle({ title: 'Dune', author: 'Frank Herbert' });
  assert.equal(found?.book.identity?.gbVolume, 'd9');
  assert.equal(googleQueries(calls).filter(x => !x.includes('intitle:')).length, 1);

  // an exact-ISBN volume that is sparse: still at most ONE search for gaps (the strict one), no loose search on top
  const capped = routeFetch([u => (google(u) ? (q(u).startsWith('isbn:') ? { body: { items: [gbItem('i2', 'Dune', 'Frank Herbert')] } } : { body: { totalItems: 0 } }) : undefined)]);
  await findGoogle({ title: 'Dune', author: 'Frank Herbert', isbn: '9780306406157' });
  assert.equal(googleQueries(capped).length, 2); // the ISBN lookup + one strict gap search
});
