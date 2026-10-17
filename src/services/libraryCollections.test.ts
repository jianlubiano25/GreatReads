import { test } from 'node:test';
import assert from 'node:assert/strict';
import { booksOf, loadCollections, makeCollection, restoreCollectionsFromBackup, saveCollections, sanitizeCollections, setBookMembership, COLLECTIONS_KEY } from './libraryCollections';

test('sanitize drops junk, trims names, de-duplicates ids and books', () => {
  const out = sanitizeCollections([
    { id: 'a', name: '  Cozy  ', kind: 'shelf', bookIds: ['1', '1', 2, '3'] },
    { id: 'a', name: 'Duplicate id', kind: 'tag', bookIds: [] },
    { id: 'b', name: '', kind: 'tag', bookIds: [] },
    { id: 'c', name: 'Tag', kind: 'weird' },
    null,
    'x',
  ]);
  assert.deepEqual(out, [
    { id: 'a', name: 'Cozy', kind: 'shelf', bookIds: ['1', '3'] },
    { id: 'c', name: 'Tag', kind: 'tag', bookIds: [] },
  ]);
});

test('sanitize of a non-array is empty', () => {
  assert.deepEqual(sanitizeCollections({}), []);
  assert.deepEqual(sanitizeCollections(undefined), []);
});

test('save then load round-trips; broken storage gives an empty list', () => {
  const mem: Record<string, string> = {};
  const storage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v; } };
  saveCollections([{ id: 'x', name: 'Winter', kind: 'tag', bookIds: ['9'] }], storage);
  assert.ok(mem[COLLECTIONS_KEY]);
  assert.equal(loadCollections(storage)[0].name, 'Winter');
  mem[COLLECTIONS_KEY] = '{not json';
  assert.deepEqual(loadCollections(storage), []);
});

test('booksOf keeps your order and skips books no longer in the Library', () => {
  const books = [{ id: 1 }, { id: 'two' }, { id: 3 }];
  const c = { id: 'c', name: 'n', kind: 'shelf' as const, bookIds: ['3', 'gone', '1'] };
  assert.deepEqual(booksOf(c, books).map(b => b.id), [3, 1]);
});

test('ticking shelves and tags for one book adds and removes it, and leaves the list alone when nothing changes', () => {
  const list = [
    { id: 's1', name: 'Cozy', kind: 'shelf' as const, bookIds: ['9'] },
    { id: 's2', name: 'Winter', kind: 'shelf' as const, bookIds: [] },
    { id: 't1', name: 'Club', kind: 'tag' as const, bookIds: ['9', '4'] },
  ];
  const out = setBookMembership(list, '9', new Set(['s2', 't1']));
  assert.deepEqual(out.map(c => c.bookIds), [[], ['9'], ['9', '4']]);
  assert.equal(setBookMembership(list, '9', new Set(['s1', 't1'])), list);
});

test('makeCollection cleans the name and refuses an empty one', () => {
  assert.equal(makeCollection('shelf', '   '), null);
  const c = makeCollection('tag', '  Book club  ');
  assert.equal(c?.name, 'Book club');
  assert.equal(c?.kind, 'tag');
  assert.deepEqual(c?.bookIds, []);
});

test('a backup carries shelves and tags back; one made before they existed leaves yours alone', () => {
  const mem: Record<string, string> = {};
  (globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v; } };
  try {
    assert.equal(restoreCollectionsFromBackup(JSON.stringify({ status: {} })), false);
    assert.equal(mem[COLLECTIONS_KEY], undefined);
    assert.equal(restoreCollectionsFromBackup(JSON.stringify({ libraryCollections: [{ id: 'a', name: 'Cozy', kind: 'shelf', bookIds: ['1'] }, { bad: 1 }] })), true);
    assert.deepEqual(loadCollections().map(c => c.name), ['Cozy']);
    assert.equal(restoreCollectionsFromBackup('not json'), false);
  } finally {
    delete (globalThis as any).localStorage;
  }
});
