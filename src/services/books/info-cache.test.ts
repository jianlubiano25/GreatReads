// Run with: npm test
// Book Info cache (infoStore.ts) and the background queue (infoQueue.ts): cache-first, partial saves, missing vs failed, shared lookups, limits.
import test from 'node:test';
import assert from 'node:assert/strict';

// A storage shim BEFORE any cache is first read
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
// Things that must survive everything below untouched
store.set('readlife.v2', '{"library":"keep"}');
store.set('readlife.storeprefs1', '{"order":["a"]}');
// What older versions of the app already saved for one book: Book Info must start from it instead of asking again
const legacy = (o: any) => ({ id: o.title, title: 'T', author: 'A B', shelf: 'mine', difficulty: 0, isOnDevice: false, year: '', genre: 'Fiction', summary: '', authorBio: '', pageCount: 0, ...o }) as any;

import { bookKey } from './identity';
const old = legacy({ id: 'old1', title: 'Legacy Alpha', author: 'Lena Writer' });
store.set('readlife.meta6', JSON.stringify({ [bookKey(old)]: { t: Date.now(), v: { year: '2011', pageCount: 321, ratingAverage: 4.1, ratingCount: 90, ratingSource: 'openlibrary' } } }));
store.set('readlife.ratingsrc3', JSON.stringify({ [bookKey(old)]: { t: Date.now(), v: [{ source: 'openlibrary', average: 4.1, count: 90 }] } }));

import { INFO_TUNING, applyInfo, ensureBookInfo, getInfo, infoKey, isLoadingInfo, missingFields, setInfoClockForTests, siteRatingsOf, subscribeInfo } from './infoStore';
import { createInfoQueue, type QueueEnv } from './infoQueue';
import { routeFetch } from '../store/testkit';

const gbItem = (id: string, title: string, author: string, extra: any = {}) => ({ id, volumeInfo: { title, authors: [author], ...extra } });
const google = (u: URL) => u.hostname === 'www.googleapis.com';
const emptyOl = (u: URL) => (u.hostname === 'openlibrary.org' ? { body: { docs: [], works: [], summary: {} } } : undefined);
const emptyApple = (u: URL) => (u.hostname === 'itunes.apple.com' ? { body: { results: [] } } : undefined);
const wiki = (extract: string) => (u: URL) => (u.hostname === 'en.wikipedia.org' ? { body: { type: 'standard', extract } } : undefined);
const count = (calls: string[]) => calls.length;

const BIO = 'Ivy Author is a novelist. She has written many books. Her work is widely read.';
const SYN = 'A long, thoughtful description of the book that is certainly more than sixty characters long, for the synopsis.';

let t0 = 1_800_000_000_000;
let now = t0;
setInfoClockForTests(() => now);

test('opening a book again shows every saved field at once and repeats no lookup', async () => {
  const b = legacy({ id: 'a1', title: 'Cache Alpha', author: 'Ivy Author' });
  routeFetch([emptyApple, wiki(BIO), u => (google(u) ? { body: { items: [gbItem('g1', 'Cache Alpha', 'Ivy Author', { publishedDate: '2019-05-01', pageCount: 280, description: SYN, averageRating: 4.2, ratingsCount: 87 })] } } : undefined), emptyOl]);
  await ensureBookInfo(b);
  const first = applyInfo(b);
  assert.equal(first.year, '2019');
  assert.equal(first.pageCount, 280);
  assert.equal(first.summary, SYN);
  assert.equal(first.authorBio, BIO);

  // the network is now gone: the saved answer is complete and instant (synchronous), and asking again makes no request at all
  const calls = routeFetch([() => ({ throws: true })]);
  const again = applyInfo(b, getInfo(b));
  assert.deepEqual([again.year, again.pageCount, again.summary, again.authorBio], ['2019', 280, SYN, BIO]);
  assert.deepEqual(siteRatingsOf(getInfo(b)), [{ source: 'google', average: 4.2, count: 87 }]);
  await ensureBookInfo(b);
  assert.equal(count(calls), 0);
  assert.ok(!isLoadingInfo(b, 'lookup') && !isLoadingInfo(b, 'text'));
});

