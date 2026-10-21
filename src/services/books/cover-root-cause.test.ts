// Run with: npm test
// Regression tests for the cover problems seen on device: an untagged German box set passing as "English", a failed (timed out / rate limited) lookup
// being remembered as "no cover" for a day, and the short Open Library list being remembered for a month. No book titles are special-cased.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { openLibraryEditionCovers, openLibraryEnglishCoverFor, forgetEditionsForTests, BUNDLE_TITLE } from './sources/openLibrary';
import { routeFetch } from '../store/testkit';

const isOl = (u: URL) => u.hostname === 'openlibrary.org';
const editions = (entries: any[]) => (u: URL) => (isOl(u) && u.pathname === '/works/OL1W/editions.json' ? { body: { entries } } : undefined);

test('a box set / omnibus title is a bundle; ordinary titles are not', () => {
  for (const t of ['Wenn sie wüsste: 3 in 1', 'The Complete Series Box Set', 'Dune Omnibus', 'Books 1-3 bundle']) assert.ok(BUNDLE_TITLE.test(t), t);
  for (const t of ['The Housemaid', 'Catch-22', 'Fahrenheit 451', 'Can We Be Strangers Again?', 'The 7 1/2 Deaths']) assert.ok(!BUNDLE_TITLE.test(t), t);
});

test('an UNTAGGED foreign box set (newest, no language) is not offered as an English cover; an edition that says English leads', async () => {
  forgetEditionsForTests();
  routeFetch([editions([
    { title: 'Wenn sie wüsste: 3 in 1', publish_date: '2025', covers: [900] }, // untagged, newest, a collage
    { title: 'Die Haushälterin', publish_date: '2024', covers: [901] }, // untagged, looks foreign
    { title: 'The Housemaid', publish_date: '2022', covers: [100], languages: [{ key: '/languages/eng' }] },
    { title: 'The Housemaid', publish_date: '2019', covers: [101] }, // untagged but plainly the same English title
  ])]);
  assert.deepEqual(await openLibraryEditionCovers('OL1W', 8), [100, 101]);
});

test('a work cover_i that belongs to an untagged foreign edition is replaced by the English edition cover', async () => {
  forgetEditionsForTests();
  routeFetch([editions([
    { title: 'Wenn sie wüsste: 3 in 1', publish_date: '2025', covers: [900] },
    { title: 'The Housemaid', publish_date: '2022', covers: [100], languages: [{ key: '/languages/eng' }] },
  ])]);
  assert.equal(await openLibraryEnglishCoverFor('OL1W', 900), 100);
});

import { resolveCover } from './covers';

test('a lookup that failed (rate limit / server error) is remembered as "no cover" for minutes, not a day; a real "nothing anywhere" for a day', async () => {
  store.clear();
  routeFetch([() => ({ status: 429, body: {} })]);
  assert.equal(await resolveCover({ id: 't1', title: 'Some Brand New Book', author: 'Nobody Known' } as any), '');
  const soon = JSON.parse(store.get('readlife.coverNone3') || '{}')['some brand new book|nobody known'];
  assert.ok(soon && Date.now() - soon > 23 * 3600 * 1000, 'a failed lookup must expire within minutes (stamp is back-dated)');

  store.clear();
  routeFetch([(u: URL) => (u.hostname === 'itunes.apple.com' ? { body: { results: [] } } : u.hostname === 'openlibrary.org' ? { body: { docs: [] } } : { body: { items: [] } })]);
  assert.equal(await resolveCover({ id: 't2', title: 'Another Unknown Book', author: 'Also Nobody' } as any), '');
  const first = JSON.parse(store.get('readlife.coverNone3') || '{}')['another unknown book|also nobody'];
  assert.ok(first && Date.now() - first > 23 * 3600 * 1000, 'a FIRST miss is back-dated: retried on the next view, never a day-long "none found"');

  // the same book missing again (a repeated, clean miss) is remembered for the full day
  const none = JSON.parse(store.get('readlife.coverNone3') || '{}');
  store.set('readlife.coverNone3', JSON.stringify(none));
  assert.equal(await resolveCover({ id: 't2', title: 'Another Unknown Book', author: 'Also Nobody' } as any, { force: true }), '');
  const real = JSON.parse(store.get('readlife.coverNone3') || '{}')['another unknown book|also nobody'];
  assert.ok(real && Date.now() - real < 60 * 1000, 'a repeated real miss is stamped now (remembered for the full day)');
});
