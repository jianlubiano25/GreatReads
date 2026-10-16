// Run with: npm test
// The Garden Nook vine: growth from the live streak, the opening animation, and that the drawing never takes a tap.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildVine, vineLeaves, stemEnd, tipIndex, vineShown, restAt, SPROUT_LEAVES, type VineGeometry } from './vinePath';
import { runReveal, revealValue, revealDuration, browserFrames, type FrameScheduler } from './vineReveal';
import { vineForDays, vineFor, emptyPeaks, emptyGarden, computeSnapshot, evaluateGarden, currentStreakFor, goalDaysFor } from './garden';
import { VineDrawing, CLASSIC_LEAVES, clip } from '../components/VineOverlay';

const G: VineGeometry = {
  frame: { x: 12, y: 12, w: 109, h: 145 }, wood: 5, radius: 54, width: 390,
  bottom: { x0: 140, x1: 370, y: 153 }, top: { x0: 140, x1: 370, y: 100 },
};
const vine = buildVine(G);
const parts = vineLeaves(vine);

/* ---------- growth follows the days you met your goal ---------- */

const logOf = (days: number[], pages = 12) => Object.fromEntries(days.map(d => [`2026-03-${String(d).padStart(2, '0')}`, pages]));

test('with no goal-met days (a blank account) nothing grows: no stem and no leaf, anywhere on the route', () => {
  const g0 = vineForDays(goalDaysFor({}, 10));
  assert.equal(g0, 0);
  assert.ok(parts.every(l => !(l.t - 0.004 <= g0)), 'no leaf, shoot or flower yet');
  assert.equal(stemEnd(parts, g0, 0.004), 0, 'and no stem');
  assert.ok(vineForDays(1) > 0 && parts.some(l => l.t - 0.004 <= vineForDays(1)), 'the first goal-met day starts it');
  assert.equal(goalDaysFor(logOf([1, 2], 5), 10), 0, 'days under the goal do not count');
});

test('every goal-met day grows the vine one step, with the same progression as the existing vineFor', () => {
  let prev = -1;
  for (let d = 0; d <= 31; d++) {
    const g = vineForDays(d);
    assert.ok(g >= prev && g <= 1);
    assert.equal(g, d === 0 ? 0 : vineFor({ ...emptyPeaks(), bestStreak: d }), 'one progression, not a second one (nothing before the first day)');
    prev = g;
  }
  assert.ok(vineForDays(1) > vineForDays(0) && vineForDays(3) > vineForDays(1));
  assert.equal(vineForDays(30), 1);
  const dayWindowDone = [...Array(32).keys()].find(d => vineForDays(d) >= vine.windowEnd)!;
  const dayBottomDone = [...Array(32).keys()].find(d => vineForDays(d) >= vine.bottomEnd)!;
  assert.ok(dayWindowDone > 0 && dayWindowDone < dayBottomDone && dayBottomDone <= 30, 'window first, then the bottom shelf, then the top');
  assert.equal(vineForDays(-3), 0);
  assert.equal(vineForDays(NaN), 0);
});

test('books finished never grow the vine, only goal-met days do', () => {
  assert.equal(vineForDays(goalDaysFor({}, 10)), 0);
  assert.equal(vineFor({ ...emptyPeaks(), booksFinished: 9 }) > 0.2, true, 'the old saved value would have been long');
});

test('a lost streak does not reset the vine: it stops, keeps what it grew, and carries on when you read again', () => {
  const goal = 10;
  const week = logOf([1, 2, 3, 4, 5]);
  const before = vineForDays(goalDaysFor(week, goal));
  assert.ok(before > vineForDays(0));
  // two weeks of nothing: the streak is gone, the vine is exactly where it was
  assert.equal(currentStreakFor(week, goal, '2026-03-20'), 0);
  assert.equal(vineForDays(goalDaysFor(week, goal)), before, 'no shrinking');
  // a missed day inside the log changes nothing either
  const withGap = { ...week, ...logOf([8, 9]) };
  const resumed = vineForDays(goalDaysFor(withGap, goal));
  assert.ok(resumed > before, 'the new streak keeps growing from where it stopped, not from zero');
  assert.equal(resumed, vineForDays(7), 'five old days plus two new ones');
});

