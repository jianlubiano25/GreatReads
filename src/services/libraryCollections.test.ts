import { test } from 'node:test';
import assert from 'node:assert/strict';
import { booksOf, loadCollections, saveCollections, sanitizeCollections, COLLECTIONS_KEY } from './libraryCollections';

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
