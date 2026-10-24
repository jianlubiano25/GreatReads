// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; } };

import { getRefreshAllState, startRefreshAll, resetRefreshAllForTests } from './refreshAll';
import { DATA_VERSION, refreshDataForNewBuild } from '../refreshApp';
import type { ManualResult } from './refresh';

test('Refresh all shelves is a job of the app: progress is readable at any time and a second start joins it', async () => {
  resetRefreshAllForTests();
  const gates: Array<() => void> = [];
  const results: ManualResult[] = ['updated', 'unchanged', 'cooldown', 'failed'];
  let calls = 0;
  const one = (_id: string) => new Promise<ManualResult>(res => { const r = results[calls++]; gates.push(() => res(r)); });
  const job = startRefreshAll(['a', 'b', 'c', 'd'], 1, one);
  assert.deepEqual([getRefreshAllState().running, getRefreshAllState().done, getRefreshAllState().total, getRefreshAllState().currentId], [true, 0, 4, 'a']);
  // the panel closing / reopening changes nothing: the state is not owned by a screen
  gates[0](); await new Promise(r => setImmediate(r));
  assert.deepEqual([getRefreshAllState().running, getRefreshAllState().done, getRefreshAllState().currentId], [true, 1, 'b']);
  await startRefreshAll(['x', 'y'], 0, one); // already running: ignored
  assert.equal(calls, 2);
  gates[1](); await new Promise(r => setImmediate(r));
  gates[2](); await new Promise(r => setImmediate(r));
  gates[3](); await job;
  const s = getRefreshAllState();
  assert.equal(s.running, false);
  assert.equal(s.done, 4);
  assert.equal(s.noteFresh, true);
  assert.match(s.note, /1 updated, 1 already up to date, 1 checked recently, 1 could not update.*Hidden shelves were not refreshed/);
  assert.equal(s.notes.a, 'Updated with new books');
  assert.equal(s.notes.d, 'Could not update; your saved list is kept');
  setTimeout(() => {}, 0);
});

test('a shelf that throws is counted as failed and the run goes on', async () => {
  resetRefreshAllForTests();
  await startRefreshAll(['a', 'b'], 0, async id => { if (id === 'a') throw new Error('x'); return 'updated'; });
  assert.match(getRefreshAllState().note, /1 updated.*1 could not update/);
  assert.equal(getRefreshAllState().done, 2);
});

test('a new build keeps what the old build downloaded; only a data-version change forgets it, once, and never touches your data', async () => {
  await import('../books/localIndex'); await import('./genreRows'); // register their caches as re-downloadable
  store.clear();
  store.set('readlife.v2', '{"customBooks":[1]}');
  store.set('readlife.resolved3', '{"x":1}');
  store.set('readlife.genregems1', '{"pop":1}');
  store.set('readlife.seen1', '{"a":1}');
  assert.equal(refreshDataForNewBuild('dev'), false);
  assert.equal(store.has('readlife.resolved3'), true);
  // a device with no marker (fresh install) or an old build id (written by earlier builds): nothing was saved under another data version
  assert.equal(refreshDataForNewBuild('build-aaa'), false);
  assert.equal(store.get('readlife.dataBuild1'), `data:${DATA_VERSION}`);
  store.set('readlife.dataBuild1', 'build-old');
  assert.equal(refreshDataForNewBuild('build-aaa'), false);
  assert.equal(store.get('readlife.dataBuild1'), `data:${DATA_VERSION}`);
  // new deploys: everything downloaded stays, including the Hidden Gems lists and the on-device search index
  for (const build of ['build-bbb', 'build-ccc', 'build-ddd']) assert.equal(refreshDataForNewBuild(build), false);
  for (const key of ['readlife.resolved3', 'readlife.genregems1', 'readlife.seen1']) assert.equal(store.has(key), true, key);
  // a rule changed (data version bumped): forgotten once, never your own data
  store.set('readlife.dataBuild1', `data:${DATA_VERSION - 1}`);
  assert.equal(refreshDataForNewBuild('build-eee'), true);
  assert.equal(store.has('readlife.resolved3'), false);
  assert.equal(store.has('readlife.genregems1'), false);
  assert.equal(store.get('readlife.v2'), '{"customBooks":[1]}');
  store.set('readlife.resolved3', '{"y":1}'); // downloaded again
  assert.equal(refreshDataForNewBuild('build-eee'), false); // same version: nothing, never a loop
  assert.equal(store.has('readlife.resolved3'), true);
});
