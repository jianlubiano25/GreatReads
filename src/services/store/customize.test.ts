import test from 'node:test';
import assert from 'node:assert/strict';
import type { CuratedShelf } from '../../data/storeCatalog';
import { CURATED_SHELVES } from '../../data/storeCatalog';
import { forgetNytList } from '../books/sources/nyt';
import { NYT_EXTRA_SHELVES, NYT_SHELVES, bestsellerSource } from './bestsellers';
import { DYNAMIC_SPECS, dynamicCuratedSource, everyLabel, refreshShelf, type DynamicSpec } from './dynamic';
import { checkNytLists } from './nytListNames';
import { STORE_PREFS_KEY, loadStorePrefs, moveItem, orderShelves, saveStorePrefs, toggleHidden } from './prefs';
import { COOLDOWN_FAILED_MS, COOLDOWN_OK_MS, cooldownLeft, formatUpdated, manualRefresh } from './refresh';
import { DEFAULT_SHELF_ORDER, STORE_SHELVES } from './registry';
import { nytList, routeFetch } from './testkit';
import { trendingSource } from './trending';

/* NOTE: fixtures here are written for the tests. Nothing in this file was fetched from a live source. */

/* ------------------------------ layout preferences ------------------------------ */

const DEFAULT = ['a', 'b', 'c', 'd', 'e'];

test('orderShelves: no saved layout gives the default order; a saved order wins; unknown and repeated ids are ignored', () => {
  assert.deepEqual(orderShelves(DEFAULT, []), DEFAULT);
  assert.deepEqual(orderShelves(DEFAULT, ['c', 'a', 'b', 'd', 'e']), ['c', 'a', 'b', 'd', 'e']);
  assert.deepEqual(orderShelves(DEFAULT, ['e', 'zzz', 'e', 'a', 'b', 'c', 'd']), ['e', 'a', 'b', 'c', 'd']);
});

test('orderShelves: a shelf added later takes its default place after its default neighbour', () => {
  // the reader saved a layout from before "first" and "c" existed
  assert.deepEqual(orderShelves(['first', 'a', 'b', 'c'], ['b', 'a']), ['first', 'b', 'c', 'a']);
});

test('orderShelves: two new shelves in a row keep their relative order', () => {
  // default a b c d e; saved layout only knows e and a
  assert.deepEqual(orderShelves(DEFAULT, ['e', 'a']), ['e', 'a', 'b', 'c', 'd']);
});

test('moveItem and toggleHidden are pure', () => {
  const list = ['a', 'b', 'c'];
  assert.deepEqual(moveItem(list, 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(moveItem(list, 2, 0), ['c', 'a', 'b']);
  assert.equal(moveItem(list, 1, 1), list);
  assert.equal(moveItem(list, 5, 0), list);
  assert.deepEqual(list, ['a', 'b', 'c']);
  assert.deepEqual(toggleHidden(['x'], 'y'), ['x', 'y']);
  assert.deepEqual(toggleHidden(['x', 'y'], 'x'), ['y']);
});

test('prefs persist on the device, and a damaged record falls back to the default layout', () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  try {
    assert.deepEqual(loadStorePrefs(), { order: [], hidden: [] });
    assert.equal(saveStorePrefs({ order: ['b', 'a'], hidden: ['a'] }), true);
    assert.deepEqual(loadStorePrefs(), { order: ['b', 'a'], hidden: ['a'] });
    store.set(STORE_PREFS_KEY, '{not json');
    assert.deepEqual(loadStorePrefs(), { order: [], hidden: [] });
    store.set(STORE_PREFS_KEY, JSON.stringify({ order: ['a', 5, null, 'a'], hidden: 'nope' }));
    assert.deepEqual(loadStorePrefs(), { order: ['a'], hidden: [] });
  } finally {
    delete (globalThis as any).localStorage;
  }
});

/* ------------------------------ the rate-limited manual refresh ------------------------------ */

test('manualRefresh: runs the shelf\'s own refresh, then refuses to run again during the cool-down', async () => {
  let calls = 0;
  const src = { id: 't-cool-ok', refresh: async () => (calls++, 'updated' as const) };
  assert.equal(await manualRefresh(src), 'updated');
  assert.equal(calls, 1);
  assert.ok(cooldownLeft('t-cool-ok') > COOLDOWN_FAILED_MS && cooldownLeft('t-cool-ok') <= COOLDOWN_OK_MS);
  for (let i = 0; i < 5; i++) assert.equal(await manualRefresh(src), 'cooldown'); // repeated taps do nothing
  assert.equal(calls, 1);
  assert.equal(cooldownLeft('t-cool-ok', Date.now() + COOLDOWN_OK_MS + 1), 0);
});

test('manualRefresh: a failure (or a throw) is reported, and may be retried sooner than a success', async () => {
  const bad = { id: 't-cool-bad', refresh: async () => 'failed' as const };
  assert.equal(await manualRefresh(bad), 'failed');
  assert.ok(cooldownLeft('t-cool-bad') <= COOLDOWN_FAILED_MS);
  const boom = { id: 't-cool-throw', refresh: async () => { throw new Error('x'); } };
  assert.equal(await manualRefresh(boom as any), 'failed');
});

test('manualRefresh: taps while a refresh is running share it; shelves without a refresh are unsupported', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const src = { id: 't-share', refresh: async () => { calls++; await gate; return 'unchanged' as const; } };
  const a = manualRefresh(src), b = manualRefresh(src);
  release();
  assert.deepEqual(await Promise.all([a, b]), ['unchanged', 'unchanged']);
  assert.equal(calls, 1);
  assert.equal(await manualRefresh({ id: 't-none' }), 'unsupported');
});

