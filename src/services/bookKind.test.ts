import test from 'node:test';
import assert from 'node:assert/strict';
import { bookKind } from './bookKind';

const kind = (genre: string) => bookKind({ genre });

test('non-fiction beats the word fiction within it', () => {
  assert.equal(kind('Non-fiction / Essays'), 'nonfiction');
  assert.equal(kind('Non-fiction'), 'nonfiction');
  assert.equal(kind('Nonfiction'), 'nonfiction');
});

test('fiction subgenres mentioning history or science remain fiction', () => {
  assert.equal(kind('Fiction / Historical'), 'fiction');
  assert.equal(kind('Historical fiction'), 'fiction');
  assert.equal(kind('Science fiction'), 'fiction');
  assert.equal(kind('Fiction / Sci-Fi'), 'fiction');
});

test('typical non-fiction genres', () => {
  for (const genre of ['Self-help', 'Memoir', 'Philosophy / Self-help', 'Psychology / Self-help', 'Self-help / Career', 'Self-help / Creativity']) {
    assert.equal(kind(genre), 'nonfiction', genre);
  }
});

test('typical fiction genres and unknowns', () => {
  for (const genre of ['Fiction', 'Fiction / Mystery', 'Romance', 'Fantasy', 'Classic', 'Mystery', '', 'Book']) {
    assert.equal(kind(genre), 'fiction', genre);
  }
});