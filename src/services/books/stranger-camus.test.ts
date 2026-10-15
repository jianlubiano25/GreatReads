// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { searchBooksLive, forgetRecentSearchesForTests } from './search';
import { findOpenLibrary } from './sources/openLibrary';
import { titlesMatch } from './identity';
import { forgetSeenForTests } from './localIndex';

const CAMUS = { key: '/works/OL1230613W', title: 'L’étranger', author_name: ['Albert Camus'], first_publish_year: 1942, cover_i: 77, ratings_count: 900, ratings_average: 4.0 };

/** Open Library as observed: title= / author= fields find nothing, the plain q= finds the work. Google answers nothing. */
function mockOl() {
  const urls: URL[] = [];
  (globalThis as any).fetch = async (input: string) => {
    const url = new URL(String(input), 'https://example.test');
    urls.push(url);
    const isOl = url.hostname.includes('openlibrary.org') && url.pathname === '/search.json';
    const docs = isOl && url.searchParams.has('q') && !url.searchParams.has('title') ? [CAMUS] : [];
    return { ok: true, status: 200, json: async () => (isOl ? { numFound: docs.length, docs } : { totalItems: 0 }) };
  };
  return urls;
}

test('L’étranger answers to The Stranger / The Outsider, but unrelated titles stay apart', () => {
  assert.equal(titlesMatch('The Stranger', 'L’étranger'), true);
  assert.equal(titlesMatch('L’Etranger', 'The Outsider'), true);
  assert.equal(titlesMatch('The Stranger', 'The Outsider'), false); // two different English books
  assert.equal(titlesMatch('The Stranger', 'The Strangers'), false);
});

test('"The Stranger by Albert Camus" finds Camus’s work through the plain Open Library query', async () => {
  store.clear(); forgetRecentSearchesForTests(); forgetSeenForTests();
  const urls = mockOl();
  const books = await searchBooksLive('The Stranger by Albert Camus', { final: true, local: false });
  assert.ok(books.some(b => /Camus/.test(b.author) && /tranger/i.test(b.title)), JSON.stringify(books.map(b => [b.title, b.author])));
  assert.ok(urls.some(u => u.searchParams.has('q') && !u.searchParams.has('title') && /albert camus/i.test(u.searchParams.get('q') || '')));
});

test('findOpenLibrary falls back to the plain query when the field search is empty', async () => {
  mockOl();
  const hit = await findOpenLibrary({ title: 'The Stranger', author: 'Albert Camus' });
  assert.equal(hit?.book.coverId, 77);
  mockOl();
  assert.equal(await findOpenLibrary({ title: 'The Stranger', author: 'Someone Else' }), null); // author must still agree
});
