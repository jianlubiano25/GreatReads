// Run with: npm test
// Vine regressions: the stroke ends where the leaves end (also in browsers that ignore pathLength), and the vine look choice.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildVine, vineLeaves, stemEnd, vineLights, type VineGeometry } from './vinePath';
import { VineDrawing, ClassicVineDrawing, clip, CLASSIC_PTS, CLASSIC_LEAVES } from '../components/VineOverlay';
import { vineForDays } from './garden';
import { getVineStyle, setVineStyle, subscribeVineStyle } from './nookPrefs';

const G: VineGeometry = {
  frame: { x: 12, y: 12, w: 109, h: 145 }, wood: 5, radius: 54, width: 390,
  bottom: { x0: 140, x1: 370, y: 153 }, top: { x0: 140, x1: 370, y: 100 },
};
const vine = buildVine(G);
const parts = vineLeaves(vine);
const draw = (shown: number) => renderToStaticMarkup(React.createElement(VineDrawing, { vine, parts, width: G.width, shown, animate: false }));
// The nook stem is real geometry (a shortened path), not a dash pattern: its length is the length of its polyline.
const stemD = (html: string): string | null => html.match(/<path d="([^"]+)"[^>]*stroke-width="2\.6"/)?.[1] ?? null;
const stemLen = (html: string): number | null => {
  const d = stemD(html);
  if (!d) return null;
  const pts = d.slice(1).split(' L').map(q => q.split(' ').map(Number));
  return pts.reduce((n, q, i) => (i ? n + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0), 0);
};
const dash = (html: string): [number, number] | null => {
  const m = html.match(/stroke-dasharray="([\d.]+) ([\d.]+)"/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

test('the stem is real geometry that stops at the growing tip: no dash pattern or pathLength for a browser to get wrong (Safari)', () => {
  for (const shown of [0.06, 0.2, 0.4867, 0.7, 0.95, 1]) {
    const html = draw(shown);
    assert.ok(!/pathLength|stroke-dasharray/i.test(html), 'nothing browser-specific is needed to clip the stem');
    const len = stemLen(html)!;
    assert.ok(len <= Math.min(shown, 1) * vine.length + 5, 'the stem never runs ahead of the growing tip');
    assert.ok(Math.min(shown, 1) * vine.length - len < 23 * 1.5, `the stem ends at the last leaf, at most a leaf gap behind the tip (${shown})`);
  }
});

test('nothing is drawn for the stroke before the vine has started growing (no dot at either end)', () => {
  assert.ok(!stemD(draw(0)), 'no stroke at 0');
  assert.ok(!stemD(draw(vineForDays(0))), 'earned growth of zero draws nothing on its own (the starter sprout is added by the layer)');
  assert.ok(stemD(draw(vineForDays(1))), 'the first goal-met day starts the stem');
});

test('after 14 goal-met days the stroke ends where the last leaf is, never out along the shelves', () => {
  const shown = vineForDays(14);
  const visible = parts.filter(l => shown >= l.t - 0.004);
  const last = visible[visible.length - 1];
  assert.ok(last && shown - last.t < (23 * 1.1) / vine.length, 'the last visible leaf sits right at the growing tip');
  assert.equal(stemEnd(parts, shown, 0.004), last.t, 'the stem ends at that leaf');
  assert.ok(parts.filter(l => l.t > shown + 0.004).length > 0, 'the rest of the vine, with its leaves, is still to come');
  const on = stemLen(draw(shown))!;
  const stroked = vine.at(on / vine.length);
  assert.ok(Math.hypot(last.x - stroked.x, last.y - stroked.y) < 1, 'the stroke ends exactly where the last leaf is attached');
  assert.ok(on < vine.length * vine.bottomEnd, 'at 14 days the top shelf has no vine yet');
});

test('leg ends and leaf positions are measured along the drawn path, so the full length ends on the last point', () => {
  assert.ok(vine.windowEnd > 0 && vine.windowEnd < vine.bottomEnd && vine.bottomEnd < 1);
  const end = vine.at(1), pts = vine.d.slice(1).split(' L').map(p => p.split(' ').map(Number));
  const lastPt = pts[pts.length - 1];
  assert.ok(Math.hypot(end.x - lastPt[0], end.y - lastPt[1]) < 0.01);
  assert.equal(vine.dTo(1), vine.d, 'the full stem is the whole path');
  assert.equal(vine.dTo(0), '', 'and nothing before it starts');
});

const classicHtml = (shown: number, growing = false) => renderToStaticMarkup(React.createElement(ClassicVineDrawing, { shown, animate: false, growing }));

test('the classic window vine: same growth, no pathLength, no stroke before it starts, never takes a tap', () => {
  const classic = (shown: number) => renderToStaticMarkup(React.createElement(ClassicVineDrawing, { shown, animate: false }));
  const count = (html: string, re: RegExp) => (html.match(re) || []).length;
  assert.ok(!/pathLength/i.test(classic(0.5)));
  assert.ok(!/stroke-dasharray/.test(classic(0)));
  const [on, off] = dash(classic(0.5))!;
  assert.ok(on > 0 && on + off > on * 2 - 1, 'gap is longer than the whole path');
  assert.ok(count(classic(0.2), /opacity:1/g) < count(classic(1), /opacity:1/g), 'leaves and flowers appear as it grows');
  assert.equal(count(classic(1), /opacity:1/g), CLASSIC_LEAVES.length + 5, '10 leaves and 5 flowers (the original classic look)');
  const html = classic(1);
  assert.match(html, /^<svg[^>]*class="[^"]*pointer-events-none/);
  assert.match(html, /^<svg[^>]*style="[^"]*pointer-events:none/);
  assert.ok(!/<(button|a|input)\b|onclick|tabindex/i.test(html));
});

