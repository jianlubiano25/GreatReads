import test from 'node:test';
import assert from 'node:assert/strict';
import { packResolved, unpackResolved, type Resolved } from './resolve';

const text = 'A long description of the book. '.repeat(30);
const base = (): Resolved => ({ book: { id: 1, title: 'Dune', author: 'Frank Herbert', summary: text, authorBio: '', shelf: 'want' as any, difficulty: 0, isOnDevice: false, year: '1965', genre: 'Science fiction', pageCount: 412 } as any, flags: { description: text, subjects: ['Fiction', 'Fiction', 'Deserts'], publisher: 'Ace' }, words: ['fiction', 'fiction', 'sand', 'sand'], ratings: [{ source: 'google', average: 4.2, count: 10 } as any] });

test('the saved copy of a resolved book is smaller and comes back exactly as it was', () => {
  const full = base();
  const packed = packResolved(full)!;
  assert.ok(JSON.stringify(packed).length < JSON.stringify(full).length - 800, 'the repeated description is gone from the saved copy');
  assert.equal(packed.flags.description, undefined);
  assert.deepEqual(packed.words, ['fiction', 'sand']);
  const back = unpackResolved(JSON.parse(JSON.stringify(packed)))!;
  assert.equal(back.flags.description, text);
  assert.equal(back.book.summary, text);
  assert.deepEqual(back.flags.subjects, ['Fiction', 'Fiction', 'Deserts'], 'flags that decide content eligibility are never touched');
  assert.equal(back.ds, undefined);
});

test('packing never changes the value in memory, and different texts are both kept', () => {
  const full = base();
  packResolved(full);
  assert.equal(full.flags.description, text);
  const two = base(); two.flags.description = 'Google said something else.';
  const p = packResolved(two)!;
  assert.equal(p.flags.description, 'Google said something else.');
  assert.equal(unpackResolved(p), p);
  assert.equal(packResolved(null), null);
});
