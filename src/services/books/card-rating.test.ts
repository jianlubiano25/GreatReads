// Run with: npm test
// A Discover card and Book Info show the SAME main rating: the card follows what is saved for the book (infoStore), not only the pair it carries.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { bookKey } from './identity';
const card = { id: 'disc1', title: 'Card Alpha', author: 'Cara Writer', shelf: 'mine', difficulty: 0, isOnDevice: false, year: '2020', genre: 'Fiction', summary: '', authorBio: '', pageCount: 300, ratingAverage: 3.9, ratingCount: 120, ratingSource: 'openlibrary' } as any;
// Apple's rating is saved for this book (a lookup found it); the card was built earlier with Open Library's
store.set('readlife.ratingsrc3', JSON.stringify({ [bookKey(card)]: { t: Date.now(), v: [{ source: 'apple', average: 4.6, count: 8000 }, { source: 'openlibrary', average: 3.9, count: 120 }] } }));

import { applyInfo, getInfo, shownRating, siteRatingsOf } from './infoStore';
import { mainRating } from './ratings';

test('Open Library on the card, Apple saved: the card and Book Info both show Apple as the main rating', () => {
  const onCard = shownRating(card);
  const entry = getInfo(card);
  const inBookInfo = mainRating(applyInfo(card, entry), siteRatingsOf(entry)); // exactly what Book Info calls
  assert.equal(onCard?.source, 'apple');
  assert.deepEqual(onCard, inBookInfo);
});

test('nothing saved for the book: the card keeps its own pair (shownRating gives way)', () => {
  const lone = { ...card, id: 'disc2', title: 'Lone Beta', author: 'Lou Writer' };
  assert.equal(shownRating(lone), undefined);
});
