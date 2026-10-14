// Run with: npm test
// Regression tests for the content-eligibility filter that keeps explicit books out of general discovery (Trending Today and the
// GreatReads-collated Top 15). The fixture is a real book that reached Trending with its cover: Anne Hooper's Ultimate Sex Guide,
// a therapist-written sex-instruction manual whose categories are only "Sex", "Sex customs" and "Sex instruction", and whose title
// holds none of the old filter's keywords. Nothing in the app is allowed to special-case it: every test below passes through the
// general rules (books/quality.ts), the shared memory (books/eligibility.ts) and the shelves that use them.
import test from 'node:test';
import assert from 'node:assert/strict';

// A saved-lists store that survives between modules in this file, seeded BEFORE the app's caches are first read:
// 1. a Trending list saved by the version that had the bug (key readlife.shelves1), holding the fixture's card
// 2. a collated Top 15 list saved before the filter existed (no version), and one saved under the current version
// 3. an official NYT list (must be left exactly as it is)
const FIXTURE = { title: "Anne Hooper's Ultimate Sex Guide", author: 'Anne Hooper', subjects: ['Sex', 'Sex customs', 'Sex instruction'], cover: 424242 };
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
const mk = (o: any) => ({ id: o.title, title: 'T', author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2020', genre: 'Fiction', summary: 'x'.repeat(80), authorBio: '', pageCount: 300, coverId: 1, ...o }) as any;
const fixtureBook = () => mk({ id: 'ol__works_OL999W', title: FIXTURE.title, author: FIXTURE.author, coverId: FIXTURE.cover, genre: 'Health', identity: { olWork: 'OL999W' } });
const legitBook = () => mk({ id: 'ol__works_OL1W', title: 'Quiet Memoir', author: 'Bo Two', genre: 'Memoir', identity: { olWork: 'OL1W' } });
const saveEntry = (key: string, id: string, value: unknown) => store.set(key, JSON.stringify({ ...JSON.parse(store.get(key) || '{}'), [id]: { t: Date.now(), v: value } }));
saveEntry('readlife.shelves1', 'trending', [fixtureBook(), legitBook()]); // the stale list from the buggy version
saveEntry('readlife.top15', 'elig-old', { mode: 'collated', books: [fixtureBook(), legitBook()], at: Date.now() }); // no version
saveEntry('readlife.top15', 'elig-v1', { mode: 'collated', books: [fixtureBook(), legitBook()], at: Date.now(), v: 1 }); // current version
const nytOfficial = mk({ id: 'nyt_1', title: 'Dark Desires: An Erotica Collection', author: 'Some Author', awardLabel: 'NYT bestseller · new this week' });
saveEntry('readlife.top15', 'elig-nyt', { mode: 'nyt', books: [nytOfficial], at: Date.now() });

import { assessContent, explicitScore, isExplicit, EXPLICIT_FILTER_AT, EXPLICIT_PENALTY_AT } from '../books/quality';
import { CONTENT_FILTER_VERSION, filterEligible, forgetExcludedForTests, isRememberedExcluded } from '../books/eligibility';
import { dropLegacyBookCaches, LEGACY_BOOK_CACHE_KEYS } from '../books/cache';
import { bestsellerSource, NYT_SHELVES } from './bestsellers';
import { gatherPool, rankPool, resetPoolForTests, type Candidate } from './collate';
import { dynamicShelves } from './shelves';
import { trendingSource } from './trending';
import { forgetAppleCharts } from '../books/sources/appleCharts';
import { forgetNytList } from '../books/sources/nyt';
import { appleChart, routeFetch } from './testkit';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const titles = (bs: { title: string }[]) => bs.map(b => b.title);

/* ------------------------------ saved lists from before the fix are never trusted (first, before anything else reads them) ------------------------------ */

test('a Trending list saved by the buggy version (readlife.shelves1) is not drawn, and is removed at startup', () => {
  assert.equal(trendingSource.cached(), null, 'the shelf reads readlife.shelves2, so the old list with the fixture card is never drawn');
  assert.ok(LEGACY_BOOK_CACHE_KEYS.includes('readlife.shelves1'));
  dropLegacyBookCaches();
  assert.equal(store.get('readlife.shelves1'), undefined);
});

test('a collated Top 15 list saved before the filter existed is not trusted; the official NYT list is returned exactly as saved', () => {
  assert.equal(bestsellerSource({ ...NYT_SHELVES[1], id: 'elig-old' }).cached(), null);
  const nyt = bestsellerSource({ ...NYT_SHELVES[1], id: 'elig-nyt' }).cached();
  assert.deepEqual(nyt?.map(b => b.title), ['Dark Desires: An Erotica Collection'], 'the NYT decides which books; nothing downstream drops one');
});

/* ------------------------------ the general rules ------------------------------ */

const OL_FLAGS = { subjects: FIXTURE.subjects };
const NO_TITLE = 'A Couple\'s Companion'; // a neutral title: the rules must not depend on the title

test('the fixture is excluded from its real categories, and the old filter scored it 0', () => {
  const a = assessContent(FIXTURE.title, OL_FLAGS);
  assert.ok(a.score >= EXPLICIT_FILTER_AT, `scored ${a.score}`);
  assert.ok(isExplicit(FIXTURE.title, OL_FLAGS));
  assert.deepEqual(a.reasons.sort(), ['sex-instruction category', 'sex-manual title']);
});

test('the title alone is only a supporting signal: it penalises and holds back, but never excludes', () => {
  const s = explicitScore(FIXTURE.title);
  assert.ok(s >= EXPLICIT_PENALTY_AT && s < EXPLICIT_FILTER_AT, `scored ${s}`);
});

test('the same book is excluded under a neutral title, from categories and description wording alone', () => {
  const flags = { subjects: ['Sex instruction', 'Sexual techniques'], description: 'Sex positions, erotic massage and orgasm explained with explicit photographs.' };
  assert.ok(isExplicit(NO_TITLE, flags));
  // and from Google-style metadata (a single category string, a description, a publisher)
  assert.ok(isExplicit(NO_TITLE, { subjects: ['Family & Relationships / Sexuality'], description: 'Erotic massage, sex positions and foreplay in photographs.', publisher: 'Xcite Books' }));
});

test('hard signals: erotica and pornography categories, explicit vocabulary, adult-content flags, adult publishers', () => {
  assert.ok(isExplicit('Midnight', { subjects: ['Fiction / Erotica'] }));
  assert.ok(isExplicit('Midnight', { subjects: ['Erotic literature'] }));
  assert.ok(isExplicit('Midnight', { subjects: ['Pornography'] }), '"Pornography" as a category (the old filter only knew "porn" and "pornographic")');
  assert.ok(isExplicit('Midnight', { description: 'An erotic novel of sexually explicit encounters.', googleMaturity: 'MATURE' }));
  assert.ok(isExplicit('Midnight', { description: 'A steamy dark romance with sex scenes and kinky games.', googleMaturity: 'MATURE' }));
  assert.ok(isExplicit('Midnight', { description: 'Explicit sexual content throughout.', appleAdvisory: 'Explicit' }));
  assert.ok(isExplicit('Midnight', { publisher: 'Black Lace', googleMaturity: 'MATURE' }));
  // one flag on its own is a penalty at most, never an exclusion
  assert.ok(!isExplicit('Midnight', { googleMaturity: 'MATURE' }));
  assert.ok(!isExplicit('Midnight', { publisher: 'Black Lace' }));
});

test('Apple\'s own "this book is fine" wording is not an advisory (it contains the word "explicit")', () => {
  assert.equal(explicitScore('A Plain Novel', { appleAdvisory: 'notExplicit' }), 0);
  assert.equal(explicitScore('A Plain Novel', { appleAdvisory: 'Clean' }), 0);
});

/* ------------------------------ legitimate books stay eligible (negative tests) ------------------------------ */

const LEGIT: [string, string, any][] = [
  ['romance', 'Beach Read', { subjects: ['Romance fiction', 'Love stories'], description: 'A witty love story about two rival writers who swap genres for a summer.' }],
  ['LGBTQ+ romance', 'Red, White & Royal Blue', { subjects: ['Gay men -- Fiction', 'Romance', 'LGBTQ+ fiction'], description: 'The First Son falls for a prince; an enemies-to-lovers love story.' }],
  ['LGBTQ+ literature', 'Giovanni\'s Room', { subjects: ['Gay men -- Fiction', 'Queer literature', 'Transgender and nonbinary people'], description: 'A young American in Paris and the desire he cannot name.' }],
  ['literary fiction with mature themes', 'The Handmaid\'s Tale', { subjects: ['Dystopian fiction', 'Women -- Fiction'], description: 'In a theocratic state, women are stripped of rights and forced into sexual servitude; a novel of violence and survival.', googleMaturity: 'MATURE' }],
  ['sexual-health science (category alone)', 'Come As You Are', { subjects: ['Sex instruction for women', 'Women -- Sexual behavior'], description: 'The research-based science of women\'s sexual well-being.' }],
  ['sexual-health education', 'Sex Education for Teens: A Medical Guide to Puberty, Consent and Sexually Transmitted Infections', { subjects: ['Sex instruction for teenagers', 'Sexual health'], description: 'Doctors explain anatomy, contraception, consent and STI prevention for adolescents.' }],
  ['sexuality scholarship', 'Sex at Dawn', { subjects: ['Sex -- Social aspects', 'Sexual behavior -- Evolution'], description: 'A challenge to long-held beliefs about human sexuality, drawing on anthropology.' }],
  ['pornography scholarship', 'The Politics of Looking', { subjects: ['Pornography -- Social aspects', 'Pornography -- Law and legislation'], description: 'A study of censorship and the courts.' }],
];
for (const [kind, title, flags] of LEGIT) {
  test(`stays eligible: ${kind} (${title.slice(0, 40)})`, () => {
    const a = assessContent(title, flags);
    assert.ok(a.score < EXPLICIT_FILTER_AT, `scored ${a.score}: ${a.reasons.join(', ')}`);
  });
}

test('identity words never count for or against a book', () => {
  const base = explicitScore('A Novel', { subjects: ['Fiction'] });
  for (const w of ['LGBTQ+', 'Gay', 'Lesbian', 'Bisexual', 'Transgender', 'Queer', 'Nonbinary', 'Gender identity']) {
    assert.equal(explicitScore('A Novel', { subjects: ['Fiction', w] }), base, w);
  }
});

/* ------------------------------ ranking: held back until looked at, never silently dropped for good ------------------------------ */

const cand = (title: string, o: Partial<Candidate> = {}): Candidate => ({ book: mk({ id: title, title, author: 'Some Author' }), flags: {}, wordSets: [['Fiction']], readers: {}, olDaily: { rank: 0, total: 5 }, ...o }) as Candidate;
const poolOf = (...candidates: Candidate[]) => ({ candidates, available: new Set(['olDaily', 'readers', 'quality', 'recency', 'metadata'] as const), at: Date.now() });

test('rankPool: a title that only LOOKS suspicious is held back until a closer look has answered, then may appear', () => {
  const unvetted = cand('The Great Sex Guide for New Parents', { flags: {} });
  const vetted = { ...unvetted, vetted: true };
  const normal = cand('Space Tale');
  assert.deepEqual(titles(rankPool(poolOf(unvetted, normal), { limit: 5 }).map(r => r.book)), ['Space Tale']);
  assert.ok(titles(rankPool(poolOf(vetted, normal), { limit: 5 }).map(r => r.book)).includes('The Great Sex Guide for New Parents'), 'vetted, with nothing explicit found, it is allowed');
});

test('rankPool: an excluded book is left out, remembered, and a saved list holding it is then cleaned', () => {
  forgetExcludedForTests([fixtureBook()]);
  const bad = cand(FIXTURE.title, { flags: OL_FLAGS, book: fixtureBook() });
  assert.deepEqual(titles(rankPool(poolOf(bad, cand('Space Tale')), { limit: 5 }).map(r => r.book)), ['Space Tale']);
  assert.ok(isRememberedExcluded(fixtureBook()));
  assert.ok(isRememberedExcluded({ id: 'gb_other', title: "Anne Hooper's Ultimate Sex Guide: A Therapist's Guide", author: 'Anne J. Hooper' } as any), 'recognised under another spelling of the title / author, without its Open Library id');
  assert.deepEqual(titles(filterEligible([fixtureBook(), legitBook()])), ['Quiet Memoir']);
  const same = [legitBook()];
  assert.equal(filterEligible(same), same, 'nothing removed: the same array comes back');
});

/* ------------------------------ the whole pipeline: live, cached, fallback, refresh ------------------------------ */

const GOOD = [
  { key: '/works/OL1W', title: 'Quiet Memoir', author: 'Bo Two', subject: ['Memoirs', 'Biography'] },
  { key: '/works/OL2W', title: 'Beach Read', author: 'Emily Henry', subject: ['Romance fiction', 'Love stories'] },
  { key: '/works/OL3W', title: 'Red, White & Royal Blue', author: 'Casey McQuiston', subject: ['Gay men -- Fiction', 'Romance'] },
  { key: '/works/OL4W', title: 'Come As You Are', author: 'Emily Nagoski', subject: ['Sex instruction for women', 'Women -- Sexual behavior'] },
  { key: '/works/OL5W', title: "The Handmaid's Tale", author: 'Margaret Atwood', subject: ['Dystopian fiction'] },
];
const BAD = { key: '/works/OL999W', title: FIXTURE.title, author: FIXTURE.author, subject: FIXTURE.subjects };

interface GoogleBook { title: string; author: string; description?: string; categories?: string[]; maturity?: string; publisher?: string }
function world(o: { ol?: { key: string; title: string; author: string; subject?: string[] }[]; apple?: { id: string; name: string; artist: string; genres: string[] }[]; google?: GoogleBook[]; down?: boolean } = {}) {
  const ol = o.ol ?? [...GOOD, BAD];
  return routeFetch([
    u => (u.pathname === '/api/nyt' ? { status: 503, body: { error: 'not_configured' } } : undefined),
    u => (u.hostname === 'openlibrary.org' && u.pathname.startsWith('/trending/') ? (o.down ? { status: 500 } : { body: { works: ol.map(r => ({ key: r.key, title: r.title, author_name: [r.author], subject: r.subject, cover_i: r.title === FIXTURE.title ? FIXTURE.cover : 100 + r.key.length, first_publish_year: 2025, ratings_count: 300, ratings_average: 4.1 })) } }) : undefined),
    u => (u.pathname === '/api/apple-charts' ? (o.down || !o.apple ? { status: 502 } : { body: appleChart(o.apple) }) : undefined),
    u => (u.hostname === 'rss.applemarketingtools.com' ? { status: 502 } : undefined),
    u => (u.hostname === 'openlibrary.org' ? { body: { docs: [] } } : undefined),
    u => {
      if (u.hostname !== 'www.googleapis.com') return undefined;
      const q = decodeURIComponent(u.searchParams.get('q') || '').toLowerCase();
      const hit = (o.google || []).find(g => q.includes(g.title.toLowerCase()));
      return { body: { items: hit ? [{ id: `v_${hit.title.length}`, volumeInfo: { title: hit.title, authors: [hit.author], description: hit.description, categories: hit.categories, maturityRating: hit.maturity, publisher: hit.publisher, publishedDate: '2024', pageCount: 300, imageLinks: { thumbnail: 'https://books.example/cover.jpg' } } }] : [] } };
    },
    u => (u.hostname === 'itunes.apple.com' ? { body: { results: [] } } : undefined),
  ]);
}
const resetSources = () => { resetPoolForTests(); forgetAppleCharts(); NYT_SHELVES.forEach(s => forgetNytList(s.list)); };
const reset = () => { resetSources(); dynamicShelves.delete('trending'); };

/** Load Trending and collect EVERY list the shelf ever hands to the screen (the first one, the improved one, and what a later read gives). */
async function loadTrending() {
  const seen: any[][] = [];
  let done: () => void = () => {};
  const refined = new Promise<void>(r => (done = r));
  const first = await trendingSource.load(b => { seen.push(b); done(); });
  seen.unshift(first);
  await Promise.race([refined, sleep(1500)]);
  await sleep(40);
  seen.push(trendingSource.cached() ?? []);
  return seen;
}
const everyBook = (seen: any[][]) => seen.flat() as { title: string; coverId?: number; coverUrl?: string }[];

test('live: the fixture never reaches the screen, no list ever holds its card or cover, and legitimate books are all there', async () => {
  reset(); forgetExcludedForTests([fixtureBook()]);
  const calls = world();
  const seen = await loadTrending();
  const all = everyBook(seen);
  assert.ok(!all.some(b => /ultimate sex guide/i.test(b.title)), 'no list holds the book');
  assert.ok(!all.some(b => b.coverId === FIXTURE.cover), 'and none holds its cover');
  const last = titles(seen[seen.length - 1]);
  for (const g of GOOD) assert.ok(last.includes(g.title), `${g.title} stays eligible`);
  assert.ok(!calls.some(c => decodeURIComponent(c).toLowerCase().includes('ultimate sex guide')), 'no lookup is spent on a book that is already excluded');
  assert.ok(isRememberedExcluded(fixtureBook()));
});

test('live, chart-only metadata: a book that arrives with just a title and a genre is held back, looked up once, and excluded on what the lookup finds', async () => {
  reset(); forgetExcludedForTests([fixtureBook()]);
  world({
    ol: GOOD,
    apple: [...GOOD.map((g, i) => ({ id: `a${i}`, name: g.title, artist: g.author, genres: ['Fiction'] })), { id: 'a99', name: FIXTURE.title, artist: FIXTURE.author, genres: ['Self-Improvement'] }],
    google: [{ title: FIXTURE.title, author: FIXTURE.author, categories: ['Family & Relationships'], description: 'Sex positions, erotic massage and foreplay, with explicit photographs of every technique.' }],
  });
  const seen = await loadTrending();
  assert.ok(!everyBook(seen).some(b => /ultimate sex guide/i.test(b.title)), 'not shown on its title alone, and not shown after the lookup either');
  assert.ok(isRememberedExcluded({ id: 'x', title: FIXTURE.title, author: FIXTURE.author } as any));
});

test('the closer look can exclude a book the first impression showed, even when that leaves a short list (the saved list must not keep it)', async () => {
  reset();
  const X = { key: '/works/OL77W', title: 'Ruthless Vows', author: 'Ivy Black', subject: ['Romance'] };
  world({
    ol: [X, GOOD[0], GOOD[1]],
    google: [{ title: 'Ruthless Vows', author: 'Ivy Black', categories: ['Fiction / Romance'], maturity: 'MATURE', description: 'A steamy dark romance with sex scenes and kinky games, for readers who want mature content.' }],
  });
  const seen = await loadTrending();
  assert.ok(titles(seen[0]).includes('Ruthless Vows'), 'nothing was known against it at first');
  assert.ok(!titles(seen[seen.length - 1]).includes('Ruthless Vows'), 'the improved list drops it');
  const saved = dynamicShelves.peek('trending')?.value ?? [];
  assert.ok(!titles(saved).includes('Ruthless Vows'), 'and so does the saved list (before, a list shorter than 8 kept the first impression, excluded book included)');
});

test('cached: a saved list that holds an excluded book is cleaned on every read, fresh or stale', async () => {
  reset(); world({ down: true });
  rankPool(poolOf(cand(FIXTURE.title, { flags: OL_FLAGS, book: fixtureBook() })), { limit: 5 }); // the book has been judged
  dynamicShelves.set('trending', [fixtureBook(), legitBook()]);
  assert.deepEqual(titles(trendingSource.cached() ?? []), ['Quiet Memoir'], 'the instant read');
  assert.deepEqual(titles(await trendingSource.load(() => {})), ['Quiet Memoir'], 'a fresh saved list');
  const realNow = Date.now;
  Date.now = () => realNow() + 8 * 60 * 60 * 1000; // older than 6 hours: only the stale copy remains, every source is down
  try {
    resetSources(); world({ down: true }); // the saved list is kept: it is all there is
    assert.deepEqual(titles(await trendingSource.load(() => {})), ['Quiet Memoir'], 'the last-resort stale list');
  } finally { Date.now = realNow; }
});

test('refresh: a manual refresh replaces a saved list that held the book, and refreshing again cannot bring it back', async () => {
  reset(); forgetExcludedForTests([fixtureBook()]);
  dynamicShelves.set('trending', [fixtureBook(), legitBook()]); // an old list, built before the book was judged
  world();
  assert.equal(await trendingSource.refresh?.(), 'updated');
  await sleep(100);
  assert.ok(!titles(dynamicShelves.peek('trending')?.value ?? []).some(t => /ultimate sex guide/i.test(t)));
  assert.ok(!titles(trendingSource.cached() ?? []).some(t => /ultimate sex guide/i.test(t)));
  reset(); world(); // again, from a cold pool: the book is judged the same way each time
  assert.equal(await trendingSource.refresh?.(), 'updated');
  await sleep(100);
  assert.ok(!titles(trendingSource.cached() ?? []).some(t => /ultimate sex guide/i.test(t)));
});

test('fallback: the collated Top 15 (NYT down) never holds the fixture, and its saved lists are cleaned on read', async () => {
  reset(); forgetExcludedForTests([fixtureBook()]);
  world();
  const shelf = { ...NYT_SHELVES[1], id: 'elig-top-live' }; // Non-Fiction
  const src = bestsellerSource(shelf);
  const seen: any[][] = [];
  const first = await src.load(b => seen.push(b));
  await sleep(150);
  assert.ok(![first, ...seen, src.cached() ?? []].flat().some(b => /ultimate sex guide/i.test(b.title)));
  assert.match(src.label?.() ?? '', /^GreatReads/, 'it is the fallback, labelled as GreatReads\' own');

  // a list saved under the current version that holds a book judged since: cleaned on read
  assert.deepEqual(titles(bestsellerSource({ ...NYT_SHELVES[1], id: 'elig-v1' }).cached() ?? []), ['Quiet Memoir']);
  assert.equal(CONTENT_FILTER_VERSION, 1);
});

test('startup stays light: judging candidates asks for nothing extra, and a candidate is looked up at most once', async () => {
  reset(); forgetExcludedForTests([fixtureBook()]);
  const calls = world();
  await gatherPool(true);
  const pool = (await gatherPool())!;
  const before = calls.length;
  for (let i = 0; i < 5; i++) rankPool(pool, { limit: 15 });
  assert.equal(calls.length, before, 'ranking (and the content check inside it) makes no request');
});
