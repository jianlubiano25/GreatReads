// Run with: npm test
// Ratings are never lost to a failed or empty request: the offline prefetch merges into saved records, the resolver keeps a site's earlier valid pair,
// and an installed app whose saved Book Info says "no Google rating" picks up the Google rating shipped with the app.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
store.set('readlife.v2', '{"library":"keep"}'); // the library must survive everything below untouched


// Saved state this device already holds, seeded before any cache is first read (caches load on first use)
const DAY_MS = 24 * 60 * 60 * 1000;
const savedResult = (title: string, average: number, count: number) => ({ book: { id: 'ol_/works/OL77W', title, author: 'Kay Writer', ratingAverage: average, ratingCount: count, ratingSource: 'google' }, flags: {}, ratings: [{ source: 'google', average, count }], checked: ['openlibrary', 'google', 'apple'] });

import { PREFETCH_VERSION, isCurrentRecord, mergePrefetchedRecord, type PrefetchedRecord } from './prefetchRecord';
import { settleSiteRating } from './ratings';
import { resolveBook, resolveKey } from './resolve';
import { INFO_TUNING, applyInfo, ensureBookInfo, getInfo, infoKey, missingFields, siteRatingsOf } from './infoStore';
import { routeFetch } from '../store/testkit';
import { prefetchedSourceRatings } from './prefetchIndex';
import { CURATED_SHELVES } from '../../data/storeCatalog';

// results saved 20 days ago: past their two weeks (so the book is looked up again), still within the 90 days they are kept for this
store.set('readlife.resolved3', JSON.stringify({
  [resolveKey({ title: 'Keep Alpha', author: 'Kay Writer', apple: true })]: { t: Date.now() - 20 * DAY_MS, v: savedResult('Keep Alpha', 4.3, 60) },
  [resolveKey({ title: 'Keep Beta', author: 'Kay Writer', apple: true })]: { t: Date.now() - 20 * DAY_MS, v: savedResult('Keep Beta', 4.3, 60) },
}));
// Books taken from whatever ratings the app ships (no title is hardcoded, so a new prefetch never breaks these tests): the first three books
// that ship a valid Open Library, Google and Apple pair.
const nowMs = Date.now();
const bundledBooks = CURATED_SHELVES.flatMap(sh => sh.seeds.map(([title, author]) => ({ id: 'ol_/works/OL1W', title, author, shelf: 'mine', difficulty: 0, isOnDevice: false, year: '', genre: 'Fiction', summary: '', authorBio: '', pageCount: 0 } as any)))
  .filter(b => (prefetchedSourceRatings(b)?.ratings.length ?? 0) === 3)
  .filter((b, i, all) => all.findIndex(x => infoKey(x) === infoKey(b)) === i)
  .slice(0, 3);
const [jane, emma, odd] = bundledBooks;
const shipped = (b: any, site: string) => prefetchedSourceRatings(b)!.ratings.find(r => r.source === site)!;
// Book Info saved on the phone before Google ratings shipped: Google is a confirmed "none" with a week to wait
store.set('readlife.bookinfo1', JSON.stringify({
  [infoKey(jane)]: { t: nowMs, v: { facts: { year: '1847' }, at: { year: nowMs }, ratings: { openlibrary: { average: shipped(jane, 'openlibrary').average, count: shipped(jane, 'openlibrary').count, at: nowMs } }, miss: { 'rating:google': { kind: 'missing', at: nowMs, until: nowMs + INFO_TUNING.missingMs.rating, tries: 0 } } } },
  [infoKey(emma)]: { t: nowMs, v: { facts: {}, at: {}, ratings: { google: { average: 1.5, count: 11, at: nowMs } }, miss: {} } },
  [infoKey(odd)]: { t: nowMs, v: { facts: {}, at: {}, ratings: { google: { average: 4, count: 0, at: nowMs } }, miss: {} } }, // a saved pair that is not valid (no count)
}));

const T = 'Some Title';
const rec = (o: Partial<PrefetchedRecord> = {}): PrefetchedRecord => ({ title: T, rv: PREFETCH_VERSION, coverUrl: 'https://img/old.jpg', pageCount: 300, year: '2001', olKey: '/works/OL1W', ratingAverage: 4.5, ratingCount: 3000, ratingSource: 'apple', sources: { openlibrary: [4, 120], google: [4.2, 80], apple: [4.5, 3000] }, checked: ['openlibrary', 'google', 'apple'], ...o });

