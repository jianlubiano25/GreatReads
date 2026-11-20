import test from 'node:test';
import assert from 'node:assert/strict';
const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
import { withFallbackRatings } from './genreRows';
import type { Book } from '../../types';

const book = (title: string, over: Partial<Book> = {}): Book => ({ id: title, title, author: 'A', genre: 'Fantasy', coverUrl: 'https://x.test/c.jpg', year: '2015', ...over } as Book);

test('a book without a rating gets Open Library\'s work rating when Google had none; real ratings are never replaced; no answer = still no rating', async () => {
  const asked: string[] = [];
  const books = [
    book('Has', { ratingAverage: 4.5, ratingCount: 100, ratingSource: 'google' }),
    book('Needs', { identity: { olWork: 'OL1W' } as any }),
    book('Fails', { identity: { olWork: 'OL2W' } as any }),
    book('NoId'),
  ];
  const out = await withFallbackRatings(books, async id => { asked.push(id); if (id === 'OL2W') throw new Error('timeout'); return { average: 4.3, count: 250 }; });
  assert.deepEqual(asked.sort(), ['OL1W', 'OL2W']);
  assert.equal(out[0].ratingAverage, 4.5);
  assert.equal(out[1].ratingAverage, 4.3);
  assert.equal(out[1].ratingSource, 'openlibrary');
  assert.equal(out[2].ratingAverage, undefined);
  assert.equal(out[3].ratingAverage, undefined);
});

test('at most 10 Open Library lookups per pool', async () => {
  let n = 0;
  await withFallbackRatings(Array.from({ length: 30 }, (_, i) => book('B' + i, { identity: { olWork: 'OL' + i + 'W' } as any })), async () => { n++; return null; });
  assert.equal(n, 10);
});
