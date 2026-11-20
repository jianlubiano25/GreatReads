// Run with: npm test
// A new build keeps the saved shelf lists, their reset marks and the shelf covers; an IndexedDB safety copy puts them back if the browser dropped them;
// covers are reused by title + author (not only for an identical list); a missing saved list is rebuilt from the last good copy before the hand-picked default.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

const { refreshDataForNewBuild } = await import('../refreshApp');
const { KEEP_ACROSS_BUILDS, persistentCache } = await import('../books/cache');
const { restoreDurableCopies, setDurableBackendForTests } = await import('../durableCopy');
const { CURATED_SHELVES } = await import('../../data/storeCatalog');
const cur = await import('./curated');
const { COVER_RULE } = await import('../books/resolve');
const dyn = await import('./dynamic');

const flush = () => new Promise(r => setTimeout(r, 450)); // persistentCache saves after 400 ms
const shelf = CURATED_SHELVES.find(s => s.id === 'oprah')!;

test('a new build keeps the saved shelf lists, reset marks and shelf covers; the other caches are still forgotten', () => {
  for (const k of KEEP_ACROSS_BUILDS) store.set(k, '{"x":{"t":1,"v":1}}');
  store.set('readlife.resolved3', '{"x":1}');
  store.set('readlife.v2', '{"customBooks":[1]}');
  assert.equal(refreshDataForNewBuild('build-keep-1'), true);
  for (const k of KEEP_ACROSS_BUILDS) assert.equal(store.has(k), true, `${k} must survive an update`);
  assert.equal(store.has('readlife.resolved3'), false, 'the re-downloadable cache is still forgotten');
  assert.equal(store.get('readlife.v2'), '{"customBooks":[1]}');
});

test('safety copy: a key the browser dropped is put back before the app draws; a key that is there is never replaced', async () => {
  const idb = new Map<string, string>([['readlife.dynseeds1', '{"oprah":{"t":1,"v":{"seeds":[]}}}'], ['readlife.dynreset1', '{"oprah":{"t":1,"v":"default-list-2"}}'], ['readlife.curated3', '{"a":1}']]);
  let reads = 0;
  setDurableBackendForTests({ put: async (k, t) => void idb.set(k, t), remove: async k => void idb.delete(k), getAll: async keys => { reads++; return Object.fromEntries(keys.filter(k => idb.has(k)).map(k => [k, idb.get(k)!])); } });
  store.clear();
  store.set('readlife.curated3', '{"mine":1}');
  const restored = await restoreDurableCopies(KEEP_ACROSS_BUILDS);
  assert.deepEqual(restored.sort(), ['readlife.dynreset1', 'readlife.dynseeds1']);
  assert.equal(store.get('readlife.curated3'), '{"mine":1}', 'present: untouched');
  const before = reads;
  assert.deepEqual(await restoreDurableCopies(KEEP_ACROSS_BUILDS), [], 'everything there: nothing restored');
  assert.equal(reads, before, 'and IndexedDB is not even opened');
  setDurableBackendForTests(undefined);
});

test('safety copy: no IndexedDB, a hanging one or an unreadable copy never blocks or breaks the start', async () => {
  setDurableBackendForTests(undefined);
  store.clear();
  assert.deepEqual(await restoreDurableCopies(KEEP_ACROSS_BUILDS), []);
  setDurableBackendForTests({ put: async () => {}, remove: async () => {}, getAll: () => new Promise(() => {}) });
  const t = Date.now();
  assert.deepEqual(await restoreDurableCopies(KEEP_ACROSS_BUILDS, 50), []);
  assert.ok(Date.now() - t < 1000);
  setDurableBackendForTests({ put: async () => {}, remove: async () => {}, getAll: async () => ({ 'readlife.dynseeds1': 'not json {' }) });
  assert.deepEqual(await restoreDurableCopies(KEEP_ACROSS_BUILDS), []);
  assert.equal(store.has('readlife.dynseeds1'), false);
  setDurableBackendForTests(undefined);
});

test('a durable cache mirrors what it saves, and an explicit clear removes the copy too', async () => {
  const idb = new Map<string, string>();
  setDurableBackendForTests({ put: async (k, t) => void idb.set(k, t), remove: async k => void idb.delete(k), getAll: async () => ({}) });
  const c = persistentCache<number>('readlife.testDurable1', { ttl: 1e9, max: 5, durable: true });
  c.set('a', 1);
  await flush();
  assert.ok(idb.get('readlife.testDurable1')?.includes('"a"'));
  c.clear();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(idb.has('readlife.testDurable1'), false, 'a deliberate clear is not undone');
  setDurableBackendForTests(undefined);
});

/* ---------- covers by title + author ---------- */

const bookOf = (title: string, author: string, extra: object = {}) => ({ id: `x_${title}`, title, author, genre: 'Fiction', summary: '', spineColor: '#000', source: 'openlibrary', year: '', pageCount: 0, ...extra }) as any;
const DAY_MS = 864e5;

test('covers are reused by title + author when the list is NOT identical (a pick was added in front)', () => {
  cur.clearSavedShelvesForTests();
  const seeds = shelf.seeds.slice(0, 4);
  cur.putSavedShelfForTests(shelf.id, seeds.map(([t, a], i) => bookOf(t, a, { coverUrl: `https://img.example/${i}.jpg`, ratingAverage: 4.2, ratingCount: 10, ratingSource: 'google' })), Date.now() - DAY_MS);
  const changed = { ...shelf, seeds: [['A Brand New Pick', 'New Author'] as [string, string], ...seeds] };
  const out = cur.reuseSavedCovers(changed, changed.seeds.map(([t, a]) => bookOf(t, a)));
  assert.equal(out[0].coverUrl, undefined, 'the new pick has no saved cover and stays a placeholder');
  assert.deepEqual(out.slice(1).map((b: any) => b.coverUrl), seeds.map((_, i) => `https://img.example/${i}.jpg`));
  assert.equal(out[1].ratingAverage, 4.2, 'fresh copy: rating too');
  assert.equal(out[1].title, seeds[0][0], "the shelf's own title stays");
});

