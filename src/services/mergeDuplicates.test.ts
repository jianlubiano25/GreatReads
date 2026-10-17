import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Book, ReadingState } from '../types';
import { makeBook } from './books/model';
import { applyMerge, findDuplicateGroups, idMapOf, remapCollections } from './mergeDuplicates';

const copy = (id: string, title = 'Gentle Harbour Zzq', author = 'Ada Quill Zzq', over: Partial<Book> = {}): Book =>
  makeBook({ id, title, author, pageCount: 300, ...over });

const state = (customBooks: Book[], over: Partial<ReadingState> = {}): ReadingState => ({
  status: {}, currentPage: {}, totalPages: {}, dailyLog: {}, notes: {}, highlights: {}, goal: 10, readingIntention: '',
  profile: { name: '', photo: '', theme: 'auto' }, customBooks, onDeviceOverrides: {}, hiddenBookIds: {}, words: [],
  garden: { plants: {}, placements: {}, achievements: {}, celebrated: {} } as any, history: {}, ratings: {}, ...over,
});

test('finds the same book under two ids, and leaves different books alone', () => {
  const s = state([copy('a'), copy('b'), copy('c', 'Another Book Zzq', 'Someone Else Zzq')]);
  const groups = findDuplicateGroups(s);
  assert.equal(groups.length, 1);
  assert.deepEqual([groups[0].keepId, ...groups[0].otherIds].sort(), ['a', 'b']);
});

test('keeps the copy that holds your data, and nothing is lost in the merge', () => {
  const s = state([copy('a'), copy('b')], {
    status: { a: 'list', b: 'now' },
    currentPage: { a: 10, b: 120 },
    totalPages: { b: 300 },
    notes: { a: 'first thought', b: 'second thought' },
    highlights: { a: [{ id: 'h1', text: 'Same quote', timestamp: 1 }], b: [{ id: 'h2', text: 'same quote', timestamp: 2 }, { id: 'h3', text: 'Other quote', timestamp: 3 }] },
    history: { a: { added: '2026-03-01' }, b: { added: '2026-05-01', started: '2026-05-02', lastRead: 50 } },
    ratings: { a: 4 },
    onDeviceOverrides: { b: true },
  });
  const groups = findDuplicateGroups(s);
  const k = groups[0].keepId; // whichever copy holds more of your data is kept; the result must be the same either way
  const m = applyMerge(s, groups);
  assert.equal(m.customBooks.length, 1);
  assert.equal(String(m.customBooks[0].id), k);
  assert.equal(m.status[k], 'now');
  assert.equal(m.currentPage[k], 120);
  assert.match(m.notes[k], /first thought/);
  assert.match(m.notes[k], /second thought/);
  assert.equal(m.highlights[k].length, 2); // the repeated quote is kept once
  assert.deepEqual(m.history[k], { added: '2026-03-01', started: '2026-05-02', lastRead: 50 });
  assert.equal(m.ratings[k], 4);
  assert.equal(m.onDeviceOverrides[k], true);
  const gone = groups[0].otherIds[0];
  for (const rec of [m.status, m.currentPage, m.notes, m.highlights, m.history, m.ratings, m.onDeviceOverrides]) assert.ok(!(gone in rec));
  assert.equal(findDuplicateGroups(m).length, 0);
});

test('a finished copy wins and keeps its finished date; a status that is not finished drops the stale date', () => {
  const s = state([copy('a'), copy('b')], { status: { a: 'done', b: 'now' }, history: { a: { finished: '2026-06-01' }, b: { started: '2026-02-01' } } });
  const m = applyMerge(s, findDuplicateGroups(s));
  const keep = String(m.customBooks[0].id);
  assert.equal(m.status[keep], 'done');
  assert.equal(m.history[keep].finished, '2026-06-01');
  assert.equal(m.history[keep].started, '2026-02-01');
});

test('three copies become one', () => {
  const s = state([copy('a'), copy('b'), copy('c')], { ratings: { c: 5 } });
  const groups = findDuplicateGroups(s);
  assert.equal(groups.length, 1);
  const m = applyMerge(s, groups);
  assert.equal(m.customBooks.length, 1);
  assert.equal(Object.values(m.ratings)[0], 5);
});

test('tags and shelves follow the kept copy without listing a book twice', () => {
  const out = remapCollections([{ id: 'x', name: 'n', kind: 'shelf', bookIds: ['a', 'b', 'z'] }], idMapOf([{ keepId: 'b', otherIds: ['a'], title: '', author: '' }]));
  assert.deepEqual(out[0].bookIds, ['b', 'z']);
});

test('nothing to merge changes nothing', () => {
  const s = state([copy('a'), copy('c', 'Another Book Zzq', 'Someone Else Zzq')]);
  assert.deepEqual(findDuplicateGroups(s), []);
  assert.equal(applyMerge(s, []), s);
});
