// Run with: npm test
// Store speed + book-data flow regressions: card-sized Apple art, every site's rating surviving resolve / prefetch / book info,
// a refused Google key, and saved Top 15 lists drawn at once while they refresh.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { getCoverUrl, sizedCoverUrl } from './covers';
import { fetchRatingSources } from './details';
import { isCurrentRecord, PREFETCH_VERSION, toPrefetchedRecord } from './prefetchRecord';
import { mainRating, otherRatings } from './ratings';
import { resolveBook } from './resolve';
import { resetGoogleKeyForTests, findGoogleRating } from './sources/googleBooks';
import { bestsellerSource, SHOW_STALE_MS } from '../store/bestsellers';
import { NYT_SHELVES } from '../store/lists';
import { nytList, routeFetch } from '../store/testkit';
import { forgetNytList } from './sources/nyt';

const APPLE = 'https://is1-ssl.mzstatic.com/image/thumb/Publication126/v4/1e/f4/8b/abc/9781501139246.jpg/600x900bb.jpg';
const gbItem = (id: string, title: string, author: string, extra: any = {}) => ({ id, volumeInfo: { title, authors: [author], publishedDate: '2020', pageCount: 200, ...extra } });
const google = (u: URL) => u.hostname === 'www.googleapis.com';
const apple = (rating: { avg: number; n: number } | null, title: string, author: string) => (u: URL) =>
  u.hostname === 'itunes.apple.com' ? { body: { results: [{ trackId: 1, trackName: title, artistName: author, artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/x/y/100x100bb.jpg', ...(rating ? { averageUserRating: rating.avg, userRatingCount: rating.n } : {}) }] } } : undefined;
const noOl = (u: URL) => (u.hostname === 'openlibrary.org' ? { body: { docs: [], summary: {} } } : undefined);
const book = (o: any) => ({ id: o.title, title: 'T', author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2020', genre: 'Fiction', summary: 'x'.repeat(80), authorBio: '', pageCount: 300, ...o }) as any;

test('Apple art is requested at the size a card draws, never larger than the saved link, and other hosts are untouched', () => {
  assert.equal(sizedCoverUrl(APPLE, 'M'), APPLE.replace('600x900bb', '360x540bb'));
  assert.equal(sizedCoverUrl(APPLE, 'S'), APPLE.replace('600x900bb', '200x300bb'));
  assert.equal(sizedCoverUrl(APPLE, 'L'), APPLE); // the book info keeps the full art
  const small = APPLE.replace('600x900bb', '300x450bb');
  assert.equal(sizedCoverUrl(small, 'M'), small); // 300 is already below 360: not enlarged
  for (const other of ['https://storage.googleapis.com/books/x.jpg', 'https://covers.openlibrary.org/b/id/1-M.jpg', 'https://img/978.jpg']) assert.equal(sizedCoverUrl(other, 'M'), other);
  assert.equal(getCoverUrl(undefined, 'M', APPLE), APPLE.replace('600x900bb', '360x540bb'));
  assert.equal(getCoverUrl(123, 'M'), 'https://covers.openlibrary.org/b/id/123-M.jpg');
});

test('the resolver keeps every site\'s own rating while the book carries only the ladder\'s pick', async () => {
  const calls = routeFetch([
    noOl,
    apple({ avg: 4.4, n: 900 }, 'Flow Alpha', 'Fay Author'),
    // the first Google match (an edition) is unrated; another edition of the same book is rated
    u => (google(u) ? { body: { items: [gbItem('g1', 'Flow Alpha', 'Fay Author'), gbItem('g2', 'Flow Alpha', 'Fay Author', { averageRating: 3.9, ratingsCount: 61 })] } } : undefined),
  ]);
  void calls;
  const r = await resolveBook({ title: 'Flow Alpha', author: 'Fay Author', apple: true, allSources: true });
  assert.deepEqual([r?.book.ratingAverage, r?.book.ratingCount, r?.book.ratingSource], [4.4, 900, 'apple']);
  assert.deepEqual(r?.ratings?.map(x => [x.source, x.average, x.count]).sort(), [['apple', 4.4, 900], ['google', 3.9, 61]]);
  assert.ok(r?.checked?.includes('google') && r?.checked?.includes('apple'));
});

test('without allSources an unrated first Google match is not reported as "Google was checked"', async () => {
  routeFetch([noOl, apple({ avg: 4.4, n: 900 }, 'Flow Beta', 'Gus Author'), u => (google(u) ? { body: { items: [gbItem('g3', 'Flow Beta', 'Gus Author')] } } : undefined)]);
  const r = await resolveBook({ title: 'Flow Beta', author: 'Gus Author', apple: true });
  assert.equal(r?.checked?.includes('google'), false); // the book info still asks Google itself
  assert.equal(r?.ratings?.some(x => x.source === 'google'), false);
});

test('the book info does not ask a site again when the resolver already got its answer', async () => {
  routeFetch([noOl, apple({ avg: 4.1, n: 300 }, 'Flow Gamma', 'Hal Author'), u => (google(u) ? { body: { items: [gbItem('g4', 'Flow Gamma', 'Hal Author', { averageRating: 3.5, ratingsCount: 40 })] } } : undefined)]);
  await resolveBook({ title: 'Flow Gamma', author: 'Hal Author', apple: true, allSources: true });
  const calls = routeFetch([]); // from here on any request would be recorded
  const out = await fetchRatingSources(book({ title: 'Flow Gamma', author: 'Hal Author' }));
  assert.deepEqual(out.map(r => r.source).sort(), ['apple', 'google']);
  assert.equal(calls.filter(c => c.includes('googleapis.com') || c.includes('itunes.apple.com')).length, 0);
});

test('a site the resolver could not settle is asked by the book info (an unrated Google match is not "no Google rating")', async () => {
  routeFetch([noOl, apple({ avg: 4.1, n: 300 }, 'Flow Delta', 'Ida Author'), u => (google(u) ? { body: { items: [gbItem('g5', 'Flow Delta', 'Ida Author')] } } : undefined)]);
  await resolveBook({ title: 'Flow Delta', author: 'Ida Author', apple: true }); // Google not settled here
  const calls = routeFetch([noOl, u => (google(u) ? { body: { items: [gbItem('g6', 'Flow Delta', 'Ida Author', { averageRating: 4.6, ratingsCount: 12 })] } } : undefined)]);
  const out = await fetchRatingSources(book({ title: 'Flow Delta', author: 'Ida Author' }));
  assert.ok(out.some(r => r.source === 'google' && r.average === 4.6 && r.count === 12));
  assert.ok(out.some(r => r.source === 'apple'));
  assert.equal(calls.filter(c => c.includes('itunes.apple.com')).length, 0); // Apple was settled: not asked again
});

test('a prefetched record keeps each site\'s rating and the sites already checked; records of an older version are fetched again', () => {
  const rec = toPrefetchedRecord('Flow Alpha', {
    book: { title: 'Flow Alpha', author: 'x', coverUrl: APPLE, ratingAverage: 4.4, ratingCount: 900, ratingSource: 'apple' } as any,
    flags: {},
    ratings: [{ source: 'apple', average: 4.4, count: 900 }, { source: 'google', average: 3.9, count: 61 }],
    checked: ['apple', 'google', 'openlibrary'],
  });
  assert.deepEqual(rec.sources, { apple: [4.4, 900], google: [3.9, 61] });
  assert.deepEqual(rec.checked, ['apple', 'google', 'openlibrary']);
  assert.equal(rec.rv, PREFETCH_VERSION);
  assert.equal(isCurrentRecord(rec, 'Flow Alpha'), true);
  assert.equal(isCurrentRecord({ ...rec, rv: PREFETCH_VERSION - 1 }, 'Flow Alpha'), false);
});

test('a Google key that Google refuses is dropped for the session, the request is repeated without it, and the key never reaches the console', async () => {
  resetGoogleKeyForTests();
  (globalThis as any).process.env.VITE_GOOGLE_BOOKS_API_KEY = 'SECRET-KEY-123';
  const warn = mock.method(console, 'warn', () => {});
  try {
    const calls = routeFetch([u => (google(u) ? (u.searchParams.has('key') ? { status: 403, body: { error: 'restricted' } } : { body: { items: [gbItem('g7', 'Key Alpha', 'Jo Author', { averageRating: 4.2, ratingsCount: 80 })] } }) : undefined)]);
    const r = await findGoogleRating({ title: 'Key Alpha', author: 'Jo Author' });
    assert.deepEqual([r.hit?.book.ratingAverage, r.hit?.book.ratingCount, r.failed], [4.2, 80, false]);
    assert.equal(calls.length, 2); // refused with the key, answered without
    const next = routeFetch([u => (google(u) ? { body: { items: [] } } : undefined)]);
    await findGoogleRating({ title: 'Key Beta', author: 'Jo Author' });
    assert.ok(next.every(c => !c.includes('key=')), 'later requests go without the refused key');
    const logged = JSON.stringify(warn.mock.calls.map(c => c.arguments));
    assert.ok(logged.includes('refused') && !logged.includes('SECRET-KEY-123'));
  } finally {
    warn.mock.restore();
    delete (globalThis as any).process.env.VITE_GOOGLE_BOOKS_API_KEY;
    resetGoogleKeyForTests();
  }
});

test('a request that fails the same way without the key does not blame the key', async () => {
  resetGoogleKeyForTests();
  (globalThis as any).process.env.VITE_GOOGLE_BOOKS_API_KEY = 'SECRET-KEY-456';
  try {
    routeFetch([u => (google(u) ? { status: 400, body: {} } : undefined)]);
    const r = await findGoogleRating({ title: 'Odd Query', author: 'Jo Author' });
    assert.equal(r.failed, true);
    const calls = routeFetch([u => (google(u) ? { body: { items: [] } } : undefined)]);
    await findGoogleRating({ title: 'Next Query', author: 'Jo Author' });
    assert.ok(calls.some(c => c.includes('key=')), 'the key is still used');
  } finally {
    delete (globalThis as any).process.env.VITE_GOOGLE_BOOKS_API_KEY;
    resetGoogleKeyForTests();
  }
});

test('a Top 15 saved days ago is drawn at once (stale-while-revalidate) instead of an empty skeleton, until it is too old', async () => {
  const shelf = NYT_SHELVES[0];
  forgetNytList(shelf.list);
  routeFetch([u => (u.pathname === '/api/nyt' ? { body: nytList([['Stale One', 'Sam Author', '9780000000011'], ['Stale Two', 'Tia Author', '9780000000028']]) } : undefined), noOl, apple(null, 'x', 'y')]);
  const source = bestsellerSource(shelf);
  const books = await source.load(() => {});
  assert.equal(books[0].title, 'Stale One');
  const real = Date.now();
  const at = (ms: number) => mock.method(Date, 'now', () => real + ms);
  const day = 24 * 60 * 60 * 1000;
  let m = at(2 * day); // older than the 6-hour freshness, younger than the 10 days an NYT list stays "the latest official list"
  assert.equal(source.cached()?.[0].title, 'Stale One');
  m.mock.restore();
  m = at(SHOW_STALE_MS.nyt + day);
  assert.equal(source.cached(), null);
  m.mock.restore();
});

test('each site keeps its own average AND count in the book info; the library\'s rating stays separate and is never replaced by the ladder', async () => {
  routeFetch([
    u => (u.hostname === 'openlibrary.org' && u.pathname === '/search.json' ? { body: { docs: [{ key: '/works/OL901W', title: 'Sep Alpha', author_name: ['Kit Author'], first_publish_year: 2020, ratings_average: 3.7, ratings_count: 210 }] } } : undefined),
    apple({ avg: 4.6, n: 1500 }, 'Sep Alpha', 'Kit Author'),
    u => (google(u) ? { body: { items: [gbItem('g9', 'Sep Alpha', 'Kit Author', { averageRating: 4.0, ratingsCount: 33 })] } } : undefined),
  ]);
  await resolveBook({ title: 'Sep Alpha', author: 'Kit Author', apple: true, allSources: true });
  const out = await fetchRatingSources(book({ title: 'Sep Alpha', author: 'Kit Author' }));
  const by = Object.fromEntries(out.map(r => [r.source, [r.average, r.count]]));
  assert.deepEqual(by, { openlibrary: [3.7, 210], google: [4.0, 33], apple: [4.6, 1500] }); // three pairs, none mixed

  // a library book (its own hand-written rating): that pair is the main one, and all three sites are still listed beside it, unchanged
  const mine = book({ id: 7, title: 'Sep Alpha', author: 'Kit Author', ratingAverage: 4.9, ratingCount: 12, ratingSource: 'library' });
  const main = mainRating(mine, out);
  assert.deepEqual([main?.source, main?.average, main?.count], ['library', 4.9, 12]);
  assert.deepEqual(otherRatings(out, main?.source).map(r => [r.source, r.average, r.count]), [['openlibrary', 3.7, 210], ['google', 4.0, 33], ['apple', 4.6, 1500]]);

  // a site's pair is the main one: the other two are listed with their own numbers, and the main one is not listed twice
  const viaApple = book({ title: 'Sep Alpha', author: 'Kit Author', ratingAverage: 4.6, ratingCount: 1500, ratingSource: 'apple' });
  const m2 = mainRating(viaApple, out);
  assert.deepEqual(otherRatings(out, m2?.source).map(r => [r.source, r.average, r.count]), [['openlibrary', 3.7, 210], ['google', 4.0, 33]]);
});
