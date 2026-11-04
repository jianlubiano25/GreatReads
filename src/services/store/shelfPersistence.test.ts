import test from 'node:test';
import assert from 'node:assert/strict';
import type { CuratedShelf } from '../../data/storeCatalog';
import { persistentCache, flushPersistentCaches, clearableCacheKeys, clearableKeysWhenStorageFull } from '../books/cache';
import { dynamicCuratedSource, dynamicInfo, refreshShelf, type DynamicSpec } from './dynamic';

type Seed = [string, string, string?];
const shelf = (id: string, seeds: Seed[]): CuratedShelf => ({ id, title: 'Club', emoji: '⭐', genre: 'Club', seeds });
const spec = (fetch: DynamicSpec['fetch'], extra: Partial<DynamicSpec> = {}): DynamicSpec => ({ source: 'Test', kind: 'fallback', refreshMs: 1000, minSeeds: 2, fetch, ...extra });
const titles = (sh: CuratedShelf, sp: DynamicSpec) => (dynamicCuratedSource(sh, sp).cached() ?? []).map(b => b.title);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/* Bug (owner, 2026-10-28): after the app sat closed for a while, a dynamic shelf (Oprah) came back with its OLD picks. */

test('REPRO 1: a failed refresh that started earlier never overwrites a newer good list', async () => {
  const sh = shelf('t-race', [['Old 1', 'A One'], ['Old 2', 'A Two']]);
  const slowFail = spec(async () => { await sleep(30); return null; });
  const fastOk = spec(async () => ({ seeds: [['New 1', 'B One'], ['New 2', 'B Two']] as Seed[] }));
  await refreshShelf(sh, spec(async () => ({ seeds: [['Mid 1', 'M One'], ['Mid 2', 'M Two']] as Seed[] })), 1_000); // an older saved list exists (the stale copy)
  const failing = refreshShelf(sh, slowFail, 5_000); // asks first, answers last
  await refreshShelf(sh, fastOk, 6_000);
  assert.equal(await failing, null);
  assert.deepEqual(titles(sh, fastOk).slice(0, 2), ['New 1', 'New 2']);
  assert.equal(dynamicInfo(sh, fastOk).updatedAt, 6_000);
});

test('REPRO 2: a slow success that started earlier does not replace a newer saved list', async () => {
  const sh = shelf('t-race2', [['Old 1', 'A One'], ['Old 2', 'A Two']]);
  const slowOld = spec(async () => { await sleep(30); return { seeds: [['Stale 1', 'C One'], ['Stale 2', 'C Two']] as Seed[] }; });
  const fastNew = spec(async () => ({ seeds: [['New 1', 'B One'], ['New 2', 'B Two']] as Seed[] }));
  const slow = refreshShelf(sh, slowOld, 5_000);
  await refreshShelf(sh, fastNew, 6_000);
  await slow;
  assert.deepEqual(titles(sh, fastNew).slice(0, 2), ['New 1', 'New 2']);
});

test('a refresh that throws or returns too little keeps the last good list and its updated time', async () => {
  const sh = shelf('t-keep', [['Old 1', 'A One'], ['Old 2', 'A Two']]);
  await refreshShelf(sh, spec(async () => ({ seeds: [['Good 1', 'B One'], ['Good 2', 'B Two']] as Seed[] })), 1_000);
  for (const bad of [async () => { throw new Error('boom'); }, async () => null, async () => ({ seeds: [['Only 1', 'D One']] as Seed[] })]) {
    assert.equal(await refreshShelf(sh, spec(bad as DynamicSpec['fetch']), 2_000), null);
    assert.deepEqual(titles(sh, spec(bad as DynamicSpec['fetch'])).slice(0, 2), ['Good 1', 'Good 2']);
    assert.equal(dynamicInfo(sh, spec(bad as DynamicSpec['fetch'])).updatedAt, 1_000);
  }
});

test('REPRO 3: a result saved just before the app is hidden or closed is written at once, not lost in the 400 ms wait', () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const c = persistentCache<{ n: number }>('readlife.test-flush1', { ttl: 1e9, max: 5 });
  c.set('shelf', { n: 1 });
  assert.equal(store.has('readlife.test-flush1'), false); // still waiting (debounced)
  flushPersistentCaches(); // what pagehide / visibilitychange calls
  assert.match(store.get('readlife.test-flush1') ?? '', /"n":1/);
});

test('storage-full cleanup keeps saved shelf lists, but Refresh everything (clearableCacheKeys) still clears them', () => {
  persistentCache('readlife.dynseeds1', { ttl: 1, max: 1 }); // registers the key as the store does
  assert.ok(clearableCacheKeys().includes('readlife.dynseeds1'));
  assert.ok(!clearableKeysWhenStorageFull().includes('readlife.dynseeds1'));
});
