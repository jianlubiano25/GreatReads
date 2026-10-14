// Run with: npm test
// ONE resolver for the Store cards, the book info and the prefetch script: the sheet shows the card's own rating, both screens (and the
// prefetched data) reach the same saved result, an unreachable Apple is never remembered as "Apple has no rating", and the prefetch
// record is built from the resolver (strict matching, the same ladder) instead of rules of its own.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { mainRating, otherRatings } from './ratings';
import { fetchBookMeta, fetchRatingSources } from './details';
import { resolveBook, resolveKey } from './resolve';
import { isCurrentRecord, PREFETCH_VERSION, toPrefetchedRecord } from './prefetchRecord';
import { routeFetch } from '../store/testkit';

const book = (o: any) => ({ id: o.title, title: 'T', author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2020', genre: 'Fiction', summary: 'x'.repeat(80), authorBio: '', pageCount: 300, ...o }) as any;
const isOl = (u: URL) => u.hostname === 'openlibrary.org';
const isGoogle = (u: URL) => u.hostname === 'www.googleapis.com';
const isApple = (u: URL) => u.hostname === 'itunes.apple.com';
const olSearch = (key: string, title: string, author: string, extra: any = {}) => (u: URL) =>
  isOl(u) && u.pathname === '/search.json' ? { body: { docs: [{ key, title, author_name: [author], first_publish_year: 2020, cover_i: 4242, number_of_pages_median: 250, ...extra }] } } : undefined;
const olOther = (u: URL) => (isOl(u) ? { body: { docs: [], summary: {} } } : undefined);
const gbItem = (id: string, title: string, author: string, extra: any = {}) => ({ id, volumeInfo: { title, authors: [author], publishedDate: '2020', pageCount: 200, ...extra } });
const google = (items: any[]) => (u: URL) => (isGoogle(u) ? { body: { items } } : undefined);
const appleHit = (title: string, author: string, average?: number, count?: number) => ({ trackId: 9, trackName: title, artistName: author, artworkUrl100: 'https://a/100x100bb.jpg', averageUserRating: average, userRatingCount: count });
const apple = (...results: any[]) => (u: URL) => (isApple(u) ? { body: { results } } : undefined);
const appleDown = (u: URL) => (isApple(u) ? { status: 503, body: {} } : undefined);
const settle = () => new Promise(r => setTimeout(r, 520)); // persistentCache writes to storage 400 ms after a change
const hosts = (calls: string[], pred: (u: URL) => boolean) => calls.filter(c => pred(new URL(c, 'https://x.test'))).length;
const pairOf = (b: any) => [b?.ratingAverage, b?.ratingCount, b?.ratingSource];
const mainPair = (r: any) => [r?.average, r?.count, r?.source];

test('the book info follows the ladder over the live sites; a card\'s pair only stands in for its own site', () => {
  // the card's pair came from Open Library (e.g. resolved before Apple answered); a live Apple rating exists now and ranks first
  const card = { id: 'ol_x', source: 'openlibrary', ratingAverage: 4.1, ratingCount: 300, ratingSource: 'openlibrary' } as any;
  const live = [{ source: 'openlibrary', average: 4.1, count: 300 }, { source: 'apple', average: 3.2, count: 90 }, { source: 'google', average: 3.9, count: 40 }] as any;
  const main = mainRating(card, live);
  assert.deepEqual(mainPair(main), [3.2, 90, 'apple']);
  assert.deepEqual(otherRatings(live, main?.source).map(f => f.source), ['openlibrary', 'google']); // the others sit beside it, once each

  // nothing live outranks the card's own site: its pair is still the main rating (a card and its sheet agree when the ladder agrees)
  const liveNoApple = live.filter((f: any) => f.source !== 'apple');
  assert.deepEqual(mainPair(mainRating(card, liveNoApple)), [4.1, 300, 'openlibrary']);
  assert.deepEqual(mainPair(mainRating(card, [])), [4.1, 300, 'openlibrary']); // nothing live yet: the saved pair is shown at once

  // a book with no rating of its own takes the ladder over the live sites: Apple first
  const bare = { id: 'ol_y', source: 'openlibrary' } as any;
  assert.deepEqual(mainPair(mainRating(bare, live)), [3.2, 90, 'apple']);

  // a saved pair whose source was never recorded is attributed to the one site whose own pair it is exactly; the ladder still decides
  const sourceless = { id: 'ol_z', source: 'openlibrary', ratingAverage: 4.1, ratingCount: 300 } as any;
  assert.deepEqual(mainPair(mainRating(sourceless, live)), [3.2, 90, 'apple']);
  assert.deepEqual(mainPair(mainRating(sourceless, liveNoApple)), [4.1, 300, 'openlibrary']);
  const unknown = { id: 'ol_w', source: 'openlibrary', ratingAverage: 2.5, ratingCount: 7 } as any;
  assert.deepEqual(mainPair(mainRating(unknown, live)), [3.2, 90, 'apple']);
  // the library's own rating is still first
  assert.deepEqual(mainPair(mainRating({ id: 7, source: 'curated', ratingAverage: 4.6, ratingCount: 18400 } as any, live)), [4.6, 18400, 'library']);
});

test('the Store card and the book info reach ONE saved result however the author is written', async () => {
  const routes = [olSearch('/works/OL501W', 'Key Alpha', 'Ann Author'), olOther, google([gbItem('k1', 'Key Alpha', 'Ann Author', { averageRating: 3.9, ratingsCount: 50 })]), apple(appleHit('Key Alpha', 'Ann Author', 4.2, 120))];
  const calls = routeFetch(routes);
  assert.equal(resolveKey({ title: 'Key Alpha', author: 'Ann Author & Bo Writer', apple: true }), resolveKey({ title: 'The Key Alpha: A Novel', author: 'Author, Ann', apple: true }));
  const card = await resolveBook({ title: 'Key Alpha', author: 'Ann Author', apple: true });
  assert.deepEqual(pairOf(card?.book), [4.2, 120, 'apple']);
  const used = calls.length;

  // the book info opens the same book (author written with a co-author, a subtitle on the title, a different record id): no request at all
  const meta = await fetchBookMeta(book({ id: 'ol_/works/OL501W', title: 'Key Alpha: A Novel', author: 'Ann Author & Bo Writer' }));
  assert.deepEqual([meta?.ratingAverage, meta?.ratingCount, meta?.ratingSource], [4.2, 120, 'apple']); // Apple first, as on the card
  assert.equal(calls.length, used, 'the sheet must reuse what the card resolved');
});

test('the book info does not take Open Library\'s rating over Apple\'s when the book was never on a shelf', async () => {
  routeFetch([olSearch('/works/OL502W', 'Ladder Alpha', 'Cy Author', { ratings_average: 4.4, ratings_count: 900 }), olOther, google([]), apple(appleHit('Ladder Alpha', 'Cy Author', 3.8, 60))]);
  const meta = await fetchBookMeta(book({ id: 'saved-1', title: 'Ladder Alpha', author: 'Cy Author' }));
  assert.deepEqual([meta?.ratingAverage, meta?.ratingCount, meta?.ratingSource], [3.8, 60, 'apple']);
  assert.equal(meta?.pageCount, 250); // pages still come from Open Library
});

test('Apple being unreachable is not remembered as "no Apple rating": the book is asked again, and the sheet does not save a partial answer', async () => {
  const olRated = olSearch('/works/OL503W', 'Dune Alpha', 'Di Author', { ratings_average: 4.5, ratings_count: 400 });
  const calls = routeFetch([olRated, olOther, google([]), appleDown]);
  const first = await resolveBook({ title: 'Dune Alpha', author: 'Di Author', apple: true });
  assert.deepEqual(pairOf(first?.book), [4.5, 400, 'openlibrary']); // the best that could be found
  assert.ok(first?.retry && first.retry.tries === 1, 'saved WITH a retry time, not as final');
  await settle();
  const used = calls.length;
  await resolveBook({ title: 'Dune Alpha', author: 'Di Author', apple: true }); // reopened right away: not asked again yet
  assert.equal(calls.length, used);

  // the rating sources of the sheet: Apple failed, so the week-long cache is not written
  const b = book({ id: 'dune-a', title: 'Dune Alpha', author: 'Di Author' });
  const found = await fetchRatingSources(b);
  assert.deepEqual(found.map(f => f.source), ['openlibrary']);
  await settle();
  assert.equal(store.get('readlife.ratingsrc3')?.includes('dune alpha') ?? false, false);

  // later Apple answers: it becomes the book's rating (ladder), and a final result is saved
  mock.timers.enable({ apis: ['Date'], now: Date.now() + 11 * 60 * 1000 });
  try {
    routeFetch([olRated, olOther, google([]), apple(appleHit('Dune Alpha', 'Di Author', 4.0, 800))]);
    const later = await resolveBook({ title: 'Dune Alpha', author: 'Di Author', apple: true });
    assert.deepEqual(pairOf(later?.book), [4, 800, 'apple']);
    assert.equal(later?.retry, undefined);
    assert.deepEqual((await fetchRatingSources(b)).map(f => f.source), ['openlibrary', 'apple']);
  } finally { mock.timers.reset(); }

  // Apple ANSWERED with no such book: that is final (no retry)
  routeFetch([olSearch('/works/OL504W', 'Dune Beta', 'Ed Author', { ratings_average: 4, ratings_count: 50 }), olOther, google([]), apple()]);
  const final = await resolveBook({ title: 'Dune Beta', author: 'Ed Author', apple: true });
  assert.equal(final?.retry, undefined);
});

test('Apple\'s art is the cover when Apple has the book (title and author must match); a look-alike from another author is ignored', async () => {
  routeFetch([olSearch('/works/OL505W', 'Cover Alpha', 'Fay Author'), olOther, google([]), apple(appleHit('Cover Alpha', 'Fay Author', 4, 30))]);
  const ok = (await resolveBook({ title: 'Cover Alpha', author: 'Fay Author', apple: true }))!.book;
  assert.equal(ok.coverUrl, 'https://a/600x900bb.jpg');
  assert.equal(ok.coverId, undefined);

  // Apple's first result is the same title by someone else: not this book, so neither its cover nor its rating is used
  routeFetch([olSearch('/works/OL506W', 'Cover Beta', 'Gus Author', { ratings_average: 4.2, ratings_count: 80 }), olOther, google([]), apple(appleHit('Cover Beta', 'Somebody Else', 5, 9999))]);
  const wrong = (await resolveBook({ title: 'Cover Beta', author: 'Gus Author', apple: true }))!.book;
  assert.equal(wrong.coverId, 4242);
  assert.deepEqual(pairOf(wrong), [4.2, 80, 'openlibrary']);
});

test('the prefetch record comes from the resolver: the same pair, the same cover, nothing of its own; unfinished answers are asked again', async () => {
  routeFetch([olSearch('/works/OL507W', 'Record Alpha', 'Hal Author', { ratings_average: 4.1, ratings_count: 300 }), olOther, google([gbItem('r1', 'Record Alpha', 'Hal Author', { averageRating: 3.9, ratingsCount: 100 })]), apple(appleHit('Record Alpha', 'Hal Author', 4.3, 500))]);
  const r = await resolveBook({ title: 'Record Alpha', author: 'Hal Author', apple: true });
  const rec = toPrefetchedRecord('Record Alpha', r);
  assert.deepEqual([rec.ratingAverage, rec.ratingCount, rec.ratingSource], [4.3, 500, 'apple']);
  assert.deepEqual([rec.coverUrl, rec.pageCount, rec.year, rec.olKey, rec.rv], ['https://a/600x900bb.jpg', 250, '2020', '/works/OL507W', PREFETCH_VERSION]);
  assert.deepEqual([rec.ratingAverage, rec.ratingCount, rec.ratingSource], [r!.book.ratingAverage, r!.book.ratingCount, r!.book.ratingSource]); // the card and the record agree
  assert.ok(isCurrentRecord(rec, 'Record Alpha'));

  // nothing found, or a site that could not be reached: not final
  assert.deepEqual(toPrefetchedRecord('Nothing', null), { title: 'Nothing' });
  routeFetch([olSearch('/works/OL508W', 'Record Beta', 'Ivy Author', { ratings_average: 4, ratings_count: 50 }), olOther, google([]), appleDown]);
  const waiting = toPrefetchedRecord('Record Beta', await resolveBook({ title: 'Record Beta', author: 'Ivy Author', apple: true }));
  assert.equal(waiting.rv, undefined);
  assert.equal(isCurrentRecord(waiting, 'Record Beta'), false);

  // a record saved by the old script (no version) is fetched again, as is one for a different title
  assert.equal(isCurrentRecord({ title: 'Old', coverUrl: 'x', ratingAverage: 4, ratingSource: 'apple' } as any, 'Old'), false);
  assert.equal(isCurrentRecord(rec, 'Another Title'), false);
});

test('migration: the old cache keys are removed at startup, the reader\'s own data is never touched', async () => {
  const { dropLegacyBookCaches, clearableCacheKeys } = await import('./cache');
  const old = ['readlife.resolved2', 'readlife.meta5', 'readlife.ratingsrc2', 'readlife.curated2'];
  old.forEach(k => store.set(k, '{}'));
  store.set('readlife.library', '[{"id":"keep"}]');
  store.set('readlife.resolved3', '{}'); // the new caches stay
  dropLegacyBookCaches();
  old.forEach(k => assert.equal(store.has(k), false, `${k} should be gone`));
  assert.equal(store.get('readlife.library'), '[{"id":"keep"}]');
  assert.equal(store.has('readlife.resolved3'), true);
  assert.ok(!clearableCacheKeys().includes('readlife.library'));
});
