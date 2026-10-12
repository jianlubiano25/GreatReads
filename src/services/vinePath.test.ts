import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVine, vineLeaves, type VineGeometry } from './vinePath';

const G: VineGeometry = {
  frame: { x: 12, y: 12, w: 109, h: 145 }, wood: 5, radius: 54, width: 390,
  bottom: { x0: 140, x1: 370, y: 153 }, top: { x0: 140, x1: 370, y: 100 },
};

test('the vine starts at the window\'s bottom-left, runs the frame, then the bottom shelf, then the top shelf', () => {
  const v = buildVine(G);
  const a = v.at(0), end = v.at(1);
  assert.ok(Math.abs(a.x - 14.5) < 1.5 && Math.abs(a.y - 154.5) < 1.5, 'starts at the frame\'s bottom-left corner');
  const top = v.at(v.windowEnd / 2);
  assert.ok(top.y < 40, 'the middle of the frame stretch is up over the arch');
  const onBottom = v.at((v.windowEnd + v.bottomEnd) / 2);
  assert.ok(Math.abs(onBottom.y - G.bottom.y) < 2 && onBottom.x > G.bottom.x0, 'then along the bottom board');
  assert.ok(Math.abs(end.y - G.top.y) < 2 && Math.abs(end.x - (G.top.x0 + 3)) < 2, 'and ends at the far end of the top board');
  assert.ok(0 < v.windowEnd && v.windowEnd < v.bottomEnd && v.bottomEnd < 1);
});

test('the vine stays on the frame\'s wood and inside the scene', () => {
  const v = buildVine(G);
  for (let i = 0; i <= 200; i++) {
    const p = v.at((i / 200) * v.windowEnd);
    const inside = p.x >= 12 && p.x <= 121 && p.y >= 12 && p.y <= 157;
    assert.ok(inside, `frame point ${i} (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) is on the window`);
    const left = Math.abs(p.x - 14.5) <= 2.2, right = Math.abs(p.x - 118.5) <= 2.2, arch = p.y < 12 + 60;
    assert.ok(left || right || arch, `frame point ${i} hugs the wood`);
  }
  for (let i = 0; i <= 400; i++) { const p = v.at(i / 400); assert.ok(p.x >= 0 && p.x <= G.width && p.y >= 0, 'inside the scene'); }
});

test('leaves sit along the whole vine, smaller on the shelves, and never move when the vine grows', () => {
  const v = buildVine(G);
  const leaves = vineLeaves(v);
  assert.ok(leaves.length > 12);
  assert.ok(leaves.some(l => l.t < v.windowEnd) && leaves.some(l => l.t > v.windowEnd && l.t < v.bottomEnd) && leaves.some(l => l.t > v.bottomEnd));
  assert.ok(leaves.filter(l => l.t > v.windowEnd).every(l => l.size < leaves[0].size));
  assert.deepEqual(vineLeaves(buildVine(G)), leaves);
  assert.ok(leaves.some(l => l.flower));
});

test('a window wider than its arch (flat top) and a level connector still give one continuous vine', () => {
  const v = buildVine({ ...G, frame: { x: 12, y: 12, w: 155, h: 207 }, radius: 60, bottom: { ...G.bottom, y: 219 }, top: { ...G.top, y: 160 } });
  assert.ok(v.length > 600 && v.d.startsWith('M') && !v.d.includes('NaN'));
});