test('a streak reset keeps earned plants, achievements, placements and celebrations', () => {
  const base = { goal: 10, status: {}, todayKey: '2026-03-10' };
  const log = logOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const evalAt = (g: ReturnType<typeof emptyGarden>, todayKey: string) => evaluateGarden(g, computeSnapshot({ ...base, dailyLog: log, todayKey }), 1000, { silent: true });
  const during = evalAt(emptyGarden(), '2026-03-10');
  assert.equal(currentStreakFor(log, 10, '2026-03-10'), 10);
  assert.ok(Object.keys(during.achievements).length > 0 && Object.keys(during.plants).length > 0);
  const afterReset = evalAt(during, '2026-03-25');
  assert.equal(currentStreakFor(log, 10, '2026-03-25'), 0);
  assert.deepEqual(afterReset.achievements, during.achievements);
  assert.deepEqual(afterReset.plants, during.plants);
  assert.deepEqual(afterReset.placements, during.placements);
  assert.deepEqual(afterReset.celebrated, during.celebrated);
  assert.equal(afterReset.peaks.bestStreak, 10);
});

/* ---------- opening animation ---------- */

function fakeFrames() {
  let cb: ((now: number) => void) | null = null;
  let cancelled = 0;
  const frames: FrameScheduler = { raf: f => { cb = f; return 1; }, caf: () => { cancelled++; cb = null; } };
  return { frames, tick: (now: number) => { const f = cb; cb = null; f?.(now); }, pending: () => cb !== null, cancelled: () => cancelled };
}

test('on opening, the vine grows from nothing to its length in route order, and finishes exactly', () => {
  const f = fakeFrames();
  const seen: number[] = [];
  runReveal(0, 0.8, false, v => seen.push(v), f.frames);
  for (let t = 0; f.pending() && t < 20000; t += 16) f.tick(t + 16);
  assert.ok(seen.length > 20, 'many small steps, not a jump');
  assert.ok(seen[0] < 0.05, 'starts from (almost) nothing');
  assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), 'never goes backwards');
  assert.equal(seen[seen.length - 1], 0.8, 'ends on the target');
  const tail = revealDuration(0, 0.8);
  assert.ok(tail >= 500 && tail <= 2200);
  // leaves appear in route order: a leaf at t shows once the tip has passed it
  const shownAt = (l: { t: number }) => seen.findIndex(v => v >= l.t - 0.004);
  const early = parts.find(l => l.t < 0.3)!, late = parts.find(l => l.t > 0.6 && l.t < 0.8)!;
  assert.ok(shownAt(early) < shownAt(late));
});

test('reduced motion shows the complete vine at once, with no frames scheduled', () => {
  const f = fakeFrames();
  const seen: number[] = [];
  runReveal(0, 1, true, v => seen.push(v), f.frames);
  assert.deepEqual(seen, [1]);
  assert.equal(f.pending(), false);
  const none: number[] = [];
  runReveal(0, 0.5, false, v => none.push(v)); // no animation frames available at all
  assert.deepEqual(none, [0.5]);
});

test('a new target glides from where the vine is, and stopping the animation cancels the next frame', () => {
  const f = fakeFrames();
  const seen: number[] = [];
  const stop = runReveal(0.4, 0.7, false, v => seen.push(v), f.frames);
  f.tick(1000); f.tick(1100);
  assert.ok(seen[0] >= 0.4 && seen.every(v => v >= 0.4 && v <= 0.7));
  stop();
  assert.equal(f.pending(), false);
  assert.equal(f.cancelled(), 1);
  assert.equal(revealValue(0, 1, 5000, 2200), 1);
  const same: number[] = [];
  runReveal(0.5, 0.5, false, v => same.push(v), f.frames);
  assert.deepEqual(same, [], 'nothing to animate when already there');
});

