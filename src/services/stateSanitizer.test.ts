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