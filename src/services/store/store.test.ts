import test from 'node:test';
import assert from 'node:assert/strict';
import { nytEntryToBook, combineWithNyt, bestsellerSource, shelfHeading, NYT_SHELVES, FRESH_MS } from './bestsellers';
import { gatherPool, rankPool, scoreCandidate, SIGNAL_WEIGHTS, resetPoolForTests, type Candidate, type SignalId } from './collate';
import { trendingSource } from './trending';
import { identityOf } from '../books/identity';
import { classifyNytFailure, forgetNytList, loadNytList } from '../books/sources/nyt';
import { kindOfWords } from '../books/kind';
import { forgetAppleCharts } from '../books/sources/appleCharts';
import { appleChart, nytList, olWorks, routeFetch } from './testkit';

const book = (o: any) => ({ id: o.title, title: 'T', author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2020', genre: 'Fiction', summary: 'x'.repeat(80), authorBio: '', pageCount: 300, coverId: 1, ...o }) as any;
const cand = (o: Omit<Partial<Candidate>, 'book'> & { title?: string; author?: string; book?: any }): Candidate => {
  const { title, author, book: extra, ...rest } = o;
  return { book: book({ title: title || 'T', ...(author ? { author } : {}), ...(extra || {}) }), flags: {}, wordSets: [['Fiction']], readers: {}, ...rest } as Candidate;
};
const ALL: SignalId[] = ['olDaily', 'olWeekly', 'apple', 'nyt', 'readers', 'quality', 'recency', 'metadata'];
const nytFiction = NYT_SHELVES[0];
const nytNon = NYT_SHELVES[1];

const FICTION = [['Space Tale', 'Ann One', '9780306406157'], ['Quiet House', 'Bo Two', '9780306406164'], ['Cold Case', 'Cy Three', '9780306406171']] as [string, string, string][];

/* ------------------------------ NYT shelf (unchanged guarantees) ------------------------------ */

test('NYT shelf: resolved data fills in details but never changes the NYT title, author, label or edition', () => {
  const entry = { rank: 1, rankLastWeek: 0, weeksOnList: 1, title: 'It Ends With Us', author: 'Colleen Hoover', description: 'A novel.', publisher: 'Atria', cover: 'https://img/1.jpg', isbn13: '9781501110368', isbn10: '1501110365', list: 'x', publishedDate: '' };
  const prov = nytEntryToBook(entry, 'Fiction');
  assert.equal(prov.id, 'nyt_9781501110368');
  assert.equal(prov.awardLabel, 'NYT bestseller · new this week');
  const resolved = book({ id: 'ol__works_OL1W', title: 'It ends with us (Special Ed.)', author: 'C. Hoover', pageCount: 376, ratingAverage: 4.2, ratingCount: 9000, coverId: 77, identity: { olWork: 'OL1W' } });
  const out = combineWithNyt(prov, resolved);
  assert.equal(out.title, 'It Ends With Us');
  assert.equal(out.author, 'Colleen Hoover');
  assert.equal(out.coverUrl, 'https://img/1.jpg');
  assert.equal(out.pageCount, 376);
  assert.equal(out.id, 'ol__works_OL1W');
  assert.deepEqual(identityOf(out), { olWork: 'OL1W', isbn13: '9781501110368', isbn10: '1501110365' });
  assert.equal(combineWithNyt(prov, null), prov);
});

/* ------------------------------ NYT failures are understood, not swallowed ------------------------------ */

test('NYT failure reasons are told apart', () => {
  assert.equal(classifyNytFailure({ status: 503, data: { error: 'not_configured' } }), 'not_configured');
  assert.equal(classifyNytFailure({ status: 502, data: { error: 'unauthorized' } }), 'unauthorized');
  assert.equal(classifyNytFailure({ status: 429 }), 'rate_limited');
  assert.equal(classifyNytFailure({ status: 200, failure: 'not-json' }), 'no_function'); // the site served index.html
  assert.equal(classifyNytFailure({ status: 0, failure: 'network' }), 'offline');
  assert.equal(classifyNytFailure({ status: 500, failure: 'http' }), 'upstream_error');
});

test('loadNytList: success, a failure with nothing saved, and a failure with a saved list', async () => {
  forgetNytList('t-list-1');
  routeFetch([u => (u.pathname === '/api/nyt' ? { body: nytList(FICTION) } : undefined)]);
  const ok = await loadNytList('t-list-1');
  assert.equal(ok.entries?.length, 3);
  assert.equal(ok.entries?.[0].rank, 1);
  assert.equal(ok.entries?.[0].title, 'Space Tale'); // NYT capitals are cleaned up

  forgetNytList('t-list-2');
  routeFetch([u => (u.pathname === '/api/nyt' ? { status: 503, body: { error: 'not_configured' } } : undefined)]);
  const down = await loadNytList('t-list-2');
  assert.equal(down.entries, null);
  assert.equal(down.failure, 'not_configured');

  forgetNytList('t-list-3');
  routeFetch([u => (u.pathname === '/api/nyt' ? { status: 200, html: true } : undefined)]);
  assert.equal((await loadNytList('t-list-3')).failure, 'no_function');
});

/* ------------------------------ scoring: normalisation, rebalancing, missing signals ------------------------------ */

test('a source outage is rebalanced out instead of lowering every score', () => {
  const onEverything = cand({ olDaily: { rank: 0, total: 40 }, olWeekly: { rank: 0, total: 40 }, apple: { rank: 0, total: 40 }, nyt: 1, readers: { ol: 10000 }, book: { ratingAverage: 4.6, ratingCount: 10000, year: String(new Date().getFullYear()) } });
  const withNyt = scoreCandidate(onEverything, new Set(ALL)).score;
  const noNyt = scoreCandidate(onEverything, new Set(ALL.filter(s => s !== 'nyt'))).score;
  assert.ok(noNyt > 85 && withNyt > 85, 'a book that is strong everywhere stays near the top either way');
  assert.ok(Math.abs(noNyt - withNyt) < 15);
  // a weaker book's score is still relative to what could be earned, and it stays below the strong one
  const weak = cand({ olDaily: { rank: 30, total: 40 } });
  assert.ok(scoreCandidate(weak, new Set(ALL.filter(s => s !== 'nyt'))).score < noNyt);
});

test('NYT is a signal, not the authority: strong other signals beat a weak NYT-only book', () => {
  const strong = cand({ title: 'Everywhere', olDaily: { rank: 1, total: 40 }, olWeekly: { rank: 2, total: 40 }, apple: { rank: 2, total: 40 }, readers: { ol: 8000, apple: 5000 }, book: { ratingAverage: 4.4, ratingCount: 8000 } });
  const nytOnly = cand({ title: 'Only NYT', nyt: 1, book: { ratingAverage: undefined, ratingCount: undefined, coverId: undefined, summary: '' } });
  assert.ok(scoreCandidate(strong, new Set(ALL)).score > scoreCandidate(nytOnly, new Set(ALL)).score);
});

test('each source is normalised on its own scale and a missing signal contributes nothing', () => {
  const onlyApple = cand({ readers: { apple: 9000 } });
  const onlyGoogle = cand({ readers: { google: 3000 } }); // 3000 Google ratings is a lot; 3000 on Open Library would be modest
  const none = cand({ readers: {}, book: { ratingCount: undefined, ratingAverage: undefined } });
  const s = (c: Candidate) => scoreCandidate(c, new Set<SignalId>(['readers'])).score;
  assert.ok(s(onlyGoogle) > 80, 'Google counts are read on Google\'s own scale');
  assert.ok(s(onlyApple) > 85);
  assert.equal(s(none), 0); // no reader data -> nothing, not an invented number
  assert.equal(SIGNAL_WEIGHTS.usage > 0, true);
});

test('explicit books are dropped and suggestive ones pushed down; plain romance is untouched', () => {
  const pool = { available: new Set<SignalId>(ALL), at: Date.now(), candidates: [
    cand({ title: 'Plain Romance', olDaily: { rank: 3, total: 40 }, wordSets: [['Romance', 'Fiction']] }),
    cand({ title: 'Hot Erotica Nights', olDaily: { rank: 0, total: 40 }, wordSets: [['Fiction']] }),
  ] };
  const out = rankPool(pool, { limit: 5 }).map(r => r.book.title);
  assert.deepEqual(out, ['Plain Romance']);
});

test('fiction and non-fiction are never mixed on a kind shelf; unknown kinds are left out, not guessed', () => {
  const pool = { available: new Set<SignalId>(ALL), at: Date.now(), candidates: [
    cand({ title: 'A Novel', author: 'N One', olDaily: { rank: 0, total: 20 }, wordSets: [['Fiction', 'Romance']] }),
    cand({ title: 'A Memoir', author: 'M Two', olDaily: { rank: 1, total: 20 }, wordSets: [['Biography & Autobiography']] }),
    cand({ title: 'Mystery Kind', author: 'U Three', olDaily: { rank: 2, total: 20 }, wordSets: [] }),
  ] };
  assert.deepEqual(rankPool(pool, { limit: 5, kind: 'fiction' }).map(r => r.book.title), ['A Novel']);
  assert.deepEqual(rankPool(pool, { limit: 5, kind: 'nonfiction' }).map(r => r.book.title), ['A Memoir']);
  assert.equal(kindOfWords(['Biographies & Memoirs', 'Nonfiction']), 'nonfiction');
  assert.equal(kindOfWords(['Fiction & Literature', 'Mysteries & Thrillers']), 'fiction');
  assert.equal(kindOfWords([]), 'unknown');
});

/* ------------------------------ gathering: provider failures and de-duplication ------------------------------ */

const OL_ROWS = [
  { key: '/works/OL1W', title: 'Space Tale', author: 'Ann One', subject: ['Science fiction', 'Fiction'], ratings: 900 },
  { key: '/works/OL2W', title: 'Quiet Memoir', author: 'Bo Two', subject: ['Memoirs', 'Biography'], ratings: 400 },
];
const APPLE_ROWS = [
  { id: '11', name: 'Space Tale: A Novel', artist: 'Ann One', genres: ['Science Fiction & Fantasy', 'Books'] }, // the SAME book as OL1W
  { id: '12', name: 'Brand New Thriller', artist: 'Cy Three', genres: ['Mysteries & Thrillers'] },
];

function world(opts: { nyt?: 'ok' | 'down'; ol?: 'ok' | 'down'; apple?: 'ok' | 'down' } = {}) {
  const { nyt = 'ok', ol = 'ok', apple = 'ok' } = opts;
  return routeFetch([
    u => (u.pathname === '/api/nyt' ? (nyt === 'ok' ? { body: nytList(u.searchParams.get('list')!.includes('nonfiction') ? [['Quiet Memoir', 'Bo Two', '9780306406188']] : FICTION) } : { status: 503, body: { error: 'not_configured' } }) : undefined),
    u => (u.hostname === 'openlibrary.org' && u.pathname.startsWith('/trending/') ? (ol === 'ok' ? { body: olWorks(OL_ROWS) } : { status: 500 }) : undefined),
    u => (u.pathname === '/api/apple-charts' ? (apple === 'ok' ? { body: appleChart(APPLE_ROWS) } : { status: 502 }) : undefined),
    u => (u.hostname === 'rss.applemarketingtools.com' ? { status: 502 } : undefined),
    u => (u.hostname === 'openlibrary.org' ? { body: { docs: [] } } : undefined),
    u => (u.hostname === 'www.googleapis.com' ? { body: { items: [] } } : undefined),
    u => (u.hostname === 'itunes.apple.com' ? { body: { results: [] } } : undefined),
  ]);
}
const reset = () => { resetPoolForTests(); forgetAppleCharts(); NYT_SHELVES.forEach(s => forgetNytList(s.list)); };

test('the same book from Open Library and Apple Books becomes ONE candidate with both signals', async () => {
  reset(); world();
  const pool = (await gatherPool(true))!;
  const space = pool.candidates.filter(c => /space tale/i.test(c.book.title));
  assert.equal(space.length, 1);
  assert.ok(space[0].olDaily && space[0].olWeekly && space[0].apple, 'daily + weekly + Apple chart signals are all kept, separately');
  assert.ok(String(space[0].book.id).startsWith('ol_'), 'the saved-book id format (Open Library) is preserved');
  assert.ok(pool.available.has('nyt') && pool.available.has('apple') && pool.available.has('olDaily'));
});

test('a failed provider is left out and the rest still rank (nothing is invented for it)', async () => {
  for (const down of [{ nyt: 'down' }, { ol: 'down' }, { apple: 'down' }] as const) {
    reset(); world(down);
    const pool = (await gatherPool(true))!;
    assert.ok(pool, `pool exists with ${JSON.stringify(down)}`);
    if ('nyt' in down) assert.ok(!pool.available.has('nyt'));
    if ('ol' in down) assert.ok(!pool.available.has('olDaily') && !pool.available.has('olWeekly'));
    if ('apple' in down) assert.ok(!pool.available.has('apple'));
    assert.ok(rankPool(pool, { limit: 15 }).length > 0);
  }
  reset(); world({ nyt: 'down', ol: 'down', apple: 'down' });
  assert.equal(await gatherPool(true), null);
});

test('Trending Today works without the NYT and can contain a book that is not on any NYT list', async () => {
  reset(); world({ nyt: 'down' });
  const src = { ...trendingSource, id: 'trending' };
  const books = await src.load(() => {});
  const titles = books.map(b => b.title.toLowerCase());
  assert.ok(titles.some(t => t.includes('space tale')));
  assert.ok(titles.some(t => t.includes('brand new thriller')), 'an Apple-chart book with no NYT entry ranks');
});

/* ------------------------------ Top 15: official, fallback, recovery ------------------------------ */

test('Top 15 with the NYT available: the official list, in NYT order, labelled as before', async () => {
  reset(); world();
  const src = bestsellerSource({ ...nytFiction, id: 'top-ok' });
  const books = await src.load(() => {});
  assert.deepEqual(books.map(b => b.title), ['Space Tale', 'Quiet House', 'Cold Case']);
  assert.equal(src.label?.(), 'Top 15 this week · Fiction');
  assert.ok(books.every(b => /NYT bestseller/.test(b.awardLabel || '')));
});

test('Top 15 with the NYT down: a GreatReads-labelled fallback with the right kind of books, not an error', async () => {
  reset(); world({ nyt: 'down' });
  const fic = bestsellerSource({ ...nytFiction, id: 'top-fb-fic' });
  const non = bestsellerSource({ ...nytNon, id: 'top-fb-non' });
  const f = await fic.load(() => {});
  const n = await non.load(() => {});
  assert.equal(fic.label?.(), 'GreatReads · Top 15 this week · Fiction');
  assert.equal(non.label?.(), 'GreatReads · Top 15 this week · Non-Fiction');
  assert.ok(f.length > 0 && n.length > 0);
  assert.ok(f.every(b => !/NYT bestseller/.test(b.awardLabel || '')), 'never presented as an official NYT list');
  assert.deepEqual(n.map(b => b.title), ['Quiet Memoir']);
  assert.ok(f.map(b => b.title.toLowerCase()).some(t => t.includes('space tale')));
  assert.ok(!f.some(b => /memoir/i.test(b.title)), 'no non-fiction on the fiction shelf');
  assert.equal(shelfHeading(nytFiction, 'collated'), 'GreatReads · Top 15 this week · Fiction');
});

test('Top 15 returns to the official NYT list as soon as it is available again', async () => {
  reset(); world({ nyt: 'down' });
  const shelf = { ...nytFiction, id: 'top-recover' };
  const src = bestsellerSource(shelf);
  await src.load(() => {});
  assert.match(src.label!(), /^GreatReads/);
  // The NYT comes back; the fallback is only fresh for a short while, so the next load asks the NYT again
  reset(); world();
  const realNow = Date.now;
  Date.now = () => realNow() + FRESH_MS.collated + 1000;
  try {
    const again = bestsellerSource(shelf);
    const books = await again.load(() => {});
    assert.deepEqual(books.map(b => b.title), ['Space Tale', 'Quiet House', 'Cold Case']);
    assert.equal(again.label?.(), 'Top 15 this week · Fiction');
  } finally {
    Date.now = realNow;
  }
});

test('Top 15 when EVERY source is down: the last list shown is kept instead of an error; with nothing saved it reports failure', async () => {
  reset(); world();
  const shelf = { ...nytFiction, id: 'top-allcache' };
  const first = bestsellerSource(shelf);
  const shown = await first.load(() => {});
  assert.equal(shown.length, 3);
  reset(); world({ nyt: 'down', ol: 'down', apple: 'down' });
  const realNow = Date.now;
  Date.now = () => realNow() + FRESH_MS.nyt + 1000;
  try {
    const second = bestsellerSource(shelf);
    assert.deepEqual((await second.load(() => {})).map(b => b.title), shown.map(b => b.title));
    await assert.rejects(bestsellerSource({ ...nytFiction, id: 'top-nothing' }).load(() => {}));
  } finally {
    Date.now = realNow;
  }
});
