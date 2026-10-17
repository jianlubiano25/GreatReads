import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReadingState } from '../types';
import { applyHistoryEdit, applyRating, formatRating, isDateKey, prettyDate, readingNowOrder, sanitizeHistory, sanitizeRatings, stampProgress, stampStatus } from './bookHistory';

const base = (over: Partial<ReadingState> = {}): ReadingState => ({ status: {}, history: {}, ratings: {}, ...over } as ReadingState);

test('real dates only', () => {
  assert.ok(isDateKey('2026-10-16'));
  assert.ok(!isDateKey('2026-02-30'));
  assert.ok(!isDateKey('2026-1-1'));
  assert.ok(!isDateKey(5));
});

test('sanitize keeps good dates/ratings and drops the rest', () => {
  assert.deepEqual(sanitizeHistory({ a: { added: '2026-01-02', started: 'x', finished: '2026-13-01', lastRead: 5 }, b: 'no', c: {} }), { a: { added: '2026-01-02', lastRead: 5 } });
  assert.deepEqual(sanitizeRatings({ a: 4, b: 0, c: 9, d: '3', e: 'x', f: 4.2, g: 0.1 }), { a: 4, d: 3, f: 4.25 });
  assert.deepEqual(sanitizeHistory(null), {});
});

test('moving a book to Reading now stamps added, started and lastRead; finishing stamps finished', () => {
  const a = stampStatus(undefined, undefined, 'now', '2026-10-01', 100);
  assert.deepEqual(a, { added: '2026-10-01', started: '2026-10-01', lastRead: 100 });
  const b = stampStatus(a, 'now', 'done', '2026-10-09', 200);
  assert.equal(b.finished, '2026-10-09');
  assert.equal(b.started, '2026-10-01');
  const c = stampStatus(b, 'done', 'now', '2026-10-20', 300); // reading it again: no longer finished
  assert.equal(c.finished, undefined);
  assert.equal(c.started, '2026-10-01');
});

test('reading some pages starts the book and makes it the latest', () => {
  assert.deepEqual(stampProgress({ added: '2026-01-01' }, '2026-02-02', 9), { added: '2026-01-01', started: '2026-02-02', lastRead: 9 });
});

test('editing dates: finished finishes the book; clearing it reopens; bad edits change nothing', () => {
  const s = base({ status: { x: 'now' }, history: { x: { added: '2026-01-01', started: '2026-02-01' } } });
  const done = applyHistoryEdit(s, 'x', { finished: '2026-03-01' }, '2026-10-16');
  assert.equal(done.status.x, 'done');
  assert.equal(done.history.x.finished, '2026-03-01');
  const reopened = applyHistoryEdit(done, 'x', { finished: null }, '2026-10-16');
  assert.equal(reopened.status.x, 'now');
  assert.equal(reopened.history.x.finished, undefined);
  assert.equal(applyHistoryEdit(s, 'x', { finished: '2026-01-15' }, '2026-10-16'), s); // before it started
  assert.equal(applyHistoryEdit(s, 'x', { started: '2027-01-01' }, '2026-10-16'), s); // in the future
  assert.equal(applyHistoryEdit(s, 'x', { started: 'soon' }, '2026-10-16'), s);
});

test('rating: quarter stars, change, clear', () => {
  assert.equal(applyRating(base(), 'x', 4.3).ratings.x, 4.25);
  assert.equal(formatRating(4.25), '4.25');
  assert.equal(formatRating(4), '4');
  const s = applyRating(base(), 'x', 4);
  assert.equal(s.ratings.x, 4);
  assert.equal(applyRating(s, 'x', 4), s);
  assert.deepEqual(applyRating(s, 'x', 0).ratings, {});
});

test('Reading now: latest read first, then latest started, otherwise unchanged order', () => {
  const books = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const out = readingNowOrder(books, { '2': { lastRead: 50 }, '3': { lastRead: 90 }, '4': { started: '2026-05-05' } });
  assert.deepEqual(out.map(b => b.id), [3, 2, 4, 1]);
});

test('prettyDate', () => {
  assert.equal(prettyDate('2026-10-03'), 'Oct 3, 2026');
  assert.equal(prettyDate('nope'), '');
});