test('the real window\'s animation frame functions are only ever called on the window (no "Illegal invocation")', () => {
  // A window like the browser's: its frame methods throw when they are not called on it
  const win: any = {
    queue: [] as ((n: number) => void)[], cancelled: [] as number[],
    requestAnimationFrame(cb: (n: number) => void) { if (this !== win) throw new TypeError('Illegal invocation'); win.queue.push(cb); return win.queue.length; },
    cancelAnimationFrame(id: number) { if (this !== win) throw new TypeError('Illegal invocation'); win.cancelled.push(id); },
  };
  const frames = browserFrames(win)!;
  assert.ok(frames, 'frames exist when the window has them');
  const seen: number[] = [];
  const stop = runReveal(0, 0.6, false, v => seen.push(v), frames); // schedules through frames.raf (this is the wrapper, not the window)
  for (let t = 0; win.queue.length && t < 20000; t += 16) win.queue.shift()!(t);
  assert.equal(seen[seen.length - 1], 0.6);
  stop();
  assert.equal(win.cancelled.length, 1);
  // the copy-the-method way that crashed the app really does fail on such a window
  const detached: FrameScheduler = { raf: win.requestAnimationFrame, caf: win.cancelAnimationFrame };
  assert.throws(() => runReveal(0, 0.6, false, () => {}, detached), /Illegal invocation/);
  assert.equal(browserFrames(undefined), undefined);
  assert.equal(browserFrames({}), undefined, 'no animation frames: the complete vine shows at once');
});

/* ---------- taps ---------- */

test('the vine drawing never takes a tap: pointer-events none on the svg, nothing inside turns them back on, and it sits in front of the books', () => {
  const html = renderToStaticMarkup(React.createElement(VineDrawing, { vine, parts, width: G.width, shown: 1, animate: true }));
  assert.match(html, /^<svg[^>]*class="[^"]*pointer-events-none[^"]*"/);
  assert.match(html, /^<svg[^>]*style="[^"]*pointer-events:none/);
  assert.match(html, /^<svg[^>]*class="[^"]*\bz-10\b/, 'in front of the books (they have no z-index)');
  assert.ok(!/pointer-events:\s*(auto|all|visible|painted|fill|stroke)/i.test(html), 'no child takes pointer events back');
  assert.ok(!/<(button|a|input)\b|onclick|tabindex/i.test(html), 'nothing focusable or clickable');
  assert.match(html, /role="img"/);
});

test('no goal-met days draw nothing; a full vine shows every leaf, shoot and flower', () => {
  const draw = (shown: number) => renderToStaticMarkup(React.createElement(VineDrawing, { vine, parts, width: G.width, shown, animate: false }));
  const count = (html: string, re: RegExp) => (html.match(re) || []).length;
  const visible = (html: string) => count(html, /opacity:1/g);
  const none = draw(0), blank = draw(vineForDays(0)), start = draw(vineForDays(1)), full = draw(1);
  assert.equal(visible(none), 0, 'nothing visible before it starts growing');
  assert.equal(visible(blank), 0, 'a blank account shows no leaf');
  assert.ok(!/stroke-width="2\.6"/.test(blank), 'and no stem');
  assert.ok(visible(start) < visible(full), 'the start is smaller than the full vine');
  assert.ok(visible(full) >= parts.length + parts.filter(l => l.shoot).length + parts.filter(l => l.flower).length, 'every leaf, shoot and flower');
  assert.ok(/stroke-width="2\.6"/.test(start), 'one goal-met day draws the first stem');
  const lastLeaf = parts[parts.length - 1];
  assert.ok(full.includes(`d="${vine.dTo(lastLeaf.t)}"`), 'the full stem ends at its last leaf');
  assert.ok(!/transition:(?!none)/.test(full), 'no transitions when animation is off (reduced motion)');
  assert.match(renderToStaticMarkup(React.createElement(VineDrawing, { vine, parts, width: G.width, shown: 1, animate: true })), /transition:opacity \.7s/);
});

/* ---------- a blank account starts as a sprout; the stem always ends in a leaf ---------- */

