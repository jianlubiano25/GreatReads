// Run with: npm test
// One primary rating on every screen: Store card data, the book info's main rating and its quick facts come from the same ladder
// (Library -> Apple -> Open Library -> Google), Google's rating reaches both, fractional stars, stale caches and API errors.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Storage shim BEFORE any cache is first read. The old caches below are really "on disk" when the app starts.
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

store.set('readlife.resolved1', JSON.stringify({ 'stale alpha|sol author': { t: Date.now(), v: { book: { id: 'ol_stale', title: 'Stale Alpha', author: 'Sol Author', ratingAverage: 2, ratingCount: 5, ratingSource: 'openlibrary' }, flags: {} } } }));
store.set('readlife.meta4', JSON.stringify({ 'stale-meta': { t: Date.now(), v: { ratingAverage: 1.5, ratingCount: 3, ratingSource: 'google', pageCount: 111 } } }));
store.set('readlife.library', '[{"id":"keep"}]');


import { mainRating, otherRatings } from './ratings';
import { fetchBookMeta, fetchRatingSources } from './details';
import { resolveBook } from './resolve';
import { dropLegacyBookCaches } from './cache';
import { RatingLine, StarRating } from '../../components/BookMeta';
import { routeFetch } from '../store/testkit';

const book = (o: any) => ({ id: o.title, title: 'T', author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2020', genre: 'Fiction', summary: 'x'.repeat(80), authorBio: '', pageCount: 300, ...o }) as any;
const olDoc = (key: string, title: string, author: string, extra: any = {}) => ({ docs: [{ key, title, author_name: [author], first_publish_year: 2020, cover_i: 4242, number_of_pages_median: 250, ...extra }] });
const gbItem = (id: string, title: string, author: string, extra: any = {}) => ({ id, volumeInfo: { title, authors: [author], publishedDate: '2020', pageCount: 200, ...extra } });
const isOl = (u: URL) => u.hostname === 'openlibrary.org';
const isGoogle = (u: URL) => u.hostname === 'www.googleapis.com';
const olSearch = (body: unknown) => (u: URL) => (isOl(u) && u.pathname === '/search.json' ? { body } : undefined);
const olNoSummary = (u: URL) => (isOl(u) ? { body: { summary: {} } } : undefined);
const noOl = (u: URL) => (isOl(u) ? { body: { docs: [], summary: {} } } : undefined);
const apple = (title: string, author: string, average?: number, count?: number) => (u: URL) =>
  u.hostname === 'itunes.apple.com' ? { body: { results: [{ trackId: 9, trackName: title, artistName: author, artworkUrl100: 'https://a/100x100bb.jpg', averageUserRating: average, userRatingCount: count }] } } : undefined;
const noApple = (u: URL) => (u.hostname === 'itunes.apple.com' ? { body: { results: [] } } : undefined);
const settle = () => new Promise(r => setTimeout(r, 520)); // persistentCache writes to storage 400 ms after a change
const pairOf = (b: any) => [b?.ratingAverage, b?.ratingCount, b?.ratingSource];
const mainPair = (r: any) => [r?.average, r?.count, r?.source]; // what mainRating returns

test('Store card data and the book info pick the same primary rating, and quick facts / main rating are one pair', async () => {
  // every site rated: Apple wins on both screens; the book info lists the other two once each, never added together
  routeFetch([
    olSearch(olDoc('/works/OL91W', 'Shared Alpha', 'Uma Author', { ratings_average: 4.1, ratings_count: 300 })), olNoSummary,
    u => (isGoogle(u) ? { body: { items: [gbItem('s1', 'Shared Alpha', 'Uma Author', { averageRating: 3.9, ratingsCount: 125 })] } } : undefined),
    apple('Shared Alpha', 'Uma Author', 4.0, 80),
  ]);
  const card = (await resolveBook({ title: 'Shared Alpha', author: 'Uma Author', apple: true }))!.book;
  assert.deepEqual(pairOf(card), [4, 80, 'apple']);
  const found = await fetchRatingSources(book({ id: 'ol_sa', title: 'Shared Alpha', author: 'Uma Author' }));
  const main = mainRating(card, found);
  assert.deepEqual(mainPair(main), pairOf(card));
  assert.deepEqual(otherRatings(found, main?.source).map(f => [f.source, f.average, f.count]), [['openlibrary', 4.1, 300], ['google', 3.9, 125]]);

  // Apple has nothing: Open Library is primary on both screens and Google moves to the breakdown
  routeFetch([
    olSearch(olDoc('/works/OL92W', 'Shared Beta', 'Val Author', { ratings_average: 4.2, ratings_count: 50 })), olNoSummary,
    u => (isGoogle(u) ? { body: { items: [gbItem('s2', 'Shared Beta', 'Val Author', { averageRating: 3.5, ratingsCount: 40 })] } } : undefined),
    noApple,
  ]);
  const card2 = (await resolveBook({ title: 'Shared Beta', author: 'Val Author', apple: true }))!.book;
  assert.deepEqual(pairOf(card2), [4.2, 50, 'openlibrary']);
  const found2 = await fetchRatingSources(book({ id: 'ol_sb', title: 'Shared Beta', author: 'Val Author' }));
  const main2 = mainRating(card2, found2);
  assert.deepEqual(mainPair(main2), [4.2, 50, 'openlibrary']);
  assert.deepEqual(otherRatings(found2, main2?.source).map(f => f.source), ['google']);
});

test('a valid Google rating reaches the Store card data AND the book info breakdown', async () => {
  // Google is the only rated site: it is the card's rating and the book info's main rating
  routeFetch([olSearch(olDoc('/works/OL93W', 'Google Alpha', 'Wes Author')), olNoSummary, u => (isGoogle(u) ? { body: { items: [gbItem('g1', 'Google Alpha', 'Wes Author', { averageRating: 4.3, ratingsCount: 61 })] } } : undefined), noApple]);
  const card = (await resolveBook({ title: 'Google Alpha', author: 'Wes Author', apple: true }))!.book;
  assert.deepEqual(pairOf(card), [4.3, 61, 'google']);
  const found = await fetchRatingSources(book({ id: 'ol_ga', title: 'Google Alpha', author: 'Wes Author' }));
  assert.deepEqual(found, [{ average: 4.3, count: 61, source: 'google' }]);
  assert.deepEqual(mainPair(mainRating(card, found)), [4.3, 61, 'google']);

  // another site is primary: Google is still on the card's data path (it is not primary) and is listed in the breakdown
  routeFetch([olSearch(olDoc('/works/OL94W', 'Google Beta', 'Xia Author', { ratings_average: 4, ratings_count: 200 })), olNoSummary, u => (isGoogle(u) ? { body: { items: [gbItem('g2', 'Google Beta', 'Xia Author', { averageRating: 3.7, ratingsCount: 33 })] } } : undefined), noApple]);
  const found2 = await fetchRatingSources(book({ id: 'ol_gb', title: 'Google Beta', author: 'Xia Author' }));
  assert.deepEqual(otherRatings(found2, 'openlibrary'), [{ average: 3.7, count: 33, source: 'google' }]);
});

test('Store data tries the next Google edition when the first one found is unrated', async () => {
  // findGoogle (6 results) only sees the unrated edition; the rating search (20 results) finds the rated second edition
  routeFetch([
    olSearch(olDoc('/works/OL95W', 'Edition Store', 'Yan Author')), olNoSummary, noApple,
    u => (isGoogle(u) ? { body: { items: u.searchParams.get('maxResults') === '20' ? [gbItem('e1', 'Edition Store', 'Yan Author'), gbItem('e2', 'Edition Store', 'Yan Author', { averageRating: 4.1, ratingsCount: 15 })] : [gbItem('e1', 'Edition Store', 'Yan Author')] } } : undefined),
  ]);
  const card = (await resolveBook({ title: 'Edition Store', author: 'Yan Author' }))!.book;
  assert.deepEqual(pairOf(card), [4.1, 15, 'google']);
});

test('invalid or missing counts are no rating, and a source\'s average is never shown with another source\'s count', async () => {
  // Open Library: average but no count; Google: a thin but valid pair -> Google's own pair, whole
  routeFetch([olSearch(olDoc('/works/OL96W', 'Invalid Alpha', 'Zed Author', { ratings_average: 4.4 })), olNoSummary, noApple, u => (isGoogle(u) ? { body: { items: [gbItem('i1', 'Invalid Alpha', 'Zed Author', { averageRating: 3.2, ratingsCount: 4 })] } } : undefined)]);
  assert.deepEqual(pairOf((await resolveBook({ title: 'Invalid Alpha', author: 'Zed Author' }))!.book), [3.2, 4, 'google']);
  // every site gives an average without a count (or an impossible one): nothing is shown
  routeFetch([olSearch(olDoc('/works/OL97W', 'Invalid Beta', 'Abe Author', { ratings_average: 4.4, ratings_count: 0 })), olNoSummary, noApple, u => (isGoogle(u) ? { body: { items: [gbItem('i2', 'Invalid Beta', 'Abe Author', { averageRating: 9, ratingsCount: 20 })] } } : undefined)]);
  const none = (await resolveBook({ title: 'Invalid Beta', author: 'Abe Author' }))!.book;
  assert.deepEqual(pairOf(none), [undefined, undefined, undefined]);
  // and the shelf card draws nothing for an outside rating without its own count
  assert.equal(renderToStaticMarkup(React.createElement(RatingLine, { book: book({ ratingAverage: 4.4, ratingSource: 'openlibrary' }) })), '');
});

test('fractional stars: 4.3 and 3.7 are drawn as 4.3 and 3.7 on the shelf card and in the book info, never rounded', () => {
  const width = (html: string) => [...html.matchAll(/width:([\d.]+)%/g)].map(m => Number(m[1]));
  assert.deepEqual(width(renderToStaticMarkup(React.createElement(StarRating, { value: 4.3 }))), [100, 100, 100, 100, 30]);
  assert.deepEqual(width(renderToStaticMarkup(React.createElement(StarRating, { value: 3.7 }))), [100, 100, 100, 70]);
  const card = renderToStaticMarkup(React.createElement(RatingLine, { book: book({ ratingAverage: 4.3, ratingCount: 1200, ratingSource: 'apple' }), compact: true }));
  assert.deepEqual(width(card), [100, 100, 100, 100, 30]);
  assert.ok(card.includes('4.3') && card.includes('1.2k'));
  assert.ok(!card.includes('★★★★☆')); // the old whole-star text is gone
  // the library's own ratings still show
  assert.ok(renderToStaticMarkup(React.createElement(RatingLine, { book: book({ id: 7, source: 'curated', ratingAverage: 4.6, ratingCount: 18400 }) })).includes('4.6'));
});

test('stale caches: resolved1 and meta4 are no longer read, are removed at startup, and nothing of the reader\'s is touched', async () => {
  routeFetch([olSearch(olDoc('/works/OL98W', 'Stale Alpha', 'Sol Author')), olNoSummary, noApple, u => (isGoogle(u) ? { body: { items: [gbItem('c1', 'Stale Alpha', 'Sol Author', { averageRating: 4.6, ratingsCount: 90 })] } } : undefined)]);
  assert.deepEqual(pairOf((await resolveBook({ title: 'Stale Alpha', author: 'Sol Author' }))!.book), [4.6, 90, 'google']); // not the saved 2.0 / 5
  routeFetch([olSearch(olDoc('/works/OL99W', 'Stale Meta', 'Sol Author', { ratings_average: 4, ratings_count: 70 })), olNoSummary, noApple, u => (isGoogle(u) ? { body: { items: [] } } : undefined)]);
  const meta = await fetchBookMeta(book({ id: 'stale-meta', title: 'Stale Meta', author: 'Sol Author' }));
  assert.deepEqual([meta?.ratingAverage, meta?.ratingCount], [4, 70]); // not the saved 1.5 / 3
  dropLegacyBookCaches();
  assert.equal(store.has('readlife.resolved1'), false);
  assert.equal(store.has('readlife.meta4'), false);
  assert.equal(store.get('readlife.library'), '[{"id":"keep"}]');
});

test('a Google API error is not remembered as "no rating": it is asked again later, not repeatedly; a successful empty answer is remembered', async () => {
  const ol = olSearch(olDoc('/works/OL100W', 'Error Alpha', 'Bo Author'));
  const calls = routeFetch([ol, olNoSummary, noApple, u => (isGoogle(u) ? { status: 503, body: {} } : undefined)]);
  const first = (await resolveBook({ title: 'Error Alpha', author: 'Bo Author' }))!.book;
  assert.equal(first.ratingAverage, undefined);
  await settle();
  assert.equal(store.get('readlife.resolved2')?.includes('error alpha|bo author') ?? false, false); // not saved for two weeks
  const used = calls.length;
  await resolveBook({ title: 'Error Alpha', author: 'Bo Author' }); // reopened right away: no new requests
  assert.equal(calls.length, used);

  mock.timers.enable({ apis: ['Date'], now: Date.now() + 3 * 60 * 1000 });
  try {
    routeFetch([ol, olNoSummary, noApple, u => (isGoogle(u) ? { body: { items: [gbItem('x1', 'Error Alpha', 'Bo Author', { averageRating: 3.8, ratingsCount: 27 })] } } : undefined)]);
    assert.deepEqual(pairOf((await resolveBook({ title: 'Error Alpha', author: 'Bo Author' }))!.book), [3.8, 27, 'google']);
  } finally { mock.timers.reset(); }

  // Google answered, and simply has no rating for any edition: that IS remembered
  const ok = routeFetch([olSearch(olDoc('/works/OL101W', 'Error Beta', 'Cy Author')), olNoSummary, noApple, u => (isGoogle(u) ? { body: { items: [gbItem('x2', 'Error Beta', 'Cy Author')] } } : undefined)]);
  await resolveBook({ title: 'Error Beta', author: 'Cy Author' });
  await settle();
  const saved = ok.length;
  await resolveBook({ title: 'Error Beta', author: 'Cy Author' });
  assert.equal(ok.length, saved);
  assert.ok(store.get('readlife.resolved2')?.includes('error beta|cy author'));
});

test('book meta without a rating (an API error) is not saved for a month; with a rating it is', async () => {
  const b = book({ id: 'meta-err', title: 'Meta Alpha', author: 'Di Author' });
  const olOnly = olSearch(olDoc('/works/OL102W', 'Meta Alpha', 'Di Author'));
  const calls = routeFetch([olOnly, olNoSummary, noApple, u => (isGoogle(u) ? { status: 503, body: {} } : undefined)]);
  const first = await fetchBookMeta(b);
  assert.equal(first?.ratingAverage, undefined);
  await settle();
  assert.equal(store.get('readlife.meta5')?.includes('meta-err') ?? false, false);
  const used = calls.length;
  await fetchBookMeta(b); // reopened right away: no new requests
  assert.equal(calls.length, used);

  mock.timers.enable({ apis: ['Date'], now: Date.now() + 11 * 60 * 1000 });
  try {
    routeFetch([olOnly, olNoSummary, noApple, u => (isGoogle(u) ? { body: { items: [gbItem('m1', 'Meta Alpha', 'Di Author', { averageRating: 4.5, ratingsCount: 18 })] } } : undefined)]);
    const later = await fetchBookMeta(b);
    assert.deepEqual([later?.ratingAverage, later?.ratingCount, later?.ratingSource], [4.5, 18, 'google']);
  } finally { mock.timers.reset(); }
  await settle();
  assert.ok(store.get('readlife.meta5')?.includes('meta-err'));
});