test('formatUpdated: just now, minutes, hours, yesterday, date', () => {
  const now = new Date(2026, 9, 7, 15, 0, 0).getTime();
  assert.equal(formatUpdated(undefined, now), 'Not refreshed yet');
  assert.equal(formatUpdated(now - 20_000, now), 'Updated just now');
  assert.equal(formatUpdated(now - 5 * 60_000, now), 'Updated 5 min ago');
  assert.equal(formatUpdated(now - 60 * 60_000, now), 'Updated 1 hour ago');
  assert.equal(formatUpdated(now - 2 * 3600_000, now), 'Updated 2 hours ago');
  assert.equal(formatUpdated(new Date(2026, 9, 6, 8, 0).getTime(), now), 'Updated yesterday');
  assert.equal(formatUpdated(new Date(2026, 9, 1, 8, 0).getTime(), now), 'Updated Oct 1');
  assert.equal(formatUpdated(new Date(2025, 11, 25, 8, 0).getTime(), now), 'Updated Dec 25, 2025');
});

/* ------------------------------ shelf refresh: success moves the time, failure keeps everything ------------------------------ */

const shelf = (id: string, n = 12): CuratedShelf => ({ id, title: 'Test shelf', emoji: '📚', genre: 'Fiction', seeds: Array.from({ length: n }, (_, i) => [`Base ${i}`, `Base Author ${i}`] as [string, string]) });
const fresh = (tag: string, n = 10) => Array.from({ length: n }, (_, i) => [`${tag} ${i}`, `${tag} Author ${i}`] as [string, string]);
const spec = (fetch: DynamicSpec['fetch'], refreshMs = 7 * 24 * 3600_000): DynamicSpec => ({ source: 'test source', kind: 'fallback', refreshMs, minSeeds: 8, fetch });

test('dynamic shelf manual refresh: success moves "last updated"; same list is "unchanged" but still counts as a successful check', async () => {
  const sh = shelf('t-man-ok');
  routeFetch([]);
  const old = Date.now() - 3 * 24 * 3600_000;
  await refreshShelf(sh, spec(async () => ({ seeds: fresh('Old') })), old);
  const src = dynamicCuratedSource(sh, spec(async () => ({ seeds: fresh('New') })));
  assert.equal(src.info?.().updatedAt, old);
  assert.equal(await src.refresh?.(), 'updated');
  const at1 = src.info?.().updatedAt ?? 0;
  assert.ok(at1 > old);
  assert.equal(src.cached()?.[0].title, 'New 0');

  const same = dynamicCuratedSource(sh, spec(async () => ({ seeds: fresh('New') })));
  assert.equal(await same.refresh?.(), 'unchanged');
  assert.ok((same.info?.().updatedAt ?? 0) >= at1);
});

test('dynamic shelf manual refresh: a failure keeps the saved list AND the old "last updated" time', async () => {
  const sh = shelf('t-man-fail');
  routeFetch([]);
  const old = Date.now() - 3 * 24 * 3600_000;
  await refreshShelf(sh, spec(async () => ({ seeds: fresh('Kept') })), old);
  for (const fetch of [async () => { throw new Error('down'); }, async () => null, async () => ({ seeds: fresh('Tiny', 2) })] as DynamicSpec['fetch'][]) {
    const src = dynamicCuratedSource(sh, spec(fetch));
    assert.equal(await src.refresh?.(), 'failed');
    assert.equal(src.info?.().updatedAt, old, 'a failed try is not an update');
    assert.equal(src.cached()?.[0].title, 'Kept 0');
    assert.equal(src.cached()?.length, 10);
  }
});

test('dynamic shelf manual refresh: with nothing ever saved, a failure leaves the hand-picked list and no update time', async () => {
  const sh = shelf('t-man-never');
  routeFetch([]);
  const src = dynamicCuratedSource(sh, spec(async () => null));
  assert.equal(await src.refresh?.(), 'failed');
  assert.equal(src.info?.().updatedAt, undefined);
  assert.equal(src.cached()?.[0].title, 'Base 0');
});

test('dynamic shelf info: says how it refreshes and what kind of source it is', () => {
  const info = dynamicCuratedSource(shelf('t-info'), spec(async () => null)).info?.();
  assert.equal(info?.schedule, 'Refreshes weekly');
  assert.equal(info?.kind, 'fallback');
  assert.match(info?.source || '', /not the official list/);
  assert.equal(everyLabel(24 * 3600_000), 'daily');
  assert.equal(everyLabel(3 * 24 * 3600_000), 'every 3 days');
  assert.equal(everyLabel(30 * 24 * 3600_000), 'monthly');
  assert.equal(DYNAMIC_SPECS.oprah.kind, 'fallback');
  assert.equal(DYNAMIC_SPECS.romance.kind, 'generated');
});

