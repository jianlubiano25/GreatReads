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
  assert.equal(currentStreakFor(log, 10, '2026-03-25'), 0);
  assert.deepEqual(afterReset.achievements, during.achievements);
  assert.deepEqual(afterReset.plants, during.plants);
  assert.deepEqual(afterReset.placements, during.placements);
  assert.deepEqual(afterReset.celebrated, during.celebrated);
  assert.equal(afterReset.peaks.bestStreak, 10);
});
