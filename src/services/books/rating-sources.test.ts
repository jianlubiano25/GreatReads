// Run with: npm test
// Rating priority (Library -> Apple -> Open Library -> Google), valid pairs only, and the Google rating's way to the Book Info data.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// A storage shim BEFORE any cache is first read, so the old "readlife.ratingsrc1" entry below is really on disk when the app starts.
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { bookKey } from './identity';
import { chooseRating, externalRating, mainRating, otherRatings } from './ratings';
import { fetchRatingSources } from './details';
import { resolveBook } from './resolve';
import { findGoogleRating } from './sources/googleBooks';
import { dropLegacyBookCaches } from './cache';
import { routeFetch } from '../store/testkit';

const book = (o: any) => ({ id: o.title, title: 'T', author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2020', genre: 'Fiction', summary: 'x'.repeat(80), authorBio: '', pageCount: 300, ...o }) as any;
const gbItem = (id: string, title: string, author: string, extra: any = {}) => ({ id, volumeInfo: { title, authors: [author], publishedDate: '2020', pageCount: 200, ...extra } });
const google = (u: URL) => u.hostname === 'www.googleapis.com';
const googleCalls = (calls: string[]) => calls.filter(c => c.includes('googleapis.com')).length;
// What version 1 of the source-rating cache saved for one book: Open Library only, no Google. Seeded before anything reads a cache.
const oldBook = book({ id: 'old1', title: 'Old Alpha', author: 'Tess Author' });
store.set('readlife.ratingsrc1', JSON.stringify({ [bookKey(oldBook)]: { t: Date.now(), v: [{ source: 'openlibrary', average: 4, count: 50 }] } }));
store.set('readlife.library', '[{"id":"keep"}]');
const noOl = (u: URL) => (u.hostname === 'openlibrary.org' ? { body: { docs: [], summary: {} } } : undefined);
const noApple = (u: URL) => (u.hostname === 'itunes.apple.com' ? { body: { results: [] } } : undefined);

test('an outside rating is valid only as an average from 1 to 5 with its own count above zero', () => {
  assert.deepEqual(externalRating({ ratingAverage: 4.2, ratingCount: 87 }), { average: 4.2, count: 87 });
  for (const bad of [{ ratingAverage: 4.2 }, { ratingAverage: 4.2, ratingCount: 0 }, { ratingAverage: 0.5, ratingCount: 10 }, { ratingAverage: 5.5, ratingCount: 10 }, { ratingAverage: NaN, ratingCount: 10 }, { ratingCount: 10 }])
    assert.equal(externalRating(bad as any), undefined);
  // the ladder skips invalid pairs instead of showing them
  assert.deepEqual(chooseRating({ apple: { average: 4.9 }, ol: { average: 4, count: 0 }, google: { average: 3.6, count: 25 } }), { average: 3.6, count: 25 });
  assert.equal(chooseRating({ apple: { average: 4.9 }, ol: { average: 6, count: 10 }, google: { average: 0.9, count: 10 } }), undefined);
});

test('no cross-source mixing: one site\'s average is never shown with another site\'s count', async () => {
  // Open Library has an average but no count; Google has a full pair: the stars are Google's pair, whole
  routeFetch([
    u => (u.hostname === 'openlibrary.org' && u.pathname === '/search.json' ? { body: { docs: [{ key: '/works/OL701W', title: 'Mix Alpha', author_name: ['Mia Author'], first_publish_year: 2020, ratings_average: 4.8 }] } } : undefined),
    u => (u.hostname === 'openlibrary.org' ? { body: { summary: { average: 4.8, count: 0 } } } : undefined),
    u => (google(u) ? { body: { items: [gbItem('g1', 'Mix Alpha', 'Mia Author', { averageRating: 3.5, ratingsCount: 40 })] } } : undefined),
  ]);
  const r = await resolveBook({ title: 'Mix Alpha', author: 'Mia Author' });
  assert.deepEqual([r?.book.ratingAverage, r?.book.ratingCount, r?.book.ratingSource], [3.5, 40, 'google']);

  // an average without a count is no rating at all
  routeFetch([noOl, u => (google(u) ? { body: { items: [gbItem('g2', 'Mix Beta', 'Ned Author', { averageRating: 4.5 })] } } : undefined)]);
  const none = await resolveBook({ title: 'Mix Beta', author: 'Ned Author' });
  assert.equal(none?.book.ratingAverage, undefined);
  assert.equal(none?.book.ratingCount, undefined);
});

test('a valid Google pair reaches the Book Info data: fetchRatingSources, then the main rating and the other sites', async () => {
  routeFetch([noOl, noApple, u => (google(u) ? { body: { items: [gbItem('g3', 'Info Alpha', 'Ivy Author', { averageRating: 4.2, ratingsCount: 87 })] } } : undefined)]);
  const b = book({ id: 'info1', title: 'Info Alpha', author: 'Ivy Author' });
  const found = await fetchRatingSources(b);
  assert.deepEqual(found, [{ average: 4.2, count: 87, source: 'google' }]);
  // nothing else rated it: Google is the main rating, with its own count, and is not repeated in the breakdown
  assert.deepEqual(mainRating(b, found), { average: 4.2, count: 87, source: 'google' });
  assert.deepEqual(otherRatings(found, mainRating(b, found)?.source), []);

  // with every site rated, the main rating follows Apple -> Open Library -> Google and the rest are listed once each
  const all = [{ source: 'google' as const, average: 3.9, count: 125 }, { source: 'openlibrary' as const, average: 4.2, count: 300 }, { source: 'apple' as const, average: 4, count: 80 }];
  const main = mainRating(book({ id: 'x', title: 'X' }), all);
  assert.deepEqual(main, { average: 4, count: 80, source: 'apple' });
  assert.deepEqual(otherRatings(all, main?.source).map(f => f.source), ['openlibrary', 'google']);
  // a library pair still wins, and a card's own invalid pair is not shown as a site rating
  assert.equal(mainRating(book({ id: 7, source: 'curated', ratingAverage: 4.6, ratingCount: 18400 }), all)?.source, 'library');
  assert.equal(mainRating(book({ id: 'y', ratingAverage: 4.5, ratingSource: 'openlibrary' }), []), undefined);
});

test('an unrated matching edition is not the end: other editions and author variants are tried', async () => {
  // the first edition Google lists has no ratings; the second edition of the same book does
  routeFetch([u => (google(u) ? { body: { items: [gbItem('e1', 'Edition Alpha', 'Oli Author'), gbItem('e2', 'Edition Alpha', 'Oli Author', { averageRating: 4.1, ratingsCount: 15 })] } } : undefined)]);
  const second = await findGoogleRating({ title: 'Edition Alpha', author: 'Oli Author' });
  assert.deepEqual([second.hit?.book.ratingAverage, second.hit?.book.ratingCount, second.failed], [4.1, 15, false]);

  // the ISBN edition is unrated: the title / author search finds a rated edition
  routeFetch([u => (google(u) ? (u.searchParams.get('q')!.startsWith('isbn:') ? { body: { items: [gbItem('i1', 'Edition Beta', 'Pia Author')] } } : { body: { items: [gbItem('i2', 'Edition Beta', 'Pia Author', { averageRating: 3.8, ratingsCount: 61 })] } }) : undefined)]);
  const viaTitle = await findGoogleRating({ title: 'Edition Beta', author: 'Pia Author', isbn: '9780306406157' });
  assert.deepEqual([viaTitle.hit?.book.ratingAverage, viaTitle.hit?.book.ratingCount], [3.8, 61]);

  // only the author written without the middle name finds the rated edition
  const calls = routeFetch([u => (google(u) ? (u.searchParams.get('q')!.includes('inauthor:"Quin Author"') ? { body: { items: [gbItem('m1', 'Edition Gamma', 'Quin Author', { averageRating: 4.6, ratingsCount: 9 })] } } : { body: { totalItems: 0 } }) : undefined)]);
  const variant = await findGoogleRating({ title: 'Edition Gamma', author: 'Quin Middle Author' });
  assert.equal(variant.hit?.book.ratingCount, 9);
  assert.ok(googleCalls(calls) <= 4);

  // nothing is rated anywhere: a successful "no rating", with a limited number of requests
  const many = routeFetch([u => (google(u) ? { body: { items: [gbItem('n1', 'Edition Delta', 'Rae Middle Author')] } } : undefined)]);
  const none = await findGoogleRating({ title: 'Edition Delta: A Long Subtitle', author: 'Rae Middle Author' });
  assert.deepEqual([none.hit, none.failed], [null, false]);
  assert.ok(googleCalls(many) <= 4);
});

test('an API error is told apart from "no rating": it is not remembered, and is asked again later, not repeatedly', async () => {
  const olPair = (u: URL) => (u.hostname === 'openlibrary.org' ? { body: { docs: [{ key: '/works/OL702W', title: 'Err Alpha', author_name: ['Sol Author'], first_publish_year: 2020, ratings_average: 4, ratings_count: 50 }] } } : undefined);
  const b = book({ id: 'err1', title: 'Err Alpha', author: 'Sol Author' });

  const calls = routeFetch([olPair, noApple, u => (google(u) ? { status: 403, body: { error: { message: 'denied' } } } : undefined)]);
  const first = await fetchRatingSources(b);
  assert.deepEqual(first.map(f => f.source), ['openlibrary']); // Google could not be reached: left out
  const used = calls.length;
  await fetchRatingSources(b); // reopened right away: no new requests
  assert.equal(calls.length, used);
  assert.equal(store.get('readlife.ratingsrc3')?.includes(bookKey(b)) ?? false, false); // the partial answer was not saved for a week

  // a successful answer with no rated edition IS saved: asking again makes no requests
  const b2 = book({ id: 'err2', title: 'Err Beta', author: 'Sol Author' });
  const ok = routeFetch([u => (u.hostname === 'openlibrary.org' ? { body: { docs: [{ key: '/works/OL703W', title: 'Err Beta', author_name: ['Sol Author'], first_publish_year: 2020, ratings_average: 4, ratings_count: 50 }] } } : undefined), noApple, u => (google(u) ? { body: { items: [gbItem('z1', 'Err Beta', 'Sol Author')] } } : undefined)]);
  assert.deepEqual((await fetchRatingSources(b2)).map(f => f.source), ['openlibrary']);
  const saved = ok.length;
  await fetchRatingSources(b2);
  assert.equal(ok.length, saved);

  // after the wait, Google is asked again and its rating appears
  mock.timers.enable({ apis: ['Date'], now: Date.now() + 3 * 60 * 1000 });
  try {
    routeFetch([olPair, noApple, u => (google(u) ? { body: { items: [gbItem('z2', 'Err Alpha', 'Sol Author', { averageRating: 3.7, ratingsCount: 22 })] } } : undefined)]);
    const later = await fetchRatingSources(b);
    assert.deepEqual(later.map(f => f.source), ['openlibrary', 'google']);
  } finally { mock.timers.reset(); }
});

test('the old source-rating cache (ratingsrc1) cannot hide Google any more, and only that key is dropped', async () => {
  routeFetch([u => (u.hostname === 'openlibrary.org' ? { body: { docs: [{ key: '/works/OL704W', title: 'Old Alpha', author_name: ['Tess Author'], first_publish_year: 2020, ratings_average: 4, ratings_count: 50 }] } } : undefined), noApple,
    u => (google(u) ? { body: { items: [gbItem('o1', 'Old Alpha', 'Tess Author', { averageRating: 3.4, ratingsCount: 18 })] } } : undefined)]);
  assert.deepEqual((await fetchRatingSources(oldBook)).map(f => f.source), ['openlibrary', 'google']);
  dropLegacyBookCaches();
  assert.equal(store.has('readlife.ratingsrc1'), false);
  assert.equal(store.get('readlife.library'), '[{"id":"keep"}]');
});
