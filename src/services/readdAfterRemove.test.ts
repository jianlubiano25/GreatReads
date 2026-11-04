import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAddBook } from './library';
import type { ReadingState } from '../types';

const base = (over: Partial<ReadingState> = {}): ReadingState => ({
  status: {}, currentPage: {}, totalPages: {}, dailyLog: {}, notes: {}, highlights: {}, goal: 10, readingIntention: '',
  profile: { name: '', photo: '', theme: 'auto' }, customBooks: [], onDeviceOverrides: {}, hiddenBookIds: {}, words: [],
  garden: { plants: {}, placements: {}, achievements: {}, celebrated: {} } as any, history: {}, ratings: {}, ...over,
});

test('a removed (hidden) book that is added back is shown again, with a stamped edit so it uploads', () => {
  const book = { id: 'readd-1', title: 'Added Back', author: 'Someone Else', genre: 'x', description: '', rating: 0, coverUrl: '' } as any;
  const next = applyAddBook(base({ hiddenBookIds: { 'readd-1': true } }), book, 'library');
  assert.equal(next.hiddenBookIds['readd-1'], undefined);
  assert.ok((next.editTimes || {})['hidden:readd-1'] > 0, 'the un-hide is a stamped edit');
});
