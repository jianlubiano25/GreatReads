// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { bestStreakFor, bestWeekFor, computeSnapshot, emptyGarden, evaluateGarden, markCelebrated, pendingCelebrations, seedGarden } from './garden';
import { dateKey } from './dates';
import type { WordItem } from '../types';

const TODAY = '2026-03-20';
const base = { goal: 10, status: {}, todayKey: TODAY };
const evalWith = (g: ReturnType<typeof emptyGarden>, dailyLog: Record<string, number>, extra: Partial<Parameters<typeof computeSnapshot>[0]> = {}, silent = false) =>
  evaluateGarden(g, computeSnapshot({ ...base, dailyLog, ...extra }), 1000, { silent });

test('dateKey is zero padded local time', () => {
  assert.equal(dateKey(new Date(2026, 0, 5)), '2026-01-05');
});

test('best streak and best week come from the whole log', () => {
  const log: Record<string, number> = {};
  for (const d of ['01', '02', '03', '04', '05', '06', '07']) log[`2026-03-${d}`] = 12;
  log['2026-03-15'] = 12;
  assert.equal(bestStreakFor(log, 10), 7);
  assert.equal(bestWeekFor(log, 10), 7);
  assert.equal(bestWeekFor({}, 10), 0);
});

test('a typo of extra pages earns plants, and fixing it takes them back', () => {
  const start = seedGarden({ ...base, dailyLog: {} });
  const typo = evalWith(start, { [TODAY]: 500 });
  assert.ok(typo.plants['fern'] && typo.plants['cactus'], 'plants arrive');
  assert.ok(pendingCelebrations(typo).includes('fern'), 'and are queued for the prompt');
  const fixed = evalWith(typo, { [TODAY]: 5 });
  assert.equal(fixed.plants['fern'], undefined);
  assert.equal(fixed.plants['cactus'], undefined);
  assert.equal(fixed.placements['fern'], undefined);
  assert.equal(fixed.celebrated['fern'], undefined);
  assert.ok(fixed.plants['streak-sprout'], 'starter plants are never taken back');
});

test('a streak that ended still counts', () => {
  const log: Record<string, number> = {};
  for (let d = 1; d <= 7; d++) log[`2026-03-0${d}`] = 10; // 7 in a row, long before today
  const g = evalWith(seedGarden({ ...base, dailyLog: {} }), log);
  assert.ok(g.plants['golden-sunflower']);
});

test('lowering the goal for a moment does not keep streak plants', () => {
  const log: Record<string, number> = {};
  for (let d = 1; d <= 7; d++) log[`2026-03-0${d}`] = 3;
  const low = evalWith(seedGarden({ ...base, dailyLog: {} }), log, { goal: 1 });
  assert.ok(low.plants['golden-sunflower']);
  const back = evalWith(low, log, { goal: 10 });
  assert.equal(back.plants['golden-sunflower'], undefined);
});

test('growth follows the log down and up', () => {
  const s = seedGarden({ ...base, dailyLog: {} });
  const big = evalWith(s, { [TODAY]: 40 });
  const grown = big.plants['fern'].growth;
  const small = evalWith(big, { [TODAY]: 12 });
  assert.ok(small.plants['fern'].growth < grown);
  assert.equal(small.plants['fern'].completedAt, undefined);
});

test('words and highlights are never taken back', () => {
  const w: WordItem = { id: 'my-word-1', word: 'luminous', definition: 'x', isLearned: false, addedAt: 1 };
  const withWord = evalWith(seedGarden({ ...base, dailyLog: {} }), {}, { words: [w] });
  assert.ok(withWord.plants['mint']);
  const deleted = evalWith(withWord, {}, { words: [] });
  assert.ok(deleted.plants['mint']);
});

test('silent awards and markCelebrated never queue a prompt', () => {
  const silent = evalWith(seedGarden({ ...base, dailyLog: {} }), { [TODAY]: 60 }, {}, true);
  assert.deepEqual(pendingCelebrations(silent), []);
  const loud = evalWith(seedGarden({ ...base, dailyLog: {} }), { [TODAY]: 60 });
  assert.ok(pendingCelebrations(loud).length > 0);
  assert.deepEqual(pendingCelebrations(markCelebrated(loud, Object.keys(loud.plants))), []);
});

test('nothing changed returns the same object', () => {
  const g = evalWith(seedGarden({ ...base, dailyLog: {} }), { [TODAY]: 12 });
  assert.equal(evalWith(g, { [TODAY]: 12 }), g);
});
