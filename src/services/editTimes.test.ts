import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTimes, maxTimes, mergeHiddenByTime, mergeWordsByTime, newer, stampTimes, timeKey, timeOf, withEdits, withWordsDeleted } from './editTimes';
import { applyRating } from './bookHistory';
import { normalizeV2 } from './stateSanitizer';
import type { ReadingState, WordItem } from '../types';

const w = (id: string, learned = false): WordItem => ({ id, word: id, definition: 'd', isLearned: learned, addedAt: 1 } as WordItem);

test('stampTimes is strictly later than the previous stamp, even if the clock goes backwards', () => {
  const a = stampTimes(undefined, ['status:b1'], 1000);
  const b = stampTimes(a, ['status:b1'], 500);
  assert.ok(b['status:b1'] > a['status:b1']);
  assert.equal(stampTimes(a, ['status:b1'], 5000)['status:b1'], 5000);
});

test('newer: only a later real edit decides; equal times (including both legacy) are "same"', () => {
  assert.equal(newer(0, 5), 'remote');
  assert.equal(newer(5, 0), 'local');
  assert.equal(newer(0, 0), 'same');
  assert.equal(newer(7, 7), 'same');
});

test('withEdits / withWordsDeleted return the same object when there is nothing to stamp', () => {
  const s = { editTimes: { 'word:a': 1 } };
  assert.equal(withEdits(s, 'word', []), s);
  assert.equal(withWordsDeleted({ editTimes: {}, deletedWords: {} }, []).deletedWords && true, true);
});

test('a delete wins over an older edit, an edit later than the delete wins over the delete', () => {
  const del = { words: [], times: {}, deleted: { w1: 2000 } };
  const olderEdit = { words: [w('w1')], times: { 'word:w1': 1000 } };
  assert.deepEqual(mergeWordsByTime(olderEdit, del).words, []);
  assert.deepEqual(mergeWordsByTime(del, olderEdit).words, []);
  const newerEdit = { words: [w('w1')], times: { 'word:w1': 3000 } };
  assert.deepEqual(mergeWordsByTime(newerEdit, del).words.map(x => x.id), ['w1']);
});

test('a delete beats a legacy (unstamped) copy, but an exact tie keeps the word (never lose data on a tie)', () => {
  const del = { words: [], times: {}, deleted: { w1: 2000 } };
  assert.deepEqual(mergeWordsByTime({ words: [w('w1')] }, del).words, []);
  const tie = { words: [w('w1')], times: { 'word:w1': 2000 } };
  assert.deepEqual(mergeWordsByTime(tie, del).words.map(x => x.id), ['w1']);
});

test('both sides have the word: the later edit wins; two legacy copies keep "learned" if either has it', () => {
  const learnedLater = mergeWordsByTime({ words: [w('w1', false)], times: { 'word:w1': 1 } }, { words: [w('w1', true)], times: { 'word:w1': 2 } });
  assert.equal(learnedLater.words[0].isLearned, true);
  const unlearnedLater = mergeWordsByTime({ words: [w('w1', true)], times: { 'word:w1': 1 } }, { words: [w('w1', false)], times: { 'word:w1': 2 } });
  assert.equal(unlearnedLater.words[0].isLearned, false); // un-learning is a real edit too
  const legacy = mergeWordsByTime({ words: [w('w1', false)] }, { words: [w('w1', true)] });
  assert.equal(legacy.words[0].isLearned, true);
});

test('words only on one side are kept (a missing word is never a delete); order keeps local first', () => {
  const merged = mergeWordsByTime({ words: [w('a'), w('b')] }, { words: [w('c'), w('a')] });
  assert.deepEqual(merged.words.map(x => x.id), ['a', 'b', 'c']);
});

test('hidden books: the later hide or un-hide wins; two legacy values hide if either side hides', () => {
  const unhide = mergeHiddenByTime({ hidden: {}, times: { 'hidden:b': 2000 } }, { hidden: { b: true }, times: { 'hidden:b': 1000 } });
  assert.equal(unhide.hidden.b, undefined);
  const hideAgain = mergeHiddenByTime({ hidden: { b: true }, times: { 'hidden:b': 3000 } }, { hidden: {}, times: { 'hidden:b': 2000 } });
  assert.equal(hideAgain.hidden.b, true);
  const legacy = mergeHiddenByTime({ hidden: {} }, { hidden: { b: true } });
  assert.equal(legacy.hidden.b, true);
  assert.equal(unhide.times['hidden:b'], 2000);
});

test('applyRating stamps both setting and clearing a rating, and does not stamp when nothing changes', () => {
  const base = { ratings: {}, editTimes: undefined } as unknown as ReadingState;
  const rated = applyRating(base, 'b1', 4);
  assert.ok(timeOf(rated.editTimes, 'rating', 'b1') > 0);
  const cleared = applyRating(rated, 'b1', 0);
  assert.equal(cleared.ratings.b1, undefined);
  assert.ok(timeOf(cleared.editTimes, 'rating', 'b1') > timeOf(rated.editTimes, 'rating', 'b1'));
  assert.equal(applyRating(cleared, 'b1', 0), cleared);
});

test('the state sanitizer keeps edit times and delete markers, and drops junk', () => {
  const base = normalizeV2({}, { status: {}, currentPage: {}, totalPages: {}, dailyLog: {}, notes: {}, highlights: {}, goal: 10, readingIntention: '', profile: { name: '', photo: '', theme: 'auto' }, customBooks: [], onDeviceOverrides: {}, hiddenBookIds: {}, words: [], garden: undefined as never, history: {}, ratings: {} } as ReadingState);
  const out = normalizeV2({ editTimes: { 'word:a': 5, 'status:b': 'x', 'rating:c': -3, 'hidden:d': 9.4 }, deletedWords: { w1: 7, w2: 'no' } }, base);
  assert.deepEqual(out.editTimes, { 'word:a': 5, 'hidden:d': 9 });
  assert.deepEqual(out.deletedWords, { w1: 7 });
  assert.deepEqual(cleanTimes(null), {});
  assert.deepEqual(maxTimes({ 'status:a': 3, 'word:x': 9 }, { 'status:a': 5 }, ['status:']), { 'status:a': 5 });
  assert.equal(timeKey('rating', 4), 'rating:4');
});