/* ------------------------------ the offline prefetch (storeResolved.json) ------------------------------ */

test('prefetch merge: a run where nothing answered ({ title }) keeps the whole saved record, so --redo-ratings cannot wipe it', () => {
  const old = rec();
  const merged = mergePrefetchedRecord(old, { title: T }, T);
  assert.deepEqual(merged, old);
  assert.ok(isCurrentRecord(merged, T));
});

test('prefetch merge: a run that could not reach Google keeps the saved Google pair and its checked flag; what answered is updated', () => {
  const merged = mergePrefetchedRecord(rec(), { title: T, coverUrl: 'https://img/new.jpg', ratingAverage: 4.4, ratingCount: 3100, ratingSource: 'apple', sources: { apple: [4.4, 3100], openlibrary: [4, 125] }, checked: ['openlibrary', 'apple'] }, T);
  assert.deepEqual(merged.sources, { openlibrary: [4, 125], google: [4.2, 80], apple: [4.4, 3100] });
  assert.deepEqual(merged.checked?.sort(), ['apple', 'google', 'openlibrary']);
  assert.equal(merged.coverUrl, 'https://img/new.jpg');
  assert.equal(merged.coverId, undefined);
  assert.equal(merged.pageCount, 300); // the new run had no page count: the saved one stays
  assert.equal(merged.olKey, '/works/OL1W');
  assert.equal(merged.rv, PREFETCH_VERSION);
});

test('prefetch merge: the headline rating is chosen again by the same ladder (Apple, then Open Library, then Google), never invented', () => {
  // Apple unreachable this time and never saved: the ladder gives Open Library (solid) over Google
  const noApple = mergePrefetchedRecord(rec({ sources: { openlibrary: [4, 120], google: [4.2, 80] }, ratingAverage: 4, ratingCount: 120, ratingSource: 'openlibrary' }), { title: T, sources: { google: [4.6, 90] }, checked: ['google'] }, T);
  assert.deepEqual([noApple.ratingAverage, noApple.ratingCount, noApple.ratingSource], [4, 120, 'openlibrary']);
  assert.deepEqual(noApple.sources?.google, [4.6, 90]);
  // a first prefetch of a book with nothing saved is exactly what the resolver said
  const first = { title: T, ratingAverage: 3.9, ratingCount: 4, ratingSource: 'google' as const, sources: { google: [3.9, 4] as [number, number] }, checked: ['google' as const] };
  assert.deepEqual(mergePrefetchedRecord(undefined, first, T), first);
});

test('prefetch merge: a thin fresh pair never replaces a solid saved one from the same site; another book in the slot starts fresh', () => {
  const merged = mergePrefetchedRecord(rec(), { title: T, sources: { google: [3, 2] }, checked: ['google'] }, T);
  assert.deepEqual(merged.sources?.google, [4.2, 80]);
  const other = { title: 'Another Book', sources: { google: [3, 2] as [number, number] }, checked: ['google' as const] };
  assert.deepEqual(mergePrefetchedRecord(rec(), other, 'Another Book'), other);
});

test('prefetch merge: a run still waiting for a site is not final, but a saved final record stays final', () => {
  const stillWaiting = mergePrefetchedRecord(undefined, { title: T, ratingAverage: 4, ratingCount: 50, ratingSource: 'openlibrary', sources: { openlibrary: [4, 50] }, checked: ['openlibrary'] }, T);
  assert.equal(stillWaiting.rv, undefined);
  assert.equal(mergePrefetchedRecord(rec(), { title: T }, T).rv, PREFETCH_VERSION);
});

test('prefetch merge: an INVALID fresh pair (no count, average out of range) never replaces a VALID saved pair, solid or thin', () => {
  const thin = rec({ sources: { openlibrary: [4, 120], google: [4.2, 5], apple: [4.5, 3000] } }); // a valid but thin Google pair
  for (const bad of [[3, 0], [0, 50], [5, 0], [0.5, 40], [6, 40], [NaN, 40]] as [number, number][]) {
    const merged = mergePrefetchedRecord(thin, { title: T, sources: { google: bad, openlibrary: bad }, checked: ['google', 'openlibrary'] }, T);
    assert.deepEqual(merged.sources?.google, [4.2, 5], `thin saved Google kept against ${JSON.stringify(bad)}`);
    assert.deepEqual(merged.sources?.openlibrary, [4, 120], `solid saved Open Library kept against ${JSON.stringify(bad)}`);
    assert.deepEqual([merged.ratingAverage, merged.ratingCount, merged.ratingSource], [4.5, 3000, 'apple']);
  }
});