test('NYT shelf manual refresh: a new official list updates the time; a failing NYT keeps the saved list and its time', async () => {
  const ya = NYT_EXTRA_SHELVES[1];
  const rows = (tag: string) => Array.from({ length: 12 }, (_, i) => [`${tag} ${i}`, `Author ${i}`, `97803064061${String(i).padStart(2, '0')}`.slice(0, 13)] as [string, string, string]);
  const nytRoute = (body: unknown, status = 200) => [(u: URL) => (u.pathname === '/api/nyt' ? { status, body } : undefined)];

  forgetNytList(ya.list);
  routeFetch(nytRoute(nytList(rows('First'))));
  const src = bestsellerSource(ya);
  assert.equal(await src.refresh?.(), 'updated');
  const t1 = src.info?.().updatedAt;
  assert.ok(t1);
  assert.equal(src.info?.().kind, 'official');

  // the NYT is now failing: forced refresh is a failure, the saved list and its time are untouched
  routeFetch(nytRoute({ error: 'rate_limited' }, 429));
  assert.equal(await src.refresh?.(), 'failed');
  assert.equal(src.info?.().updatedAt, t1);
  assert.equal(src.cached()?.[0].title, 'First 0');

  // and the same list again is "unchanged", not "updated"
  routeFetch(nytRoute(nytList(rows('First'))));
  assert.equal(await src.refresh?.(), 'unchanged');
});

test('Trending manual refresh: when every source is down it fails and changes nothing', async () => {
  routeFetch([() => ({ throws: true })]);
  assert.equal(await trendingSource.refresh?.(), 'failed');
  assert.equal(trendingSource.info?.().updatedAt, undefined);
});

/* ------------------------------ the shelf registry ------------------------------ */

test('registry: one entry per shelf, unique ids, every source can describe itself, and refreshing shelves are exactly the non-hand-picked ones', () => {
  assert.equal(new Set(DEFAULT_SHELF_ORDER).size, DEFAULT_SHELF_ORDER.length);
  const curatedIds = new Set(CURATED_SHELVES.map(s => s.id));
  for (const d of STORE_SHELVES) {
    assert.ok(d.source || d.library, `${d.id} has data`);
    if (d.source?.refresh) assert.ok(d.source.info, `${d.id} refreshes, so it can describe itself`);
    if (curatedIds.has(d.id)) {
      const dynamic = !!DYNAMIC_SPECS[d.id];
      assert.equal(!!d.source?.refresh, dynamic, d.id);
      assert.equal(d.source?.info?.().kind === 'curated', !dynamic, d.id);
    }
  }
  for (const s of [...NYT_SHELVES, ...NYT_EXTRA_SHELVES]) assert.ok(STORE_SHELVES.some(d => d.id === s.id && d.source?.refresh), s.id);
  assert.ok(STORE_SHELVES.find(d => d.id === 'trending')?.source?.refresh);
  assert.deepEqual(DEFAULT_SHELF_ORDER.slice(0, 3), ['nyt-fiction', 'nyt-nonfiction', 'trending']); // the Store's existing order is the default
});

test('refreshing or reordering never changes the other: layout lives apart from shelf data', async () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  try {
    const layout = { order: ['c', 'a', 'b'], hidden: ['b'] };
    saveStorePrefs(layout);
    const sh = shelf('t-apart');
    routeFetch([]);
    const src = dynamicCuratedSource(sh, spec(async () => ({ seeds: fresh('X') })));
    await src.refresh?.();
    assert.deepEqual(loadStorePrefs(), layout, 'a refresh leaves the layout alone');
    const before = src.cached()?.map(b => b.title);
    saveStorePrefs({ order: ['b', 'c', 'a'], hidden: [] });
    assert.deepEqual(src.cached()?.map(b => b.title), before, 'a new layout leaves the shelf data alone');
  } finally {
    delete (globalThis as any).localStorage;
  }
});

/* ------------------------------ NYT list names ------------------------------ */

test('checkNytLists: finds the names the NYT publishes and flags ones it does not (fixture in the documented names.json shape)', () => {
  const names = [
    { list_name: 'Young Adult Hardcover', display_name: 'Young Adult Hardcover', list_name_encoded: 'young-adult-hardcover', updated: 'WEEKLY' },
    { list_name: 'Advice How-To and Miscellaneous', display_name: 'Advice, How-To & Miscellaneous', list_name_encoded: 'advice-how-to-and-miscellaneous', updated: 'WEEKLY' },
  ];
  const r = checkNytLists(names, [{ id: 'ya', list: 'young-adult-hardcover' }, { id: 'adv', list: 'advice-how-to-and-miscellaneous' }, { id: 'typo', list: 'young-adult-paperback' }]);
  assert.deepEqual(r.found.map(f => f.id), ['ya', 'adv']);
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].id, 'typo');
  assert.deepEqual(r.missing[0].suggestions, ['young-adult-hardcover']);
});
