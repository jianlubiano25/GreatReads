// Run with: npm test
// The Garden Nook vine: growth from the live streak, the opening animation, and that the drawing never takes a tap.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildVine, vineLeaves, type VineGeometry } from './vinePath';
import { runReveal, revealValue, revealDuration, browserFrames, type FrameScheduler } from './vineReveal';
import { vineForDays, vineFor, emptyPeaks, emptyGarden, computeSnapshot, evaluateGarden, currentStreakFor, goalDaysFor } from './garden';
import { VineDrawing, clip } from '../components/VineOverlay';

const G: VineGeometry = {
  frame: { x: 12, y: 12, w: 109, h: 145 }, wood: 5, radius: 54, width: 390,
  bottom: { x0: 140, x1: 370, y: 153 }, top: { x0: 140, x1: 370, y: 100 },
};
const vine = buildVine(G);
const parts = vineLeaves(vine);

/* ---------- growth follows the days you met your goal ---------- */

const logOf = (days: number[], pages = 12) => Object.fromEntries(days.map(d => [`2026-03-${String(d).padStart(2, '0')}`, pages]));

test('with no goal-met days only the small initial growth shows, on the first leg of the route', () => {
  const g0 = vineForDays(goalDaysFor({}, 10));
  assert.equal(g0, 0.12);
  assert.ok(g0 < vine.windowEnd, 'nothing on the shelves');
  const shelf = parts.filter(l => l.t > vine.windowEnd);
  assert.ok(shelf.length > 0 && shelf.every(l => !(l.t - 0.004 <= g0)), 'no shelf leaf, shoot or flower yet');
  assert.equal(goalDaysFor(logOf([1, 2], 5), 10), 0, 'days under the goal do not count');
});

test('every goal-met day grows the vine one step, with the same progression as the existing vineFor', () => {
  let prev = -1;
  for (let d = 0; d <= 14; d++) {
    const g = vineForDays(d);
    assert.ok(g >= prev && g <= 1);
    assert.equal(g, vineFor({ ...emptyPeaks(), bestStreak: d }), 'one progression, not a second one');
    prev = g;
  }
  assert.ok(vineForDays(1) > vineForDays(0) && vineForDays(3) > vineForDays(1));
  assert.equal(vineForDays(11), 1);
  const dayWindowDone = [...Array(14).keys()].find(d => vineForDays(d) >= vine.windowEnd)!;
  const dayBottomDone = [...Array(14).keys()].find(d => vineForDays(d) >= vine.bottomEnd)!;
  assert.ok(dayWindowDone > 0 && dayWindowDone < dayBottomDone && dayBottomDone <= 11, 'window first, then the bottom shelf, then the top');
  assert.equal(vineForDays(-3), 0.12);
  assert.equal(vineForDays(NaN), 0.12);
});

test('books finished never grow the vine, only goal-met days do', () => {
  assert.equal(vineForDays(goalDaysFor({}, 10)), 0.12);
  assert.equal(vineFor({ ...emptyPeaks(), booksFinished: 9 }) > 0.5, true, 'the old saved value would have been long');
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

test('no goal-met days draw only the initial growth; a full vine shows every leaf, shoot and flower', () => {
  const draw = (shown: number) => renderToStaticMarkup(React.createElement(VineDrawing, { vine, parts, width: G.width, shown, animate: false }));
  const count = (html: string, re: RegExp) => (html.match(re) || []).length;
  const visible = (html: string) => count(html, /opacity:1/g);
  const none = draw(0), start = draw(vineForDays(0)), full = draw(1);
  assert.equal(visible(none), 0, 'nothing visible before it starts growing');
  assert.ok(visible(start) < visible(full), 'the start is smaller than the full vine');
  assert.ok(visible(full) >= parts.length + parts.filter(l => l.shoot).length + parts.filter(l => l.flower).length, 'every leaf, shoot and flower');
  assert.ok(start.includes(`stroke-dasharray="${clip(vineForDays(0), vine.length)}"`));
  assert.ok(full.includes(`stroke-dasharray="${clip(1, vine.length)}"`));
  assert.ok(!/transition:(?!none)/.test(full), 'no transitions when animation is off (reduced motion)');
  assert.match(renderToStaticMarkup(React.createElement(VineDrawing, { vine, parts, width: G.width, shown: 1, animate: true })), /transition:opacity \.7s/);
});
