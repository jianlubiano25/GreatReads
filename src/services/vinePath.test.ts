import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVine, vineLeaves, type VineGeometry } from './vinePath';

const G: VineGeometry = {
  frame: { x: 12, y: 12, w: 109, h: 145 }, wood: 5, radius: 54, width: 390,
  bottom: { x0: 140, x1: 370, y: 153 }, top: { x0: 140, x1: 370, y: 100 },
};

// The frame's inner wood line: left x 14.5, right x 118.5, top y 14.5, bottom y 154.5 (frame 12..121 x 12..157, wood 5)
const XL = 14.5, XR = 118.5, YB = 154.5;

test('the vine starts at the window\'s bottom-right and follows the exact route, in order', () => {
  const v = buildVine(G);
  assert.ok(0 < v.bottomEdgeEnd && v.bottomEdgeEnd < v.leftEnd && v.leftEnd < v.archEnd && v.archEnd < v.windowEnd && v.windowEnd < v.bottomEnd && v.bottomEnd < 1, 'the legs come one after another');

  const a = v.at(0);
  assert.ok(Math.abs(a.x - XR) < 1.5 && Math.abs(a.y - YB) < 1.5, 'starts at the frame\'s bottom-right corner');

  // 1) along the bottom edge, right to left
  let prev = a.x;
  for (let i = 1; i <= 40; i++) {
    const p = v.at((i / 40) * v.bottomEdgeEnd);
    assert.ok(Math.abs(p.y - YB) < 3.4, 'stays on the bottom edge');
    assert.ok(p.x <= prev + 0.8, 'moves leftwards');
    prev = p.x;
  }
  assert.ok(Math.abs(v.at(v.bottomEdgeEnd).x - XL) < 1.5, 'reaches the bottom-left corner');

  // 2) up the left side
  prev = YB + 1;
  for (let i = 1; i <= 40; i++) {
    const p = v.at(v.bottomEdgeEnd + (i / 40) * (v.leftEnd - v.bottomEdgeEnd));
    assert.ok(Math.abs(p.x - XL) < 3.4, 'stays on the left side');
    assert.ok(p.y <= prev + 0.8, 'moves upwards');
    prev = p.y;
  }

  // 3) over the arch, left to right
  prev = v.at(v.leftEnd).x;
  let minY = Infinity;
  for (let i = 1; i <= 60; i++) {
    const p = v.at(v.leftEnd + (i / 60) * (v.archEnd - v.leftEnd));
    assert.ok(p.x >= prev - 0.8, 'moves rightwards');
    prev = p.x;
    minY = Math.min(minY, p.y);
  }
  assert.ok(minY < 20 && Math.abs(prev - XR) < 3.4, 'goes over the top and ends on the right side');

  // 4) down the right side
  prev = v.at(v.archEnd).y;
  for (let i = 1; i <= 40; i++) {
    const p = v.at(v.archEnd + (i / 40) * (v.windowEnd - v.archEnd));
    assert.ok(Math.abs(p.x - XR) < 3.4, 'stays on the right side');
    assert.ok(p.y >= prev - 0.8, 'moves downwards');
    prev = p.y;
  }
  assert.ok(Math.abs(v.at(v.windowEnd).y - YB) < 1.5, 'back at the window\'s bottom-right');

  // 5) bottom shelf, then 6) top shelf
  const onBottom = v.at((v.windowEnd + v.bottomEnd) / 2);
  assert.ok(Math.abs(onBottom.y - G.bottom.y) < 25 && onBottom.x > XR, 'then out to the bottom shelf');
  const end = v.at(1);
  assert.ok(Math.abs(v.at(v.bottomEnd).y - G.bottom.y) < 2, 'the bottom shelf\'s board');
  assert.ok(Math.abs(end.y - G.top.y) < 2 && Math.abs(end.x - (G.top.x0 + 3)) < 2, 'and ends at the far end of the top board');
});

test('the sway is gentle and organic: it follows the wood, differs from a ruler line, and is the same every time', () => {
  const v = buildVine(G);
  let maxDev = 0, bends = 0;
  for (let i = 0; i <= 200; i++) maxDev = Math.max(maxDev, Math.abs(v.at((i / 200) * v.bottomEdgeEnd).y - YB));
  assert.ok(maxDev > 0.3, 'not a ruler line');
  assert.ok(maxDev < 3.4, 'but never leaves the wood');
  let last = 0;
  for (let i = 0; i <= 200; i++) { const d = Math.sign(v.at((i / 200) * v.bottomEdgeEnd).y - YB); if (d && last && d !== last) bends++; if (d) last = d; }
  assert.ok(bends >= 2, 'it sways across the edge a few times');
  for (let i = 1; i <= 400; i++) {
    const p = v.at((i - 1) / 400), q = v.at(i / 400);
    assert.ok(Math.hypot(q.x - p.x, q.y - p.y) < 6, 'no jumps or squiggles between neighbouring points');
  }
  assert.equal(buildVine(G).d, v.d, 'no randomness');
});

test('the vine stays on the frame\'s wood and inside the scene', () => {
  const v = buildVine(G);
  for (let i = 0; i <= 200; i++) {
    const p = v.at((i / 200) * v.windowEnd);
    const inside = p.x >= 11 && p.x <= 122 && p.y >= 11 && p.y <= 158; // the sway can brush the frame's outer edge
    assert.ok(inside, `frame point ${i} (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) is on the window`);
    const left = Math.abs(p.x - 14.5) <= 3.4, right = Math.abs(p.x - 118.5) <= 3.4, arch = p.y < 12 + 60, bottom = Math.abs(p.y - 154.5) <= 3.4;
    assert.ok(left || right || arch || bottom, `frame point ${i} hugs the wood`);
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
  assert.ok(leaves.some(l => l.flower), 'occasional flowers');
  assert.ok(leaves.some(l => l.shoot) && leaves.filter(l => l.shoot).length < leaves.length / 2, 'and shoots on some of them');
  assert.ok(leaves.filter(l => l.flower).length <= Math.ceil(leaves.length / 3), 'flowers stay occasional');
  assert.ok(leaves.some(l => l.t < v.bottomEdgeEnd), 'the first leaves are already on the bottom edge');
});

test('a window wider than its arch (flat top) and a level connector still give one continuous vine', () => {
  const v = buildVine({ ...G, frame: { x: 12, y: 12, w: 155, h: 207 }, radius: 60, bottom: { ...G.bottom, y: 219 }, top: { ...G.top, y: 160 } });
  assert.ok(v.length > 600 && v.d.startsWith('M') && !v.d.includes('NaN'));
});
