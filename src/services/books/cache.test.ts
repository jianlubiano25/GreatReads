// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { clearableCacheKeys, persistentCache, registerClearableKey } from './cache';

test('every persistentCache registers its key for the storage-full cleanup', () => {
  persistentCache('readlife.testcache1', { ttl: 1000, max: 2 });
  assert.ok(clearableCacheKeys().includes('readlife.testcache1'));
});

test('raw-localStorage caches can register too, and old cache keys stay clearable', () => {
  registerClearableKey('readlife.rawtest1');
  const keys = clearableCacheKeys();
  assert.ok(keys.includes('readlife.rawtest1'));
  assert.ok(keys.includes('readlife.curated1'));
  assert.ok(keys.includes('readlife.curated2'));
});

test('the real app caches are all registered (curated2, top15, appleCharts1, resolvedmiss1, coverFix1)', async () => {
  (globalThis as any).localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  await import('./covers');
  await import('./resolve');
  await import('./details');
  await import('./infoStore');
  await import('./sources/nyt');
  await import('./sources/appleCharts');
  await import('../store/bestsellers');
  await import('../store/curated');
  const keys = clearableCacheKeys();
  for (const k of ['readlife.curated3', 'readlife.curated2', 'readlife.top15', 'readlife.appleCharts1', 'readlife.resolvedmiss1', 'readlife.coverFix1', 'readlife.coverNone4', 'readlife.resolved3', 'readlife.meta6', 'readlife.ratingsrc3', 'readlife.resolved2', 'readlife.meta5', 'readlife.ratingsrc2', 'readlife.resolved1', 'readlife.meta4', 'readlife.bookinfo1', 'readlife.nytgone1']) {
    assert.ok(keys.includes(k), `${k} should be clearable`);
  }
  assert.ok(!keys.includes('readlife.v2') && !keys.includes('readlife.storeprefs1'), 'your own data and settings must never be on the cleanup list');
});

import { freeSpaceThenRun } from './cache';
test('storage full: a failed cache save keeps the newest half; freeing space removes the biggest non-cover key first and stops when the save works', async () => {
  const data = new Map<string, string>();
  let limit = 1000;
  const used = () => [...data.entries()].reduce((n, [k, v]) => n + k.length + v.length, 0);
  (globalThis as any).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { const before = (data.get(k) ?? '').length; if (used() - before + v.length + k.length > limit) throw new Error('QuotaExceededError'); data.set(k, v); },
    removeItem: (k: string) => void data.delete(k), key: (i: number) => [...data.keys()][i] ?? null, get length() { return data.size; },
  };
  const { persistentCache, flushPersistentCaches } = await import('./cache');
  const c = persistentCache<string>('readlife.quotatest1', { ttl: 1e9, max: 100 });
  for (let i = 0; i < 40; i++) c.set('k' + i, 'x'.repeat(20));
  limit = 1200; // 40 entries (about 2000 chars) do not fit any more, 20 do
  flushPersistentCaches();
  const kept = Object.keys(JSON.parse(data.get('readlife.quotatest1') || '{}'));
  assert.ok(kept.length > 0 && kept.length < 40, 'trimmed, not lost');
  assert.ok(kept.includes('k39'), 'the newest entries are the ones kept');

  data.clear(); limit = 200;
  data.set('readlife.big', 'b'.repeat(120)); data.set('readlife.resolved3', 'r'.repeat(60));
  let tries = 0;
  const ok = freeSpaceThenRun(() => { tries++; localStorage.setItem('readlife.v2', 'u'.repeat(50)); }, ['readlife.big', 'readlife.resolved3']);
  assert.equal(ok, true);
  assert.equal(data.has('readlife.big'), false, 'the big ordinary cache goes first');
  assert.equal(data.has('readlife.resolved3'), true, 'cover memory is kept when that was enough');
  assert.equal(tries, 1);
});
