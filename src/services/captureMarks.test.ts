import test from 'node:test';
import assert from 'node:assert/strict';
import { shortMark } from './capture';
import { LAST_RESORT_KEYS } from './books/cache';

test('shortMark: a long sent-mark becomes a short fingerprint, the same every time, never hashed twice', () => {
  const long = 'cover:set boundaries find peace|nedra glover tawwab|https://example.com/images/some/very/long/path/cover.jpg';
  const a = shortMark(long);
  assert.ok(a.startsWith('~') && a.length <= 20 && a.length < long.length / 3, a);
  assert.equal(shortMark(long), a);
  assert.equal(shortMark(a), a); // marks saved in the short form are read back unchanged
  assert.notEqual(shortMark(long + 'x'), a);
  assert.notEqual(shortMark('a'), shortMark('b'));
});

test('the owner marks can be freed as a last resort when a save fails', () => {
  assert.ok(LAST_RESORT_KEYS.includes('readlife.captured1'));
});
