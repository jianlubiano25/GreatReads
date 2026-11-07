import test from 'node:test';
import assert from 'node:assert/strict';
import { startFillGenres, getFillState, resetFillForTests } from './fillGenres';

test('fill genres runs to the end in the background, tallies results, and stops at a non-admin device', async () => {
  resetFillForTests();
  const gs: any[] = ['a', 'b', 'c'].map(l => ({ label: l, query: l, subgenres: [] }));
  const seen: string[] = [];
  const p = startFillGenres(gs, async g => { seen.push(g.label); assert.equal(getFillState().running, true); return g.label === 'b' ? 'failed' : 'filled'; }, 0);
  void startFillGenres(gs, async () => 'filled', 0); // a second start while running does nothing
  await p;
  assert.deepEqual(seen, ['a', 'b', 'c']);
  assert.equal(getFillState().running, false);
  assert.match(getFillState().note, /2 added.*1 failed \(b\)/);
  resetFillForTests();
  await startFillGenres(gs, async () => 'not-admin', 0);
  assert.match(getFillState().note, /Not an admin/);
});