test('a blank account shows a small sprout: a short stem with its first two leaves, never a bare stem', () => {
  const shown = vineShown(parts, vineForDays(0));
  const visible = parts.filter(l => shown >= l.t - 0.004);
  assert.equal(visible.length, SPROUT_LEAVES, 'two leaves');
  assert.equal(stemEnd(parts, shown, 0.004), visible[visible.length - 1].t, 'the stem ends at the second leaf');
  const html = renderToStaticMarkup(React.createElement(VineDrawing, { vine, parts, width: G.width, shown, animate: false }));
  assert.match(html, /stroke-width="2\.6"/);
  assert.equal((html.match(/opacity:1/g) ?? []).length, SPROUT_LEAVES, 'only the sprout leaves are visible; no shoots or flowers yet');
  const classic = vineShown(CLASSIC_LEAVES, 0);
  assert.equal(CLASSIC_LEAVES.filter(l => classic >= l.t - 0.02).length, SPROUT_LEAVES, 'the classic vine starts the same way');
});

test('earned growth carries on from the sprout: every goal-met day adds growth, and a full streak is the full vine', () => {
  let prev = vineShown(parts, vineForDays(0));
  for (let d = 1; d <= 30; d++) {
    const v = vineShown(parts, vineForDays(d));
    assert.ok(v > prev - 1e-9 && v <= 1, `day ${d}`);
    prev = v;
  }
  assert.ok(vineShown(parts, vineForDays(1)) > vineShown(parts, vineForDays(0)) && parts.filter(l => vineShown(parts, vineForDays(1)) >= l.t - 0.004).length > SPROUT_LEAVES, 'the first day visibly grows it');
  assert.equal(vineShown(parts, 1), 1);
  assert.equal(vineShown([], 0.5), 0.5 * 1, 'no leaves, no sprout, no crash');
});

test('the newest leaf grows straight on from the stem, so the stem ends in it, at any growth (14 days included)', () => {
  for (const shown of [vineShown(parts, 0), vineForDays(3), vineForDays(14), vineForDays(30)]) {
    const i = tipIndex(parts, shown, 0.004);
    assert.ok(i >= 0);
    const html = renderToStaticMarkup(React.createElement(VineDrawing, { vine, parts, width: G.width, shown, animate: false }));
    const rots = [...html.matchAll(/translate\(([\d.-]+) ([\d.-]+)\) rotate\(([\d.-]+)\) scale/g)].map(m => ({ x: +m[1], y: +m[2], r: +m[3] }));
    const tip = rots.find(r => Math.abs(r.x - parts[i].x) < 0.06 && Math.abs(r.y - parts[i].y) < 0.06)!;
    assert.ok(Math.abs(tip.r - parts[i].ang) < 0.06, 'the tip leaf points along the vine');
  }
});

test('shoots only grow on the window and curl into the glass, never out over the wood, the wall or the shelves', () => {
  const shoots = parts.filter(l => l.shoot);
  assert.ok(shoots.length > 0 && shoots.every(l => l.t <= vine.windowEnd), 'none on the shelves');
  assert.ok(shoots.every(l => l.side === -1), 'always from a leaf that points away from the glass, so the shoot goes the other way, inwards');
  assert.ok(!parts[parts.length - 1].shoot && !parts[0].shoot, 'no shoot on the first or the last leaf');
});

test('the vine settles exactly on a leaf and its stem grows with the tip while animating', () => {
  for (const d of [0, 1, 5, 14, 29, 30]) {
    const rest = restAt(parts, vineForDays(d), 0.004);
    assert.equal(stemEnd(parts, rest, 0.004), rest, `day ${d}: the resting stem ends on its last leaf`);
  }
  const rest = restAt(parts, vineForDays(14), 0.004), mid = rest - 0.011;
  const draw = (shown: number, growing: boolean) => renderToStaticMarkup(React.createElement(VineDrawing, { vine, parts, width: G.width, shown, animate: false, growing }));
  const len = (h: string) => {
    const pts = h.match(/<path d="([^"]+)"[^>]*stroke-width="2\.6"/)![1].slice(1).split(' L').map(q => q.split(' ').map(Number));
    return pts.reduce((n, q, i) => (i ? n + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0), 0);
  };
  assert.ok(len(draw(mid, true)) > len(draw(mid, false)), 'mid-growth the stem follows the tip instead of jumping from leaf to leaf');
  assert.ok(Math.abs(len(draw(rest, true)) - len(draw(rest, false))) < 1, 'and arrives exactly on the last leaf');
});
