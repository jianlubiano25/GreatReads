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
  await import('./sources/appleCharts');
  await import('../store/bestsellers');
  await import('../store/curated');
  const keys = clearableCacheKeys();
  for (const k of ['readlife.curated2', 'readlife.top15', 'readlife.appleCharts1', 'readlife.resolvedmiss1', 'readlife.coverFix1', 'readlife.coverNone3', 'readlife.resolved1', 'readlife.meta4']) {
    assert.ok(keys.includes(k), `${k} should be clearable`);
  }
  assert.ok(!keys.includes('readlife.v2') && !keys.includes('readlife.storeprefs1'), 'your own data and settings must never be on the cleanup list');
});