test('another shelf\'s copy of the same book is used too', () => {
  cur.clearSavedShelvesForTests();
  const [t, a] = shelf.seeds[0];
  cur.putSavedShelfForTests('some-other-shelf', [bookOf(t, a, { coverUrl: 'https://img.example/other.jpg' })], Date.now() - DAY_MS);
  assert.equal(cur.reuseSavedCovers(shelf, [bookOf(t, a)])[0].coverUrl, 'https://img.example/other.jpg');
});

test('a stale copy gives its cover but not its rating; a different book never gets a cover; what a book has wins; too old is ignored', () => {
  cur.clearSavedShelvesForTests();
  const [[t1, a1], [t2, a2]] = shelf.seeds;
  cur.putSavedShelfForTests(shelf.id, [bookOf(t1, a1, { coverUrl: 'https://img.example/1.jpg', ratingAverage: 3.9, ratingCount: 5, ratingSource: 'google' }), bookOf(t2, a2, { coverUrl: 'https://img.example/2.jpg' })], Date.now() - 20 * DAY_MS);
  const out = cur.reuseSavedCovers(shelf, [bookOf(t1, a1), bookOf('Another Book', a1), bookOf(t2, a2, { coverUrl: 'https://bundled.example/b.jpg' })]);
  assert.equal(out[0].coverUrl, 'https://img.example/1.jpg');
  assert.equal(out[0].ratingAverage, undefined, 'a stale rating is looked up again, not kept for ever');
  assert.equal(out[1].coverUrl, undefined, 'same author, other title: nothing');
  assert.equal(out[2].coverUrl, 'https://bundled.example/b.jpg', 'its own cover wins');
  cur.clearSavedShelvesForTests();
  cur.putSavedShelfForTests(shelf.id, [bookOf(t1, a1, { coverUrl: 'https://img.example/1.jpg' })], Date.now() - 90 * DAY_MS);
  assert.equal(cur.reuseSavedCovers(shelf, [bookOf(t1, a1)])[0].coverUrl, undefined, 'older than 60 days');
});

test('a copy saved under another cover rule is not used', () => {
  cur.clearSavedShelvesForTests();
  const [t, a] = shelf.seeds[0];
  cur.putSavedShelfForTests(shelf.id, [bookOf(t, a, { coverUrl: 'https://img.example/x.jpg' })], Date.now(), COVER_RULE + 1);
  assert.equal(cur.reuseSavedCovers(shelf, [bookOf(t, a)])[0].coverUrl, undefined);
});

/* ---------- rebuild from the last good copy ---------- */

test('with the reset mark gone the reset runs once and the shelf starts from its hand-picked list on purpose, even with a last good copy', () => {
  dyn.forgetResetMarksForTests();
  cur.clearSavedShelvesForTests();
  cur.putSavedShelfForTests('oprah', [bookOf('Pick One', 'Author One'), bookOf('Pick Two', 'Author Two'), bookOf('Pick Three', 'Author Three')], Date.now());
  const src = dyn.dynamicCuratedSource(shelf, dyn.DYNAMIC_SPECS.oprah);
  assert.equal(src.cached!()![0].title, shelf.seeds[0][0]);
});

test('a missing saved list is rebuilt from the last good shelf copy, not the hand-picked default', () => {
  // the previous test ran the reset, so the mark is set now: the saved list is simply missing
  const picks = [['Pick One', 'Author One', "Oprah's Book Club · Jun 2026"], ['Pick Two', 'Author Two'], ['Pick Three', 'Author Three'], ...shelf.seeds.slice(0, 5)] as [string, string, string?][];
  cur.clearSavedShelvesForTests();
  cur.putSavedShelfForTests('oprah', picks.map(([t, a, w]) => bookOf(t, a, { awardLabel: w, coverUrl: 'https://img.example/c.jpg' })), Date.now() - DAY_MS);
  const src = dyn.dynamicCuratedSource(shelf, dyn.DYNAMIC_SPECS.oprah);
  const first = src.cached!()!;
  assert.equal(first[0].title, 'Pick One', 'the list the shelf last showed, not the default');
  assert.equal(first[0].awardLabel, "Oprah's Book Club · Jun 2026");
  assert.equal(first[0].coverUrl, 'https://img.example/c.jpg', 'and with its cover from the first frame');
  assert.equal(dyn.dynamicInfo(shelf, dyn.DYNAMIC_SPECS.oprah).updatedAt, undefined, 'a rebuilt list does not claim to be a refresh');
});

test('a last good copy that is just the default list changes nothing; a copy that is too short is not used', () => {
  cur.clearSavedShelvesForTests();
  cur.putSavedShelfForTests('oprah', shelf.seeds.map(([t, a, w]) => bookOf(t, a, { awardLabel: w })), Date.now());
  assert.equal(dyn.dynamicInfo(shelf, dyn.DYNAMIC_SPECS.oprah).updatedAt, undefined);
  cur.clearSavedShelvesForTests();
  cur.putSavedShelfForTests('oprah', [bookOf('Only One', 'Author One')], Date.now());
  assert.equal(dyn.dynamicCuratedSource(shelf, dyn.DYNAMIC_SPECS.oprah).cached!()![0].title, shelf.seeds[0][0]);
});