test('prefetch merge: an INVALID saved pair is replaced by a valid fresh one (even a thin one); with nothing valid on either side there is no pair', () => {
  const bad = rec({ sources: { openlibrary: [4, 0], google: [0, 80] }, ratingAverage: undefined, ratingCount: undefined, ratingSource: undefined });
  const merged = mergePrefetchedRecord(bad, { title: T, sources: { openlibrary: [3.5, 2], google: [4.4, 60] }, checked: ['openlibrary', 'google'] }, T);
  assert.deepEqual(merged.sources, { openlibrary: [3.5, 2], google: [4.4, 60] }); // a thin fresh pair is fine when the old one was not a pair at all
  assert.deepEqual([merged.ratingAverage, merged.ratingCount, merged.ratingSource], [4.4, 60, 'google']); // the ladder: the solid Google over the thin Open Library
  // invalid on both sides: nothing is invented and the invalid saved pair is dropped, not carried forward
  const none = mergePrefetchedRecord(bad, { title: T, sources: { google: [3, 0] }, checked: ['google'] }, T);
  assert.equal(none.sources, undefined);
  assert.equal(none.ratingSource, undefined);
});

test('prefetch merge: a thin valid fresh pair still never replaces a solid valid saved one (unchanged rule)', () => {
  const merged = mergePrefetchedRecord(rec(), { title: T, sources: { google: [3, 9], apple: [2, 1] }, checked: ['google', 'apple'] }, T);
  assert.deepEqual(merged.sources?.google, [4.2, 80]);
  assert.deepEqual(merged.sources?.apple, [4.5, 3000]);
  // and two thin pairs: the fresh one wins
  assert.deepEqual(mergePrefetchedRecord(rec({ sources: { google: [4, 3] } }), { title: T, sources: { google: [3, 2] }, checked: ['google'] }, T).sources?.google, [3, 2]);
});

test('prefetch merge: keys the new answer holds as undefined / null / empty never overwrite saved metadata; real values still do', () => {
  const old = rec({ coverId: 99, coverUrl: undefined });
  const blank = { title: T, coverUrl: undefined, coverId: undefined, pageCount: undefined, year: undefined, olKey: undefined, rv: undefined, sources: undefined, checked: undefined, ratingAverage: undefined, ratingCount: undefined, ratingSource: undefined } as PrefetchedRecord;
  assert.deepEqual(mergePrefetchedRecord(old, blank, T), old);
  const empties = { title: T, pageCount: 0, year: '', olKey: null, ratingAverage: 3, ratingCount: 0, ratingSource: 'google' } as unknown as PrefetchedRecord; // an unusable headline pair is not a rating
  assert.deepEqual(mergePrefetchedRecord(old, empties, T), old);
  const real = mergePrefetchedRecord(old, { title: T, pageCount: 410, year: '2020', olKey: '/works/OL9W', coverUrl: undefined }, T);
  assert.deepEqual([real.pageCount, real.year, real.olKey, real.coverId], [410, '2020', '/works/OL9W', 99]);
});

/* ------------------------------ one site's pair after a fresh lookup ------------------------------ */

test('settleSiteRating: fresh valid pair wins; nothing usable keeps the old valid pair; a thin one does not replace a solid one; never invents', () => {
  const had = { average: 4.2, count: 80, source: 'google' as const };
  assert.deepEqual(settleSiteRating({ average: 4.8, count: 200, source: 'google' }, had), { average: 4.8, count: 200, source: 'google' });
  assert.deepEqual(settleSiteRating(undefined, had), had);
  assert.deepEqual(settleSiteRating({ average: 5, count: 0, source: 'google' }, had), had); // a rating with no count is not a pair
  assert.deepEqual(settleSiteRating({ average: 3, count: 2, source: 'google' }, had), had);
  assert.deepEqual(settleSiteRating({ average: 3, count: 2, source: 'google' }, { average: 4, count: 3, source: 'google' }), { average: 3, count: 2, source: 'google' });
  assert.equal(settleSiteRating(undefined, undefined), undefined);
  assert.equal(settleSiteRating(undefined, { average: 4.2, count: 0, source: 'google' }), undefined);
});