test('the classic vine keeps its original look, just a little further left, and never clips', () => {
  const first = CLASSIC_PTS[0], last = CLASSIC_PTS[CLASSIC_PTS.length - 1];
  assert.deepEqual([first.x, first.y], [11, 128], 'the original start (14, 128), 3 units to the left');
  assert.ok(first.y > last.y && last.y < 20, 'still climbs from the bottom to the top, with the original sway');
  assert.equal(CLASSIC_LEAVES.length, 10);
  assert.match(classicHtml(1), /^<svg[^>]*style=\"[^\"]*overflow:\s*visible/, 'leaves leaning left are not cut off by the svg edge');
  // at rest the stem ends exactly at its last leaf; while growing it follows the tip
  const at = (shown: number, growing: boolean) => dash(classicHtml(shown, growing))![0];
  const lastLeaf = CLASSIC_LEAVES[3].t;
  assert.ok(Math.abs(at(lastLeaf + 0.04, false) - at(lastLeaf, false)) < 0.01, 'no bare stem past the last leaf at rest');
  assert.ok(at(lastLeaf + 0.04, true) > at(lastLeaf, false) + 1, 'but it keeps growing with the tip while animating');
});

test('seasonal looks share the nook vine\'s path and growth; fairy lights appear only along the grown stem and never take a tap', () => {
  const looks = ['nook', 'lights', 'halloween', 'christmas'] as const;
  const htmls = looks.map(look => renderToStaticMarkup(React.createElement(VineDrawing, { vine, parts, width: G.width, shown: 0.5, animate: false, look, twinkle: look === 'lights' })));
  assert.equal(new Set(htmls.map(h => stemD(h))).size, 1, 'the same stem length in every look');
  assert.ok(!/rl-twinkle/.test(htmls[0]) && /rl-twinkle/.test(htmls[1]), 'only the lit look has lights');
  assert.ok(!/rl-twinkle/.test(renderToStaticMarkup(React.createElement(VineDrawing, { vine, parts, width: G.width, shown: 0, animate: false, look: 'lights', twinkle: true }))), 'no lights before earned growth');
  const lights = vineLights(vine);
  assert.ok(lights.length > 5 && lights.every((b, i) => i === 0 || b.t > lights[i - 1].t));
  assert.ok(htmls[2].includes('#e8832a') && htmls[3].includes('#c0283d'), 'pumpkins for Halloween, berries for Christmas');
  for (const h of htmls) assert.ok(!/pointer-events:\s*(auto|all)/i.test(h) && !/<(button|a|input)\b/i.test(h));
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
    for (const style of ['lights', 'halloween', 'christmas'] as const) { setVineStyle(style); assert.equal(getVineStyle(), style); }
    off();
    setVineStyle('classic');
    assert.equal(seen, 5, 'unsubscribed listeners are not called');
  } finally {
    delete (globalThis as any).localStorage;
  }
});
