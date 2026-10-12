// Run with: npm test
// Request and cost behaviour of the book system: how many requests a Store open makes (cold, warm, with Google down), that the book info
// reuses what a shelf already resolved, and that the rating index answers exactly like a scan of the whole list (and faster).
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import type { Book } from '../../types';
import type { CuratedShelf } from '../../data/storeCatalog';
import { indexKnownRatings, knownRating, inferRatingSource, ratingOf } from './ratings';
import { sameWork } from './identity';
import { fetchBookMeta } from './details';
import { resolveBook } from './resolve';
import { bump, perfSnapshot, resetPerf } from './perf';
import { curatedSource, needsLookup } from '../store/curated';
import { routeFetch } from '../store/testkit';

const isOl = (u: URL) => u.hostname === 'openlibrary.org';
const isGoogle = (u: URL) => u.hostname === 'www.googleapis.com';
const isApple = (u: URL) => u.hostname === 'itunes.apple.com';
const olSearch = (title: string, author: string, extra: any = {}) => (u: URL) =>
  isOl(u) && u.pathname === '/search.json' ? { body: { docs: [{ key: `/works/OL${title.length}W`, title, author_name: [author], first_publish_year: 2020, cover_i: 4242, number_of_pages_median: 250, ...extra }] } } : undefined;
const olOther = (u: URL) => (isOl(u) ? { body: { docs: [], summary: {} } } : undefined);
const noApple = (u: URL) => (isApple(u) ? { body: { results: [] } } : undefined);
const googleDown = (u: URL) => (isGoogle(u) ? { status: 503, body: {} } : undefined);
const settle = () => new Promise(r => setTimeout(r, 520)); // persistentCache writes to storage 400 ms after a change
const hosts = (calls: string[], pred: (u: URL) => boolean) => calls.filter(c => pred(new URL(c, 'https://x.test'))).length;
const MIN = 60 * 1000;

/* ---------------- the rating index ---------------- */