test('a partial result is saved: pages and year are kept even when no site has a rating', async () => {
  const b = legacy({ id: 'p1', title: 'Partial Alpha', author: 'Pia Author', summary: SYN, authorBio: BIO });
  routeFetch([emptyOl, emptyApple, u => (google(u) ? { body: { items: [gbItem('g2', 'Partial Alpha', 'Pia Author', { publishedDate: '2021', pageCount: 410 })] } } : undefined)]);
  await ensureBookInfo(b);
  const e = getInfo(b);
  assert.equal(e.facts.pageCount, 410);
  assert.equal(e.facts.year, '2021');
  assert.deepEqual(siteRatingsOf(e), []);
  // each site with no rating is a confirmed "none" (not asked again for a week), not an error
  assert.equal(e.miss['rating:google']?.kind, 'missing');
  assert.ok((e.miss['rating:google']?.until ?? 0) - now >= 6 * 24 * 60 * 60 * 1000);
  const calls = routeFetch([() => ({ throws: true })]);
  await ensureBookInfo(b);
  assert.equal(count(calls), 0);
});

test('each site keeps its own rating pair: never combined, never mislabelled', async () => {
  const b = legacy({ id: 's1', title: 'Sources Alpha', author: 'Sam Author', summary: SYN, authorBio: BIO });
  routeFetch([
    u => (u.hostname === 'openlibrary.org' && u.pathname === '/search.json' ? { body: { docs: [{ key: '/works/OL9W', title: 'Sources Alpha', author_name: ['Sam Author'], first_publish_year: 2020, ratings_average: 3.9, ratings_count: 500 }] } } : undefined),
    u => (u.hostname === 'openlibrary.org' ? { body: { summary: { average: 3.9, count: 500 }, works: [], docs: [] } } : undefined),
    u => (google(u) ? { body: { items: [gbItem('g3', 'Sources Alpha', 'Sam Author', { publishedDate: '2020', pageCount: 300, averageRating: 4.5, ratingsCount: 12 })] } } : undefined),
    u => (u.hostname === 'itunes.apple.com' ? { body: { results: [{ trackId: 1, trackName: 'Sources Alpha', artistName: 'Sam Author', artworkUrl100: 'https://a/100x100bb.jpg', averageUserRating: 4.8, userRatingCount: 2000 }] } } : undefined),
  ]);
  await ensureBookInfo(b);
  assert.deepEqual(siteRatingsOf(getInfo(b)), [
    { source: 'openlibrary', average: 3.9, count: 500 },
    { source: 'google', average: 4.5, count: 12 },
    { source: 'apple', average: 4.8, count: 2000 },
  ]);
});

test('a confirmed "no data" and a temporary failure are different: the failure is retried soon, the confirmed miss is not', async () => {
  const b = legacy({ id: 'f1', title: 'Flaky Alpha', author: 'Fay Author', summary: SYN, authorBio: BIO });
  // offline: nothing is learned, and nothing is remembered as "no data"
  const down = routeFetch([() => ({ throws: true })]);
  await ensureBookInfo(b);
  assert.ok(count(down) > 0);
  let e = getInfo(b);
  for (const f of ['year', 'pageCount', 'rating:google', 'rating:apple'] as const) assert.equal(e.miss[f]?.kind, 'failed', f);
  assert.ok((e.miss.year!.until - now) <= INFO_TUNING.backoffMs[0]);

  // asked again straight away (opened again, or the queue came round): it waits out its backoff, no request
  const quiet = routeFetch([() => ({ throws: true })]);
  await ensureBookInfo(b);
  assert.equal(count(quiet), 0);
  assert.deepEqual(missingFields(b).filter(f => f === 'year' || f === 'pageCount'), []);

  // after the short backoff it asks again, and this time the sites answer
  now += INFO_TUNING.backoffMs[0] + 1000;
  const back = routeFetch([emptyOl, emptyApple, u => (google(u) ? { body: { items: [gbItem('g4', 'Flaky Alpha', 'Fay Author', { publishedDate: '2018', pageCount: 222, averageRating: 4, ratingsCount: 30 })] } } : undefined)]);
  await ensureBookInfo(b);
  assert.ok(count(back) > 0);
  e = getInfo(b);
  assert.equal(e.facts.pageCount, 222);
  assert.equal(e.ratings.google?.average, 4);
  assert.equal(e.miss.year, undefined, 'a found field leaves no miss behind');

  // repeated failures wait longer each time
  const c = legacy({ id: 'f2', title: 'Flaky Beta', author: 'Gus Author', summary: SYN, authorBio: BIO });
  routeFetch([() => ({ throws: true })]);
  await ensureBookInfo(c);
  const first = getInfo(c).miss.year!;
  now += INFO_TUNING.backoffMs[0] + 1000;
  await ensureBookInfo(c);
  const second = getInfo(c).miss.year!;
  assert.equal(second.tries, 2);
  assert.ok(second.until - second.at > first.until - first.at);
});

