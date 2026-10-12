// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAddBook } from './library';
import { DEFAULT_BOOKS } from '../data/defaultBooks';
import type { ReadingState } from '../types';

const base = (over: Partial<ReadingState> = {}): ReadingState => ({
  status: {}, currentPage: {}, totalPages: {}, dailyLog: {}, notes: {}, highlights: {}, goal: 10, readingIntention: '',
  profile: { name: '', photo: '', theme: 'auto' }, customBooks: [], onDeviceOverrides: {}, hiddenBookIds: {}, words: [],
  garden: { plants: {}, placements: {}, achievements: {}, celebrated: {} } as any, ...over,
});
const piranesi = () => DEFAULT_BOOKS.find(b => b.title === 'Piranesi')!;
const fromSearch = () => ({ ...piranesi(), id: 'search_piranesi', identity: undefined, isOnDevice: false } as any);

test('adding a built-in book from search to the library keeps it on the device', () => {
  const prev = base();
  assert.equal(piranesi().isOnDevice, true);
  const next = applyAddBook(prev, fromSearch(), 'library');
  assert.equal(String(piranesi().id) in next.onDeviceOverrides, false, 'no on-device override may be written');
  assert.equal(next.status[String(piranesi().id)], 'list');
  assert.equal(next.customBooks.length, 0, 'the built-in book is not copied');
});

test('an existing on-device choice survives adding to the library', () => {
  const id = String(piranesi().id);
  const next = applyAddBook(base({ onDeviceOverrides: { [id]: false } }), fromSearch(), 'library');
  assert.equal(next.onDeviceOverrides[id], false);
});

test('choosing "device" writes the on-device setting', () => {
  const next = applyAddBook(base(), fromSearch(), 'device');
  assert.equal(next.onDeviceOverrides[String(piranesi().id)], true);
});

test('a new custom book added to the library is not on the device', () => {
  const b = { id: 'new_1', title: 'Brand New Zzyzx Book', author: 'Nobody Known', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2026', genre: 'Fiction', summary: '', authorBio: '' } as any;
  const next = applyAddBook(base(), b, 'library');
  assert.equal(next.customBooks[0].isOnDevice, false);
  assert.deepEqual(next.onDeviceOverrides, {});
});

test('Mistborn volumes are different books, so the second one is really added', () => {
  const mk = (id: string, title: string) => ({ id, title, author: 'Brandon Sanderson', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2006', genre: 'Fantasy', summary: '', authorBio: '' }) as any;
  let s = applyAddBook(base(), mk('m1', 'Mistborn: The Final Empire'), 'library');
  s = applyAddBook(s, mk('m2', 'Mistborn: The Well of Ascension'), 'library');
  assert.equal(s.customBooks.length, 2);
  assert.equal(s.status.m1, 'list');
  assert.equal(s.status.m2, 'list');
});
