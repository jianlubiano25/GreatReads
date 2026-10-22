import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCustomBooks, sanitizeGarden, sanitizeNumberRecord, sanitizeProfile, sanitizeWords } from './stateSanitizer';
import { emptyGarden } from './garden';

test('record sanitizers drop prototype-sensitive keys', () => {
  const raw = JSON.parse('{"__proto__":4,"constructor":5,"safe":6}');
  const numbers = sanitizeNumberRecord(raw);
  assert.deepEqual(numbers, { safe: 6 });
  assert.equal(Object.getPrototypeOf(numbers), Object.prototype);

  const garden = sanitizeGarden(JSON.parse('{"plants":{"__proto__":{"growth":1},"fern":{"growth":0.4}},"achievements":{}}'));
  assert.ok(garden);
  assert.equal(Object.hasOwn(garden.plants, '__proto__'), false);
  assert.ok(Object.hasOwn(garden.plants, 'fern'));
});

test('custom books validate identifiers, fields, URLs, and shelf names', () => {
  const books = sanitizeCustomBooks([
    { id: '__proto__', title: 'Reserved', shelf: 'mine' },
    { id: 'same', title: 'Safe book', shelf: 'unknown', coverUrl: 'javascript:alert(1)', extra: 'discard me' },
    { id: 'same', title: 'Duplicate', shelf: 'mine' },
    { id: 'valid', title: 'Secure cover', shelf: 'joy', coverUrl: '//covers.example/book.jpg' },
  ]);
  assert.equal(books.length, 2);
  assert.equal(books[0].shelf, 'mine');
  assert.equal(books[0].coverUrl, undefined);
  assert.equal('extra' in books[0], false);
  assert.equal(books[1].coverUrl, 'https://covers.example/book.jpg');
});

test('word identifiers stay unique and audio URLs must use HTTPS', () => {
  const words = sanitizeWords([
    { id: 'shared', word: 'first', audioUrl: 'javascript:alert(1)' },
    { id: 'shared', word: 'second', audioUrl: 'https://audio.example/word.mp3' },
  ]);
  assert.notEqual(words[0].id, words[1].id);
  assert.equal(words[0].audioUrl, '');
  assert.equal(words[1].audioUrl, 'https://audio.example/word.mp3');
});

test('profile photos accept supported image data and secure URLs only', () => {
  const fallback = { name: '', photo: '', theme: 'auto' as const };
  assert.equal(sanitizeProfile({ photo: 'javascript:alert(1)' }, fallback).photo, '');
  assert.equal(sanitizeProfile({ photo: 'https://images.example/avatar.jpg' }, fallback).photo, 'https://images.example/avatar.jpg');
  assert.equal(sanitizeProfile({ photo: 'data:image/jpeg;base64,abc' }, fallback).photo, 'data:image/jpeg;base64,abc');
});
test('saved books keep each rating pair and the site it came from; an unknown source or a missing rating keeps none', () => {
  const books = sanitizeCustomBooks([
    { id: 'a', title: 'Apple rated', ratingAverage: 4.4, ratingCount: 700, ratingSource: 'apple' },
    { id: 'g', title: 'Google rated', ratingAverage: 4.2, ratingCount: 1, ratingSource: 'google' },
    { id: 'o', title: 'OL rated', ratingAverage: 3.9, ratingCount: 55, ratingSource: 'openlibrary' },
    { id: 7, title: 'Hand written', ratingAverage: 4.6, ratingCount: 18, ratingSource: 'library' },
    { id: 'bad', title: 'Odd source', ratingAverage: 4, ratingCount: 9, ratingSource: 'goodreads' },
    { id: 'none', title: 'No rating', ratingSource: 'apple' },
    { id: 'old', title: 'Saved before sources existed', ratingAverage: 4, ratingCount: 9 },
  ]);
  const pair = (i: number) => [books[i].ratingAverage, books[i].ratingCount, books[i].ratingSource];
  assert.deepEqual(pair(0), [4.4, 700, 'apple']);
  assert.deepEqual(pair(1), [4.2, 1, 'google']);
  assert.deepEqual(pair(2), [3.9, 55, 'openlibrary']);
  assert.deepEqual(pair(3), [4.6, 18, 'library']);
  assert.deepEqual(pair(4), [4, 9, undefined]);
  assert.deepEqual(pair(5), [undefined, undefined, undefined]);
  assert.deepEqual(pair(6), [4, 9, undefined]); // older saved books: unchanged (the source is worked out when needed)
});

import { parseBackup } from './stateSanitizer';

const baseState: any = { status: {}, currentPage: {}, totalPages: {}, dailyLog: {}, notes: {}, highlights: {}, goal: { type: 'pages', target: 20 }, readingIntention: '', profile: { name: '', avatar: '' }, customBooks: [], onDeviceOverrides: {}, hiddenBookIds: {}, words: [], garden: emptyGarden(), history: {}, ratings: {} };

test('a backup whose highlight holds curly quotes restores (the file is valid JSON; curly quotes inside text are not JSON quotes)', () => {
  const text = JSON.stringify({ status: { '1': 'now' }, notes: { '1': 'He said “hello” and ‘left’' }, highlights: { '1': [{ id: 'h', text: '“The word ‘love’ is most often', page: 3 }] } }, null, 2);
  const r = parseBackup(text, baseState);
  assert.ok(r, 'parsed');
  assert.equal(r!.status['1'], 'now');
  assert.equal(r!.notes['1'], 'He said “hello” and ‘left’'); // untouched
});

test('a pasted copy whose quotes were turned curly is still repaired', () => {
  const r = parseBackup('{“status”: {“1”: “now”}}', baseState);
  assert.equal(r?.status['1'], 'now');
});

test('garbage is still rejected', () => {
  assert.equal(parseBackup('not json', baseState), null);
  assert.equal(parseBackup('[1,2]', baseState), null);
});