test('rate limits and malformed answers count as failures too, and a confirmed miss expires', async () => {
  const b = legacy({ id: 'r1', title: 'Limited Alpha', author: 'Rae Author', summary: SYN, authorBio: BIO });
  routeFetch([u => (google(u) ? { status: 429, body: {} } : undefined), u => (u.hostname === 'itunes.apple.com' ? { html: true } : undefined), emptyOl]);
  await ensureBookInfo(b);
  assert.equal(getInfo(b).miss['rating:google']?.kind, 'failed');
  assert.equal(getInfo(b).miss['rating:apple']?.kind, 'failed');

  const m = legacy({ id: 'm1', title: 'Missing Alpha', author: 'Mo Author', summary: SYN, authorBio: BIO });
  routeFetch([emptyOl, emptyApple, u => (google(u) ? { body: { items: [] } } : undefined)]);
  await ensureBookInfo(m);
  assert.equal(getInfo(m).miss['rating:google']?.kind, 'missing');
  now += INFO_TUNING.missingMs.rating + 1000; // a week later it is worth asking again
  assert.ok(missingFields(m).includes('rating:google'));
});

test('two screens asking for the same book share one lookup, and the screens are told as fields arrive', async () => {
  const routes = (title: string, author: string) => [emptyOl, emptyApple, (u: URL) => (google(u) ? { body: { items: [gbItem('g5', title, author, { publishedDate: '2015', pageCount: 100, averageRating: 3.5, ratingsCount: 20 })] } } : undefined)];
  // the cost of ONE screen asking
  const solo = legacy({ id: 'd0', title: 'Shared Solo', author: 'Dee Author', summary: SYN, authorBio: BIO });
  const soloCalls = routeFetch(routes('Shared Solo', 'Dee Author'));
  await ensureBookInfo(solo);
  assert.ok(soloCalls.length > 0);

  // TWO screens (the same book, from two lists with different record ids) asking at the same moment cost the same
  const b = legacy({ id: 'd1', title: 'Shared Alpha', author: 'Dee Author', summary: SYN, authorBio: BIO });
  const calls = routeFetch(routes('Shared Alpha', 'Dee Author'));
  let seen = 0;
  const off = subscribeInfo(b, () => { seen++; });
  const screenA = ensureBookInfo(b);
  const screenB = ensureBookInfo({ ...b, id: 'other-record-id' } as any);
  assert.ok(isLoadingInfo(b, 'lookup'), 'shown as loading while the lookup runs');
  await Promise.all([screenA, screenB]);
  off();
  assert.equal(calls.length, soloCalls.length, 'one shared lookup, not two');
  assert.ok(seen >= 2, 'the screen was told when facts and when ratings were saved');
  assert.equal(infoKey(b), infoKey({ ...b, author: 'DEE AUTHOR' }));
});

test('what older caches already hold is the starting point; nothing else in storage is touched', async () => {
  const calls = routeFetch([() => ({ throws: true })]);
  const e = getInfo(old);
  assert.equal(e.facts.year, '2011');
  assert.equal(e.facts.pageCount, 321);
  assert.deepEqual(siteRatingsOf(e), [{ source: 'openlibrary', average: 4.1, count: 90 }]);
  assert.equal(applyInfo(old).pageCount, 321);
  assert.equal(count(calls), 0);
  assert.equal(store.get('readlife.v2'), '{"library":"keep"}');
  assert.equal(store.get('readlife.storeprefs1'), '{"order":["a"]}');
  assert.ok(store.has('readlife.meta6') && store.has('readlife.ratingsrc3'), 'the older caches are kept, not deleted');
});

test('applyInfo fills only gaps: the rating a card showed, a curated genre and your own page count are never replaced', () => {
  const b = legacy({ id: 7, title: 'Gap Alpha', author: 'Gia Author', genre: 'Fiction', pageCount: 111, year: '2001', ratingAverage: 4.9, ratingCount: 3, ratingSource: 'library' });
  const out = applyInfo(b, { facts: { year: '1999', pageCount: 999, genre: 'History' }, at: {}, ratings: { google: { average: 2, count: 50, at: now } }, miss: {} });
  assert.deepEqual([out.year, out.pageCount, out.genre, out.ratingAverage, out.ratingSource], ['2001', 111, 'Fiction', 4.9, 'library']);
});

