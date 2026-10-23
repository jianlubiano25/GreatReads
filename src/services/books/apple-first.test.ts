// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { makeBook, isAppleCoverUrl } from './model';
import { mergeBooks } from './merge';
import { combineWithNyt } from '../store/nytBooks';
import { lookupSummary } from './details';
import { routeFetch } from '../store/testkit';

const APPLE = 'https://is1-ssl.mzstatic.com/image/thumb/Publication/x/600x900bb.jpg';
const NYT = 'https://storage.googleapis.com/du-prd/books/images/9781234567890.jpg';

test('Apple art is recognised, and beats an NYT render or any other copy in a merge', () => {
  assert.equal(isAppleCoverUrl(APPLE), true);
  assert.equal(isAppleCoverUrl(NYT), false);
  const nyt = makeBook({ id: 'nyt_1', title: 'The Witch', author: 'Freida McFadden', coverUrl: NYT, awardLabel: 'NYT bestseller' });
  const resolved = makeBook({ id: 'ol_/works/OL1W', title: 'The Witch', author: 'Freida McFadden', coverUrl: APPLE });
  assert.equal(combineWithNyt(nyt, resolved).coverUrl, APPLE); // the Discover shelf
  assert.equal(mergeBooks(nyt, resolved).coverUrl, APPLE); // the collated shelf merges the NYT book first
  assert.equal(mergeBooks(makeBook({ id: 'a', title: 'The Witch', author: 'Freida McFadden', coverId: 5 }), resolved).coverId, undefined);
  // no Apple art: ANY flat front from another source beats the NYT's marketing image (an Open Library cover, a Google Books front); the NYT image stands in only when there is nothing else
  const GOOGLE = 'https://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1';
  assert.equal(combineWithNyt(nyt, makeBook({ id: 'x', title: 'The Witch', author: 'Freida McFadden', coverId: 9 })).coverUrl, undefined);
  assert.equal(combineWithNyt(nyt, makeBook({ id: 'x', title: 'The Witch', author: 'Freida McFadden', coverId: 9 })).coverId, 9);
  assert.equal(combineWithNyt(nyt, makeBook({ id: 'x', title: 'Threshing Day', author: 'Rebecca Yarros', coverUrl: GOOGLE })).coverUrl, GOOGLE);
  assert.equal(combineWithNyt(nyt, makeBook({ id: 'x', title: 'The Witch', author: 'Freida McFadden' })).coverUrl, NYT);
  // and in a merge: a real cover replaces the NYT image, while an existing ordinary cover is not replaced by another ordinary one
  assert.equal(mergeBooks(makeBook({ id: 'a', title: 'T', author: 'A B', coverUrl: NYT }), makeBook({ id: 'b', title: 'T', author: 'A B', coverUrl: 'https://g/x.jpg' })).coverUrl, 'https://g/x.jpg');
  assert.equal(mergeBooks(makeBook({ id: 'a', title: 'T', author: 'A B', coverUrl: NYT }), makeBook({ id: 'b', title: 'T', author: 'A B', coverId: 4 })).coverId, 4);
  assert.equal(mergeBooks(makeBook({ id: 'a', title: 'T', author: 'A B', coverUrl: 'https://first/x.jpg' }), makeBook({ id: 'b', title: 'T', author: 'A B', coverUrl: 'https://g/x.jpg' })).coverUrl, 'https://first/x.jpg');
  assert.equal(mergeBooks(makeBook({ id: 'a', title: 'T', author: 'A B', coverUrl: 'https://g/x.jpg' }), makeBook({ id: 'b', title: 'T', author: 'A B', coverUrl: NYT })).coverUrl, 'https://g/x.jpg');
});

test('lookupSummary falls back to Apple Books’ English description when Open Library and Google have none', async () => {
  const desc = '<p>A woman returns to her childhood village and finds that the whispers about the old house on the hill were never only stories, and that someone wants her gone.</p>';
  routeFetch([u => (u.hostname.includes('itunes.apple.com') ? { body: { results: [{ trackId: 1, trackName: 'The Witch', artistName: 'Freida McFadden', artworkUrl100: 'https://is1-ssl.mzstatic.com/a/100x100bb.jpg', description: desc }] } } : undefined)]);
  const text = await lookupSummary(makeBook({ id: 'nyt_1', title: 'The Witch', author: 'Freida McFadden' }));
  assert.match(text, /^A woman returns to her childhood village/);
  assert.ok(!text.includes('<p>'));
});