const mk = (o: Partial<Book> & { id: string | number; title: string; author: string }): Book =>
  ({ shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2020', genre: 'Fiction', summary: '', authorBio: '', pageCount: 100, ...o }) as Book;

function bruteKnownRating(book: Book, known: readonly Book[]) {
  for (const k of known) {
    const r = ratingOf(k);
    if (r && sameWork(k, book, true)) return { ...r, ...(inferRatingSource(k) ? { source: inferRatingSource(k) } : {}) };
  }
  return undefined;
}

test('the rating index gives exactly the answer of a scan of the whole list, including which book wins', () => {
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % n; };
  const titles = ['Dune', 'Dune: A Novel', 'The Dune', 'Piranesi', 'Beloved', 'Beloved: The Edition', 'Mistborn: The Final Empire', 'Mistborn: The Well of Ascension', 'The Discomfort of Evening, De avond is ongemak', 'Hello, Goodbye', 'Unrelated'];
  const authors = ['Frank Herbert', 'Herbert, Frank', 'F. Herbert', 'Susanna Clarke', 'Toni Morrison', 'Brandon Sanderson', 'Marieke Lucas Rijneveld', 'Unknown Author', ''];
  const make = (i: number, rated: boolean): Book => mk({
    id: rnd(3) === 0 ? i : rnd(2) ? `ol_/works/OL${rnd(6)}W` : `x_${i}`,
    title: titles[rnd(titles.length)], author: authors[rnd(authors.length)],
    ...(rnd(3) === 0 ? { identity: { isbn13: `978000000000${rnd(5)}`, ...(rnd(2) ? { olWork: `OL${rnd(6)}W` } : {}), ...(rnd(4) === 0 ? { gbVolume: `v${rnd(3)}` } : {}) } } : {}),
    ...(rated && rnd(5) ? { ratingAverage: 3 + rnd(20) / 10, ratingCount: rnd(3) ? 10 + rnd(900) : undefined, ...(rnd(2) ? { ratingSource: 'apple' as const } : {}) } : {}),
  });
  let compared = 0;
  for (let round = 0; round < 30; round++) {
    const known = Array.from({ length: 40 }, (_, i) => make(i, true));
    const index = indexKnownRatings(known);
    for (let q = 0; q < 60; q++) {
      const card = make(1000 + q, false);
      assert.deepEqual(index.of(card), bruteKnownRating(card, known), `${card.title} / ${card.author} (${card.id})`);
      compared++;
    }
  }
  assert.equal(compared, 1800);
});

test('the rating index is the first book of the list that matches (a library book listed earlier wins)', () => {
  const first = mk({ id: 1, title: 'Dune', author: 'Frank Herbert', ratingAverage: 4.5, ratingCount: 900 });
  const second = mk({ id: 2, title: 'Dune: Deluxe Edition', author: 'Herbert, Frank', ratingAverage: 3.1, ratingCount: 40 });
  const store = mk({ id: 'ol_/works/OL1W', title: 'Dune', author: 'Frank Herbert' });
  assert.equal(indexKnownRatings([first, second]).of(store)?.average, 4.5);
  assert.equal(indexKnownRatings([second, first]).of(store)?.average, 3.1);
  assert.equal(knownRating(store, [mk({ id: 3, title: 'Dune', author: 'Someone Else', ratingAverage: 2, ratingCount: 5 })]), undefined); // another author: another book
});

test('looking up a whole Store of cards in a big library is cheaper through the index than a scan of the list', () => {
  const library = Array.from({ length: 600 }, (_, i) => mk({ id: `lib_${i}`, title: `Library Book Number ${i}`, author: `Author ${i % 90} Name`, ratingAverage: 4, ratingCount: 30 }));
  const cards = Array.from({ length: 240 }, (_, i) => mk({ id: `seed_${i}`, title: `Shelf Card ${i}`, author: `Writer ${i} Person` }));
  const t0 = performance.now();
  for (const c of cards) bruteKnownRating(c, library);
  const scan = performance.now() - t0;
  const t1 = performance.now();
  const index = indexKnownRatings(library); // building it is part of the cost
  for (const c of cards) index.of(c);
  const indexed = performance.now() - t1;
  assert.ok(indexed < scan, `indexed ${indexed.toFixed(1)} ms should beat the scan ${scan.toFixed(1)} ms`);
});

/* ---------------- what a card needs from the network ---------------- */

test('a Store card is looked up only when its cover or its rating is missing, never for a missing page count alone', () => {
  assert.equal(needsLookup({ coverUrl: 'https://c/1.jpg', ratingAverage: 4.2, pageCount: 0 }), false);
  assert.equal(needsLookup({ coverId: 12, ratingAverage: 4.2 }), false);
  assert.equal(needsLookup({ coverUrl: 'https://c/1.jpg', ratingAverage: undefined, pageCount: 300 }), true);
  assert.equal(needsLookup({ ratingAverage: 4.2, pageCount: 300 }), true);
});

/* ---------------- requests ---------------- */

test('Google being down costs one rating search (tried twice) per book, not one per title and author spelling', async () => {
  // a subtitle and a middle name give several spellings to try (2 titles x 3 authors): the old rating lookup tried 4 of them, 2 requests each
  const title = 'Down Alpha: The Long Subtitle Of A Book';
  const author = 'Ann Middle Author';
  const calls = routeFetch([olSearch(title, author), olOther, noApple, googleDown]);
  const r = await resolveBook({ title, author, apple: true });
  assert.equal(r?.book.ratingAverage, undefined);
  const ratingSearches = calls.filter(c => isGoogle(new URL(c, 'https://x.test')) && c.includes('maxResults=20')).length; // findGoogleRating asks for 20; the edition search for 6
  assert.ok(ratingSearches >= 1 && ratingSearches <= 2, `Google rating searches: ${ratingSearches}`);
});

test('a result that is unrated because Google failed is not asked again on the next launch, and waits longer after each failure', async () => {
  const shelf: CuratedShelf = { id: 'perf-shelf', title: 'Perf', emoji: '📚', genre: 'Fiction', seeds: [['Warm Alpha', 'Bea Author'], ['Warm Beta', 'Cy Author']] } as any;
  const calls = routeFetch([u => (isOl(u) && u.pathname === '/search.json' ? { body: { docs: [{ key: `/works/OL${u.searchParams.get('title')?.length}W`, title: u.searchParams.get('title'), author_name: [u.searchParams.get('author')], cover_i: 7, number_of_pages_median: 200 }] } } : undefined), olOther, noApple, googleDown]);
  await curatedSource(shelf).load(() => {});
  await settle();
  const cold = calls.length;
  assert.ok(cold > 0);
  const saved = JSON.parse(store.get('readlife.resolved3') || '{}');
  assert.equal(saved['warm alpha|bea author|a']?.v?.retry?.tries, 1); // the failure state is on disk, so a relaunch sees it

  // 9 minutes later (the old in-memory rule asked again after 2): a warm open makes no request at all
  mock.timers.enable({ apis: ['Date'], now: Date.now() + 9 * MIN });
  try {
    await curatedSource(shelf).load(() => {});
    assert.equal(calls.length, cold, 'a warm Store open must not touch the network');

    // past the first retry time it asks once more; Google is still down, so the next wait is longer (an hour)
    mock.timers.reset();
    mock.timers.enable({ apis: ['Date'], now: Date.now() + 11 * MIN });
    await curatedSource(shelf).load(() => {});
    assert.ok(calls.length > cold);
    const again = calls.length;
    await settle();
    assert.equal(JSON.parse(store.get('readlife.resolved3') || '{}')['warm alpha|bea author|a']?.v?.retry?.tries, 2);
    mock.timers.reset();
    mock.timers.enable({ apis: ['Date'], now: Date.now() + 40 * MIN });
    await curatedSource(shelf).load(() => {});
    assert.equal(calls.length, again, '40 minutes into a one-hour wait: nothing is asked');
  } finally { mock.timers.reset(); }
});

test('opening the book info of a card the shelf already resolved does not ask Google or Apple again', async () => {
  const calls = routeFetch([olSearch('Shared Gamma', 'Dee Author'), olOther, noApple, u => (isGoogle(u) ? { body: { items: [{ id: 'g9', volumeInfo: { title: 'Shared Gamma', authors: ['Dee Author'], pageCount: 210 } }] } } : undefined)]);
  await resolveBook({ title: 'Shared Gamma', author: 'Dee Author', apple: true }); // what the shelf does
  const before = { google: hosts(calls, isGoogle), apple: hosts(calls, isApple) };
  await fetchBookMeta(mk({ id: 'ol_shared_gamma', title: 'Shared Gamma', author: 'Dee Author', pageCount: 0, ratingAverage: undefined }));
  assert.equal(hosts(calls, isGoogle), before.google);
  assert.equal(hosts(calls, isApple), before.apple);
});

/* ---------------- measurement ---------------- */

test('the request counters count per host and keep failures without the API key', async () => {
  resetPerf();
  routeFetch([olSearch('Count Alpha', 'Eve Author'), olOther, noApple, googleDown]);
  await resolveBook({ title: 'Count Alpha', author: 'Eve Author', apple: true });
  bump('test.counter', 2);
  const snap = perfSnapshot();
  assert.ok(snap.counters['net.www.googleapis.com'] >= 1);
  assert.ok(snap.counters['net.failed.www.googleapis.com.503'] >= 1);
  assert.equal(snap.counters['test.counter'], 2);
  assert.ok(snap.failures.every(f => !JSON.stringify(f).includes('key=')));
});
