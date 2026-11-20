// Run with: npx tsx --test src/services/store/fill-searches.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { fillSharedSearch, searchKey, FILL_SEARCH_MIN, POPULAR_SEARCHES, type FillSearchDeps } from './fillSearches';
import { startFillGenres, getFillState, resetFillForTests } from './fillGenres';

const books = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, title: `T${i}`, author: 'A' })) as any[];
const deps = (o: Partial<FillSearchDeps> & { wrote?: [string, number][] } = {}): FillSearchDeps => ({
  read: async () => null, search: async () => books(12), wait: async () => {}, write: async (k, b) => { o.wrote?.push([k, b.length]); return true; }, ...o,
});

test('the key is the one the search box uses; every popular search has a key and they are all different', () => {
  const keys = POPULAR_SEARCHES.map(searchKey);
  assert.ok(keys.every(Boolean));
  assert.equal(new Set(keys).size, keys.length);
});

test('a full answer is written under its key; a row that exists is left alone', async () => {
  const wrote: [string, number][] = [];
  assert.equal(await fillSharedSearch('Stephen King', deps({ wrote })), 'filled');
  assert.deepEqual(wrote, [[searchKey('Stephen King'), 12]]);
  assert.equal(await fillSharedSearch('Stephen King', deps({ wrote, read: async () => books(10) })), 'already');
  assert.equal(wrote.length, 1);
});

test('a thin answer is retried once, then reported failed and never written; a good second try is written', async () => {
  const wrote: [string, number][] = []; let n = 0;
  assert.equal(await fillSharedSearch('dune', deps({ wrote, search: async () => { n++; return books(FILL_SEARCH_MIN - 1); } })), 'failed');
  assert.equal(n, 2); assert.equal(wrote.length, 0);
  let m = 0;
  assert.equal(await fillSharedSearch('dune', deps({ wrote, search: async () => (++m === 1 ? [] : books(9)) })), 'filled');
  assert.equal(wrote.length, 1);
});

test('a search that throws is a failure, not a crash; a refused write means not an admin', async () => {
  assert.equal(await fillSharedSearch('dune', deps({ search: async () => { throw new Error('x'); } })), 'failed');
  assert.equal(await fillSharedSearch('dune', deps({ write: async () => false })), 'not-admin');
});

test('the admin run does the genres, then the searches, and reports both; a non-admin stops before the searches', async () => {
  resetFillForTests();
  const gs: any[] = ['a'].map(l => ({ label: l, query: l, subgenres: [] }));
  const seen: string[] = [];
  await startFillGenres(gs, async () => 'filled', 0, ['x', 'y'], async t => { seen.push(t); return t === 'y' ? 'failed' : 'filled'; });
  assert.deepEqual(seen, ['x', 'y']);
  assert.match(getFillState().note, /Searches: 1 added, 0 already there, 1 failed/);
  resetFillForTests();
  seen.length = 0;
  await startFillGenres(gs, async () => 'not-admin', 0, ['x'], async t => { seen.push(t); return 'filled'; });
  assert.deepEqual(seen, []);
  assert.match(getFillState().note, /Not an admin/);
});
