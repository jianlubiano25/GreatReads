// Run with: npm test
// Vine regressions: the stroke ends where the leaves end (also in browsers that ignore pathLength), and the vine look choice.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildVine, vineLeaves, type VineGeometry } from './vinePath';
import { VineDrawing, ClassicVineDrawing, clip } from '../components/VineOverlay';
import { vineForDays } from './garden';
import { getVineStyle, setVineStyle, subscribeVineStyle } from './nookPrefs';

const G: VineGeometry = {
  frame: { x: 12, y: 12, w: 109, h: 145 }, wood: 5, radius: 54, width: 390,
  bottom: { x0: 140, x1: 370, y: 153 }, top: { x0: 140, x1: 370, y: 100 },
};
const vine = buildVine(G);
const parts = vineLeaves(vine);
const draw = (shown: number) => renderToStaticMarkup(React.createElement(VineDrawing, { vine, parts, width: G.width, shown, animate: false }));
const dash = (html: string): [number, number] | null => {
  const m = html.match(/stroke-dasharray="([\d.]+) ([\d.]+)"/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

test('the stroke is clipped in real px and the dash pattern can never repeat along the vine (Safari ignores pathLength)', () => {
  for (const shown of [0.02, 0.2, 0.4867, 0.7, 0.95, 1]) {
    const html = draw(shown);
    assert.ok(!/pathLength/i.test(html), 'no pathLength: browsers that ignore it must still draw the same thing');
    const [on, off] = dash(html)!;
    assert.ok(Math.abs(on - Math.min(shown, 1) * vine.length) < 5, `dash is ${shown} of the real length`);
    assert.ok(on + off > vine.length, 'the next dash would start beyond the end of the path, so nothing is drawn past the dash');
  }
});

test('nothing is drawn for the stroke before the vine has started growing (no dot at either end)', () => {
  assert.ok(!/stroke-dasharray/.test(draw(0)), 'no stroke at 0');
  assert.ok(/stroke-dasharray/.test(draw(vineForDays(0))), 'the small initial growth still shows');
});

test('after 14 goal-met days the stroke ends where the last leaf is, never out along the shelves', () => {
  const shown = vineForDays(14);
  const visible = parts.filter(l => shown >= l.t - 0.004);
  const last = visible[visible.length - 1];
  assert.ok(last && shown - last.t < (23 * 1.1) / vine.length, 'the last visible leaf sits right at the growing tip');
  assert.ok(parts.filter(l => l.t > shown + 0.004).length > 0, 'the rest of the vine, with its leaves, is still to come');
  const [on] = dash(draw(shown))!;
  const tip = vine.at(shown);
  const stroked = vine.at(on / vine.length);
  assert.ok(Math.hypot(tip.x - stroked.x, tip.y - stroked.y) < 1, 'the stroke ends exactly at the tip the leaves are measured from');
  assert.ok(on < vine.length * vine.bottomEnd, 'at 14 days the top shelf has no vine yet');
});

test('leg ends and leaf positions are measured along the drawn path, so the full length ends on the last point', () => {
  assert.ok(vine.windowEnd > 0 && vine.windowEnd < vine.bottomEnd && vine.bottomEnd < 1);
  const end = vine.at(1), pts = vine.d.slice(1).split(' L').map(p => p.split(' ').map(Number));
  const lastPt = pts[pts.length - 1];
  assert.ok(Math.hypot(end.x - lastPt[0], end.y - lastPt[1]) < 0.01);
  assert.ok(clip(1, vine.length).startsWith((vine.length + 4).toFixed(1)));
});

test('the classic window vine: same growth, no pathLength, no stroke before it starts, never takes a tap', () => {
  const classic = (shown: number) => renderToStaticMarkup(React.createElement(ClassicVineDrawing, { shown, animate: false }));
  const count = (html: string, re: RegExp) => (html.match(re) || []).length;
  assert.ok(!/pathLength/i.test(classic(0.5)));
  assert.ok(!/stroke-dasharray/.test(classic(0)));
  const [on, off] = dash(classic(0.5))!;
  assert.ok(on > 0 && on + off > on * 2 - 1, 'gap is longer than the whole path');
  assert.ok(count(classic(0.2), /opacity:1/g) < count(classic(1), /opacity:1/g), 'leaves and flowers appear as it grows');
  assert.equal(count(classic(1), /opacity:1/g), 15, '10 leaves and 5 flowers');
  const html = classic(1);
  assert.match(html, /^<svg[^>]*class="[^"]*pointer-events-none/);
  assert.match(html, /^<svg[^>]*style="[^"]*pointer-events:none/);
  assert.ok(!/<(button|a|input)\b|onclick|tabindex/i.test(html));
});

test('the vine look is remembered on this device, defaults to the current nook vine, and tells the scene when it changes', () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  try {
    assert.equal(getVineStyle(), 'nook');
    let seen = 0;
    const off = subscribeVineStyle(() => seen++);
    setVineStyle('classic');
    assert.equal(getVineStyle(), 'classic');
    assert.equal(seen, 1);
    setVineStyle('nook');
    assert.equal(getVineStyle(), 'nook');
    assert.equal(store.size, 0, 'the default leaves nothing stored');
    store.set('greatreads_vine_style', 'garbage');
    assert.equal(getVineStyle(), 'nook', 'anything unknown means the current vine');
    off();
    setVineStyle('classic');
    assert.equal(seen, 2, 'unsubscribed listeners are not called');
  } finally {
    delete (globalThis as any).localStorage;
  }
});