/* ------------------------------ the resolver's saved result ------------------------------ */

const isOl = (u: URL) => u.hostname === 'openlibrary.org';
const isGoogle = (u: URL) => u.hostname === 'www.googleapis.com';
const isApple = (u: URL) => u.hostname === 'itunes.apple.com';
const qA = { title: 'Keep Alpha', author: 'Kay Writer', apple: true } as const;
const qB = { title: 'Keep Beta', author: 'Kay Writer', apple: true } as const;
const olFound = (title: string, key: string) => (u: URL) => (isOl(u) && u.pathname === '/search.json' ? { body: { docs: [{ key, title, author_name: ['Kay Writer'], first_publish_year: 2018, cover_i: 77, number_of_pages_median: 250 }] } } : isOl(u) ? { body: { docs: [], summary: {} } } : undefined);
const noApple = (u: URL) => (isApple(u) ? { body: { results: [] } } : undefined);
const gbDown = (u: URL) => (isGoogle(u) ? { throws: true } : undefined);
const gbRated = (title: string, average: number, count: number) => (u: URL) => (isGoogle(u) ? { body: { items: [{ id: 'g77', volumeInfo: { title, authors: ['Kay Writer'], averageRating: average, ratingsCount: count } }] } } : undefined);

test('resolver: an expired saved result is looked up again, and a Google that cannot be reached does not erase its earlier valid rating', async () => {
  routeFetch([olFound('Keep Alpha', '/works/OL77W'), noApple, gbDown]);
  const r = await resolveBook(qA);
  assert.deepEqual([r?.book.ratingAverage, r?.book.ratingCount, r?.book.ratingSource], [4.3, 60, 'google']);
  assert.deepEqual(r?.ratings, [{ source: 'google', average: 4.3, count: 60 }]);
});

test('resolver: when Google answers with a valid rating, the fresh one replaces the saved one (better data is accepted)', async () => {
  routeFetch([olFound('Keep Beta', '/works/OL78W'), noApple, gbRated('Keep Beta', 4.6, 140)]);
  const r = await resolveBook(qB);
  assert.deepEqual([r?.book.ratingAverage, r?.book.ratingCount, r?.book.ratingSource], [4.6, 140, 'google']);
});

/* ------------------------------ an installed app's saved Book Info ------------------------------ */

test('installed app: Book Info saved before Google ratings shipped (a confirmed "none", with a week to wait) shows the Google rating shipped with the app, and asks no one', async () => {
  assert.equal(bundledBooks.length, 3, 'the shipped ratings must contain books with all three sites');
  const entry = getInfo(jane);
  const want = ['openlibrary', 'google', 'apple'].map(s => [s, shipped(jane, s).average, shipped(jane, s).count]);
  assert.deepEqual(siteRatingsOf(entry).map(r => [r.source, r.average, r.count]), want);
  assert.equal(entry.miss['rating:google'], undefined);
  const complete = { ...jane, year: '1847', pageCount: 400, summary: 'x'.repeat(80), authorBio: 'y'.repeat(60) }; // every other field is known: only ratings are in question
  assert.deepEqual(missingFields(complete), []); // all three sites have a rating now: nothing to ask
  assert.equal(getInfo(jane), entry); // the same object until something changes (useSyncExternalStore)
  const calls = routeFetch([() => ({ throws: true })]);
  await ensureBookInfo(complete);
  assert.equal(calls.length, 0, 'no site is asked: the ratings are already known');
  assert.equal(applyInfo(jane).ratingSource, 'apple'); // the ladder is unchanged: Apple, then Open Library, then Google; Google shows beside it
  assert.equal(store.get('readlife.v2'), '{"library":"keep"}');
});

test('installed app: a valid pair Book Info already saved for a site is not replaced by the shipped one (the normal refresh owns it)', () => {
  assert.deepEqual(siteRatingsOf(getInfo(emma)).find(r => r.source === 'google'), { source: 'google', average: 1.5, count: 11 });
});

test('installed app: a saved pair that is not valid (no count) is filled from the shipped one; other sites are left alone', () => {
  const g = siteRatingsOf(getInfo(odd)).find(r => r.source === 'google');
  assert.deepEqual(g, { source: 'google', average: shipped(odd, 'google').average, count: shipped(odd, 'google').count });
});