// ---- the background queue ----
const env = (o: Partial<{ online: boolean; visible: boolean }> = {}) => {
  const st = { online: true, visible: true, ...o };
  const e: QueueEnv & { st: typeof st } = { st, online: () => st.online, visible: () => st.visible, now: () => Date.now(), sleep: () => new Promise(r => setTimeout(r, 1)) };
  return e;
};
const needy = (n: number, tag: string) => Array.from({ length: n }, (_, i) => legacy({ id: `${tag}${i}`, title: `Queue ${tag} ${i}`, author: 'Quinn Author', summary: SYN, authorBio: BIO }));

test('background enrichment runs a few books at a time, in priority order, without blocking the caller', async () => {
  let running = 0;
  let peak = 0;
  const order: string[] = [];
  const q = createInfoQueue(async b => { running++; peak = Math.max(peak, running); order.push(String(b.id)); await new Promise(r => setTimeout(r, 15)); running--; }, env(), { concurrency: 2, gapMs: 1, batchSize: 3, batchPauseMs: 2 });
  const low = needy(5, 'low');
  const high = needy(3, 'hi');
  q.enqueue(low, 1);
  q.enqueue(high, 0); // synchronous: the caller is not held up
  assert.ok(q.size() + q.activeCount() >= 7);
  await q.idle();
  assert.ok(peak <= 2, `at most 2 at once, saw ${peak}`);
  assert.equal(order.length, 8);
  assert.deepEqual(order.slice(order.indexOf('hi0'), order.indexOf('hi0') + 3).sort(), ['hi0', 'hi1', 'hi2']);
  assert.ok(order.indexOf('hi2') < order.indexOf('low4'), 'books on screen / in the library go before the rest');
  // a book is never run twice, even when it is queued again
  q.enqueue(high, 0);
  await q.idle();
  assert.equal(order.length, 8);
});

test('background enrichment pauses while the app is hidden or offline and carries on when it is back', async () => {
  const e = env({ visible: false });
  const ran: string[] = [];
  const q = createInfoQueue(async b => { ran.push(String(b.id)); }, e, { concurrency: 2, gapMs: 1, batchSize: 10, batchPauseMs: 1 });
  q.enqueue(needy(3, 'pz'), 0);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(ran.length, 0, 'hidden: nothing starts');
  e.st.visible = true; e.st.online = false; q.resume();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(ran.length, 0, 'offline: nothing starts');
  e.st.online = true; q.resume();
  await q.idle();
  assert.equal(ran.length, 3);
});

test('a book that needs nothing, or is waiting out a backoff, is not queued at all', async () => {
  const full = legacy({ id: 'full1', title: 'Full Alpha', author: 'Fu Author', year: '2000', pageCount: 100, summary: SYN, authorBio: BIO });
  routeFetch([emptyOl, emptyApple, u => (google(u) ? { body: { items: [] } } : undefined)]);
  await ensureBookInfo(full); // everything left is a confirmed "none"
  const ran: string[] = [];
  const q = createInfoQueue(async b => { ran.push(String(b.id)); }, env(), { gapMs: 1 });
  q.enqueue([full], 0);
  assert.equal(q.size(), 0);
  await q.idle();
  assert.equal(ran.length, 0);
});

test('a rate limit puts the whole queue into a cool-down instead of hammering the site', async () => {
  let t = 1000;
  const e: QueueEnv = { online: () => true, visible: () => true, now: () => t, sleep: async ms => { t += ms; } };
  const starts: number[] = [];
  const books = needy(3, 'cd');
  const q = createInfoQueue(async b => {
    starts.push(t);
    if (b.id === 'cd0') { routeFetch([() => ({ status: 429, body: {} })]); await ensureBookInfo(b); } // a real rate-limited lookup
  }, e, { concurrency: 1, gapMs: 1, cooldownMs: 40000 });
  q.enqueue(books, 0);
  await q.idle();
  assert.equal(starts.length, 3);
  assert.ok(starts[1] - starts[0] >= 40000, 'nothing new started during the cool-down');
});
