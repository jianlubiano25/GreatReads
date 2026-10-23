import test from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
};

import { genreRowSource } from './genreRows';
import { InsufficientShelfError } from './shelves';
import type { Book } from '../../types';

const query = 'identity-fixture-fantasy';
const insufficientQuery = 'identity-fixture-insufficient';
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
storage.set('readlife.genrepool1', JSON.stringify(saved(insufficientQuery, [gem('Fresh one'), gem('Fresh two')])));

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

test('a successful but insufficient fresh pool is distinguished from refresh failure', async () => {
  const source = genreRowSource({ ...genre, label: 'Insufficient fixture', query: insufficientQuery }, 'gems');
  assert.equal(source.cached(), null);
  await assert.rejects(source.load(() => {}), InsufficientShelfError);
});
