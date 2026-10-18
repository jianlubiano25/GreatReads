// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { coverQuality, coverBonus, isWeakCover } from './coverQuality';
import { fillMissingCovers } from './covers';
import { rank, forgetRecentSearchesForTests } from './search';
import { forgetSeenForTests } from './localIndex';
import { parseQuery } from './query';
import { isNytCoverUrl } from './model';

const APPLE = 'https://is1-ssl.mzstatic.com/image/thumb/Publication/x/600x900bb.jpg';
const NYT = 'https://storage.googleapis.com/du-prd/books/images/9781234567890.jpg';
const GOOGLE = 'https://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1';
const GOOGLE_PAGE = 'https://books.google.com/books/content?id=abc&pg=PA12&img=1&zoom=1';

const book = (o: any) => ({ id: o.title, title: 'T', author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2015', genre: 'Fiction', summary: 'A novel about things that happen to people in a town.', authorBio: '', pageCount: 300, ratingCount: 5000, ratingAverage: 4.2, ...o }) as any;

test('cover quality: Apple art, then a Google front cover, then Open Library or another link, then the NYT image, then nothing', () => {
  assert.equal(coverQuality({ coverUrl: APPLE }), 3);
  assert.equal(coverQuality({ coverUrl: GOOGLE }), 2);
  assert.equal(coverQuality({ coverUrl: GOOGLE_PAGE }), 1, 'a Google picture of an inside page is not a front cover');
  assert.equal(coverQuality({ coverId: 123 }), 1);
  assert.equal(coverQuality({ coverUrl: 'https://example.com/x.jpg' }), 1);
  assert.equal(coverQuality({ coverUrl: NYT }), 0.5);
  assert.equal(coverQuality({}), 0);
  assert.equal(isNytCoverUrl(NYT), true);
  assert.equal(isNytCoverUrl(APPLE), false);
  assert.ok(isWeakCover({ coverId: 5 }) && isWeakCover({ coverUrl: NYT }));
  assert.ok(!isWeakCover({ coverUrl: APPLE }) && !isWeakCover({ coverUrl: GOOGLE }) && !isWeakCover({}));
});

test('the cover bonus grows with the quality of the cover, and stays a small tiebreaker', () => {
  const b = (c: any) => coverBonus(c);
  assert.ok(b({ coverUrl: APPLE }) > b({ coverUrl: GOOGLE }) && b({ coverUrl: GOOGLE }) > b({ coverId: 1 }) && b({ coverId: 1 }) > b({ coverUrl: NYT }) && b({ coverUrl: NYT }) > b({}));
  assert.equal(b({ coverId: 1 }), 8, 'an ordinary cover is worth what it always was');
  assert.ok(b({ coverUrl: APPLE }) < 20, 'never enough to beat a better title match');
});

test('search: of two equally good matches, the one with a modern flat front comes first; a poorer title match is not lifted above a better one', () => {
  forgetRecentSearchesForTests(); forgetSeenForTests();
  const q = parseQuery('the hollow garden', '', false, 'all');
  const old = book({ id: 'old', title: 'The Hollow Garden', author: 'Ann Writer', coverId: 777 });
  const modern = book({ id: 'modern', title: 'The Hollow Garden', author: 'Ann Writer', coverUrl: GOOGLE, year: '2015' });
  const names = (list: any[]) => rank(list, q, 5).map(x => x.id);
  // the same book from two sources is ONE result, and it keeps the better cover (here the Google front, not the old Open Library scan), whichever came first
  for (const order of [[old, modern], [modern, old]]) {
    const out = rank(order, q, 5);
    assert.equal(out.length, 1);
    assert.equal(out[0].coverUrl, GOOGLE);
    assert.equal(out[0].coverId, undefined);
  }
  const rival = book({ id: 'rival', title: 'The Hollow Garden', author: 'Cy Different', coverUrl: GOOGLE });
  const rival2 = book({ id: 'rival2', title: 'The Hollow Garden', author: 'Di Another', coverId: 4 });
  assert.equal(names([rival2, rival])[0], 'rival', 'two different books with the same title: the one with the flat front first');
  const looser = book({ id: 'looser', title: 'Garden Notes', author: 'Bo Other', coverUrl: APPLE });
  assert.equal(names([looser, old])[0], 'old', 'the exact title still wins over a better cover');
});

test('results with a weak cover get a look for a flat front (first few only); good covers and covers that come back the same are left alone', async () => {
  const asked: string[] = [];
  const found: Record<string, string> = { 'Old Scan': APPLE, 'Same One': 'https://covers.openlibrary.org/b/id/5-M.jpg' };
  const resolve = (async (b: any) => { asked.push(b.title); return found[b.title] || ''; }) as any;
  const list = [
    book({ title: 'Old Scan', coverId: 5 }),
    book({ title: 'Already Apple', coverUrl: APPLE }),
    book({ title: 'Same One', coverId: 5 }),
    book({ title: 'No Cover' }),
    book({ title: 'Third Weak', coverId: 8 }),
  ];
  const updates: any[][] = [];
  await new Promise<void>(done => { fillMissingCovers(list, r => updates.push(r), undefined, { upgradeWeak: 2, resolve }); setTimeout(done, 20); });
  assert.deepEqual(asked.sort(), ['No Cover', 'Old Scan', 'Same One'], 'a missing cover is always looked for; only 2 weak ones are; an Apple cover never');
  const last = updates[updates.length - 1];
  assert.equal(last[0].coverUrl, APPLE);
  assert.equal(last[0].coverId, undefined, 'the old scan is replaced');
  assert.equal(last[2].coverId, 5, 'the same picture is not swapped in');
  // by default nothing weak is touched (Store shelves and the like keep their covers)
  const plain: string[] = [];
  await new Promise<void>(done => { fillMissingCovers(list, () => {}, undefined, { resolve: (async (b: any) => { plain.push(b.title); return ''; }) as any }); setTimeout(done, 20); });
  assert.deepEqual(plain, ['No Cover']);
});
