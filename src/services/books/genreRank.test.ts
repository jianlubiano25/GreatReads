import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diversify, kindAdjust, kindOfQuery, thinRecord, KIND_MISMATCH } from './genreRank';
import { SEARCH_GENRES } from '../../data/searchGenres';
import { SHELF_BY_ID } from '../store/registry';

test('a genre search knows what kind of book it wants, and so do its sub-genres', () => {
  assert.equal(kindOfQuery('fantasy'), 'fiction');
  assert.equal(kindOfQuery('epic fantasy'), 'fiction');
  assert.equal(kindOfQuery('Psychology'), 'nonfiction');
  assert.equal(kindOfQuery('stoicism'), 'nonfiction');
  assert.equal(kindOfQuery('classics'), undefined); // both kinds
  assert.equal(kindOfQuery('harry potter'), undefined);
});

test('a book of the other kind is pushed down; one with no known genre is left alone', () => {
  assert.equal(kindAdjust({ genre: 'Fantasy' }, 'fiction'), 0);
  assert.equal(kindAdjust({ genre: 'Psychology' }, 'fiction'), KIND_MISMATCH);
  assert.equal(kindAdjust({ genre: 'Fiction' }, 'nonfiction'), KIND_MISMATCH);
  assert.equal(kindAdjust({ genre: 'General' }, 'nonfiction'), 0);
  assert.equal(kindAdjust({ genre: 'Fiction' }, undefined), 0);
});

test('an unrated, cover-less record is held back a little; a rated or covered one is not', () => {
  assert.ok(thinRecord({}) < 0);
  assert.equal(thinRecord({ ratingCount: 12 }), 0);
  assert.equal(thinRecord({ coverUrl: 'x' }), 0);
});

test('one author takes at most two of the first places; nothing is dropped', () => {
  const books = [
    ...['a1', 'a2', 'a3', 'a4'].map(t => ({ title: t, author: 'Terry Pratchett' })),
    { title: 'b1', author: 'Ursula Le Guin' },
    { title: 'c1', author: 'N. K. Jemisin' },
    { title: 'u1', author: 'Unknown Author' },
    { title: 'u2', author: 'Unknown Author' },
  ];
  const out = diversify(books, 2, 6);
  assert.equal(out.length, books.length);
  assert.deepEqual(out.slice(0, 6).map(b => b.title), ['a1', 'a2', 'b1', 'c1', 'u1', 'u2']);
  assert.deepEqual(out.slice(6).map(b => b.title), ['a3', 'a4']);
});

test('every genre has either a Store shelf that exists or at least ten hand-picked books, and sub-genres', () => {
  for (const g of SEARCH_GENRES) {
    if (g.shelfId) assert.ok(SHELF_BY_ID[g.shelfId], `${g.label}: no Store shelf "${g.shelfId}"`);
    else assert.ok((g.picks?.length ?? 0) >= 10, `${g.label}: needs picks`);
    assert.ok(g.subgenres.length >= 3, `${g.label}: needs sub-genres`);
  }
  const labels = SEARCH_GENRES.map(g => g.label);
  assert.equal(new Set(labels).size, labels.length);
});
