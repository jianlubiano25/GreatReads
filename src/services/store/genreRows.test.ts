import test from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
};

import { genreRowSource } from './genreRows';
import { flushPersistentCaches } from '../books/cache';
import { InsufficientShelfError } from './shelves';
import type { Book } from '../../types';
import { SEARCH_GENRES } from '../../data/searchGenres';

const query = 'identity-fixture-fantasy';
const insufficientQuery = 'identity-fixture-insufficient';
const emptyQuery = 'identity-fixture-empty';
const oneQuery = 'identity-fixture-one';
const genre = { label: 'Identity fixture', emoji: '', query, kind: 'fiction' as const, subgenres: [] };
const gem = (title: string): Book => ({
  id: title, title, author: 'Test Author', shelf: 'mine', difficulty: 2, isOnDevice: false,
  genre: 'Fantasy', ratingAverage: 4.5, ratingCount: 100, year: '2020', summary: '', authorBio: '', pageCount: 300,
  coverUrl: `https://covers.example/${encodeURIComponent(title)}.jpg`,
});
const saved = (key: string, books: Book[], age = 0) => ({ [key]: { t: Date.now() - age, v: books } });

storage.set('readlife.genregems1', JSON.stringify({
  ...saved(query, [gem('Remembered one'), gem('Remembered two'), gem('Remembered three')], 2 * 24 * 60 * 60 * 1000),
  ...saved(insufficientQuery, [gem('Old one'), gem('Old two'), gem('Old three')], 2 * 24 * 60 * 60 * 1000),
}));
storage.set('readlife.genrepool1', JSON.stringify({
  ...saved(insufficientQuery, [gem('Fresh one'), gem('Fresh two')]),
  ...saved(emptyQuery, []),
  ...saved(oneQuery, [gem('Single eligible book')]),
}));

test('a failed refresh keeps the last eligible Hidden Gems shelf available offline', async () => {
  const source = genreRowSource(genre, 'gems');
  const before = source.cached();
  assert.equal(before?.length, 3);
  const currentFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    const loaded = await source.load(() => {});
    assert.deepEqual(loaded.map(book => book.title), before?.map(book => book.title));
  } finally {
    globalThis.fetch = currentFetch;
  }
});

test('a thinner successful refresh preserves its larger last-known-good Hidden Gems shelf', async () => {
  const source = genreRowSource({ ...genre, label: 'Insufficient fixture', query: insufficientQuery }, 'gems');
  assert.deepEqual(source.cached()?.map(book => book.title), ['Old one', 'Old two', 'Old three']);
  assert.deepEqual((await source.load(() => {})).map(book => book.title), ['Old one', 'Old two', 'Old three']);
});

test('a genre with one qualifying book remains available, while a genuinely empty genre has an empty state', async () => {
  const one = genreRowSource({ ...genre, label: 'Single fixture', query: oneQuery }, 'gems');
  const empty = genreRowSource({ ...genre, label: 'Empty fixture', query: emptyQuery }, 'gems');
  assert.deepEqual((await one.load(() => {})).map(book => book.title), ['Single eligible book']);
  assert.equal(empty.cached(), null);
  await assert.rejects(empty.load(() => {}), InsufficientShelfError);
});

test('genre gem pools and shelf caches are isolated by the genre query', async () => {
  assert.equal(new Set(SEARCH_GENRES.map(item => item.query)).size, SEARCH_GENRES.length, 'each supported genre has its own candidate-pool key');
  assert.equal(new Set(SEARCH_GENRES.map(item => `genre-gems-${item.label}`)).size, SEARCH_GENRES.length, 'each supported genre has its own shelf source');
  const fiction = genreRowSource({ ...genre, label: 'Fiction fixture', query: 'identity-fixture-fiction' }, 'gems');
  const nonfiction = genreRowSource({ ...genre, label: 'Nonfiction fixture', query: 'identity-fixture-nonfiction', kind: 'nonfiction' }, 'gems');
  assert.notEqual(fiction.id, nonfiction.id);
  assert.equal(fiction.cached(), null);
  assert.equal(nonfiction.cached(), null);
});

test('H1: an empty provider answer is not saved as the genre pool, so the next open tries again', async () => {
  const q = 'h1-fixture-classics';
  const g = { label: 'H1 fixture', emoji: '', query: q, subgenres: [] };
  const currentFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"docs":[],"items":[],"results":[],"numFound":0,"totalItems":0}', { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(() => genreRowSource(g, 'gems').load(() => {}));
  } finally {
    globalThis.fetch = currentFetch;
  }
  flushPersistentCaches();
  assert.equal(JSON.parse(storage.get('readlife.genrepool1') || '{}')[q], undefined);
});
