// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; } };

import { getRefreshAllState, startRefreshAll, resetRefreshAllForTests } from './refreshAll';
import { refreshDataForNewBuild } from '../refreshApp';
import { registerClearableKey } from '../books/cache';
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

test('an update keeps the downloads (genre lists, provider answers); they are forgotten once when DATA_EPOCH changes, never on every build, and your data is never touched', () => {
  store.set('readlife.v2', '{"customBooks":[1]}');
  store.set('readlife.resolved3', '{"x":1}');
  registerClearableKey('readlife.genrepool1'); // as genreRows.ts does when it is loaded
  store.set('readlife.genrepool1', '{"fantasy":{"t":1,"v":[]}}');
  assert.equal(refreshDataForNewBuild('dev'), false);
  assert.equal(store.has('readlife.resolved3'), true);
  assert.equal(refreshDataForNewBuild('build-aaa', 'epoch-1'), true); // first start with this epoch: forgotten once
  assert.equal(store.has('readlife.resolved3'), false);
  assert.equal(store.has('readlife.genrepool1'), false);
  assert.equal(store.get('readlife.v2'), '{"customBooks":[1]}');
  store.set('readlife.resolved3', '{"y":1}'); // downloaded again
  store.set('readlife.genrepool1', '{"fantasy":{"t":2,"v":[]}}');
  assert.equal(refreshDataForNewBuild('build-aaa', 'epoch-1'), false); // same build: nothing
  assert.equal(refreshDataForNewBuild('build-bbb', 'epoch-1'), false); // a NEW build, same epoch: nothing is wiped
  assert.equal(store.has('readlife.resolved3'), true);
  assert.equal(store.has('readlife.genrepool1'), true, 'the last good genre lists survive an ordinary update');
  assert.equal(refreshDataForNewBuild('build-ccc', 'epoch-2'), true); // the epoch was changed on purpose: once more
  assert.equal(store.has('readlife.genrepool1'), false);
  assert.equal(refreshDataForNewBuild('build-ddd', 'epoch-2'), false);
});
