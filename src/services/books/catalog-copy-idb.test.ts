import test from 'node:test';
import assert from 'node:assert/strict';
const ls = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v), removeItem: (k: string) => void ls.delete(k), key: (i: number) => [...ls.keys()][i] ?? null, get length() { return ls.size; } };
import { setDurableBackendForTests, bigGet } from '../durableCopy';
import { loadCatalogCopy, applyCatalog, catalogCopy, flushCatalogCopyForTests } from './catalogCovers';
import { clearCaches } from './cache';

test('the published-catalog copy lives in IndexedDB (not localStorage): an old localStorage copy is moved once, writes go to IndexedDB, a clear reaches it', async () => {
  const idb = new Map<string, string>();
  setDurableBackendForTests({ put: async (k, v) => void idb.set(k, v), remove: async k => void idb.delete(k), getAll: async keys => Object.fromEntries(keys.filter(k => idb.has(k)).map(k => [k, idb.get(k)!])) });
  const work = (id: string, title: string) => ({ id, key: `${title.toLowerCase()}|a`, title, author: 'A', updatedAt: '2026-11-01T00:00:00Z', cover: 'https://covers.openlibrary.org/b/id/1-M.jpg' });
  ls.set('readlife.catalog1', JSON.stringify({ since: '2026-10-01T00:00:00Z', t: 1, works: { w1: work('w1', 'Dune') } }));

  await loadCatalogCopy();
  assert.equal(ls.has('readlife.catalog1'), false, 'localStorage space is freed');
  assert.ok(JSON.parse(idb.get('readlife.catalog1')!).works.w1, 'moved to IndexedDB');
  assert.equal(catalogCopy().works.w1.title, 'Dune', 'still readable at once');

  applyCatalog([work('w2', 'Emma')], '2026-11-01T00:00:00Z');
  await flushCatalogCopyForTests();
  assert.ok(JSON.parse((await bigGet('readlife.catalog1'))!).works.w2, 'new works are saved to IndexedDB');
  assert.equal(ls.has('readlife.catalog1'), false, 'and never to localStorage');

  clearCaches(['readlife.catalog1']);
  assert.equal(Object.keys(catalogCopy().works).length, 0, 'Refresh App & Data forgets the copy');
  await new Promise(r => setTimeout(r, 5));
  assert.equal(idb.has('readlife.catalog1'), false, 'in IndexedDB too');
  setDurableBackendForTests(undefined);
});
