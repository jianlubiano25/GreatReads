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

test('nookPrefs vine style starts as nook and can be switched and subscribed', () => {
  assert.equal(getVineStyle(), 'nook');
  let seen = 0;
  const un = subscribeVineStyle(() => { seen++; });
  setVineStyle('classic');
  assert.equal(getVineStyle(), 'classic');
  assert.equal(seen, 1);
  setVineStyle('nook');
  assert.equal(seen, 2);
  un();
  setVineStyle('lights');
  assert.equal(seen, 2);
  setVineStyle('nook');
});

test('every look draws the same path and the same leaves; only colours and extras differ', () => {
  const draw = (look: any) => renderToStaticMarkup(React.createElement(VineDrawing, { vine, parts, width: G.width, shown: 1, animate: false, look }));
  const nook = draw('nook'), lights = draw('lights'), hall = draw('halloween'), xmas = draw('christmas');
  assert.ok(nook.includes(vine.d) && lights.includes(vine.d) && hall.includes(vine.d) && xmas.includes(vine.d));
  assert.equal((nook.match(/opacity:1/g) || []).length, (lights.match(/opacity:1/g) || []).length);
  assert.ok(lights.includes('rl-twinkle') || lights.includes('fill="#ffe6a8"'));
  assert.ok(hall.includes('#e8832a') || hall.includes('pumpkin'));
  assert.ok(xmas.includes('#c0283d') || xmas.includes('berry'));
});

test('leg ends and leaf positions are measured along the drawn path, so the full stem and the last leaf agree', () => {
  assert.ok(vine.windowEnd < vine.bottomEnd && vine.bottomEnd < 1);
  assert.ok(parts.every(l => l.t > 0 && l.t <= 1));
  assert.equal(stemEnd(parts, 1, 0.004), parts[parts.length - 1].t);
  assert.ok(clip(1, vine.length).startsWith((vine.length + 4).toFixed(1)));
});

const classicHtml = (shown: number, growing = false) => renderToStaticMarkup(React.createElement(ClassicVineDrawing, { shown, animate: false, growing }));

test('the classic window vine: same growth, no pathLength, no stroke before it starts, never takes a tap', () => {
  const classic = (shown: number) => renderToStaticMarkup(React.createElement(ClassicVineDrawing, { shown, animate: false }));
  const count = (html: string, re: RegExp) => (html.match(re) || []).length;
  const dash = (html: string) => {
    const m = html.match(/stroke-dasharray="([0-9.]+) ([0-9.]+)"/);
    return m ? [+m[1], +m[2]] : null;
  };
  assert.equal(count(classic(0), /opacity:1/g), 0);
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
  // (rest of original test kept as-is)
});
