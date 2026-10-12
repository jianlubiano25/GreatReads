// Run with: npm test
// The update lifecycle: detecting and applying a new app version without loops or interruptions, stale book data being replaced by new
// bundled data, a failed refresh keeping the last good data, and user data never being touched by any of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const store = new Map<string, string>();
const shim = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; } };
(globalThis as any).localStorage = shim;

import { AUTO_AWAY_MS, AUTO_LAUNCH_WINDOW_MS, AUTO_RETRY_AFTER_MS, autoUpdatePlan, parseTried, type AutoUpdateInput } from './updateRule';
import { clearableCacheKeys, dropLegacyBookCaches, persistentCache } from './books/cache';
import { bundledDataSig, getCachedCurated, shelfSig } from './store/curated';
import { EXTRA_CLEARABLE } from '../hooks/useReadingLife';

const root = path.resolve(import.meta.dirname, '../..');

/* ------------------------------ 1. app updates: when to apply, when to ask, never loop ------------------------------ */

const NOW = 1_800_000_000_000;
const base: AutoUpdateInput = { appBuild: 'aaa111', targetBuild: 'bbb222', online: true, msSinceLaunch: 2_000, hiddenForMs: 0, busy: false, tried: null, now: NOW };

test('a newer build is applied automatically only at a natural pause with nothing in progress', () => {
  assert.equal(autoUpdatePlan(base), 'reload'); // just opened
  assert.equal(autoUpdatePlan({ ...base, msSinceLaunch: 3 * 60_000, hiddenForMs: AUTO_AWAY_MS }), 'reload'); // came back after being away
  assert.equal(autoUpdatePlan({ ...base, msSinceLaunch: AUTO_LAUNCH_WINDOW_MS + 1 }), 'prompt'); // mid-use: ask, never reload under the reader
  assert.equal(autoUpdatePlan({ ...base, msSinceLaunch: 60_000, hiddenForMs: AUTO_AWAY_MS - 1 }), 'prompt');
  assert.equal(autoUpdatePlan({ ...base, busy: true }), 'prompt'); // a field has focus / a sheet is open
  assert.equal(autoUpdatePlan({ ...base, online: false }), 'prompt');
});

test('nothing newer, a dev server, or the same build: no reload and no banner', () => {
  assert.equal(autoUpdatePlan({ ...base, targetBuild: null }), 'none');
  assert.equal(autoUpdatePlan({ ...base, targetBuild: 'aaa111' }), 'none');
  assert.equal(autoUpdatePlan({ ...base, appBuild: 'dev' }), 'none');
});

test('no reload loop: after one automatic attempt for a build the reader is asked, whatever the network does', () => {
  const tried = { build: 'bbb222', at: NOW - 60_000 };
  assert.equal(autoUpdatePlan({ ...base, tried }), 'prompt'); // the page came back still on the old build (e.g. a stale edge cache)
  assert.equal(autoUpdatePlan({ ...base, tried: { ...tried, at: NOW - AUTO_RETRY_AFTER_MS - 1 } }), 'reload'); // much later, one more try
  assert.equal(autoUpdatePlan({ ...base, tried: { build: 'older', at: NOW - 1000 } }), 'reload'); // a different, newer build is a new decision
});

test('the saved record of the last automatic reload is read defensively', () => {
  assert.deepEqual(parseTried('{"build":"bbb222","at":5}'), { build: 'bbb222', at: 5 });
  for (const bad of [null, '', 'x', '{}', '{"build":1,"at":2}', '{"build":"a","at":"b"}', '[]']) assert.equal(parseTried(bad), null);
});

test('Cloudflare headers: the page, the service worker and the version file are always re-checked; hashed files are cached for good', () => {
  const rules = new Map<string, string[]>();
  let current = '';
  for (const line of fs.readFileSync(path.join(root, 'public/_headers'), 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { current = line.trim(); rules.set(current, []); } else rules.get(current)!.push(line.trim());
  }
  const cc = (p: string) => rules.get(p)?.find(l => l.toLowerCase().startsWith('cache-control'))?.split(':')[1].trim();
  assert.equal(cc('/'), 'no-cache'); // what a Home Screen app opens
  assert.equal(cc('/index.html'), 'no-cache');
  assert.equal(cc('/sw.js'), 'no-cache');
  assert.equal(cc('/manifest.json'), 'no-cache');
  assert.equal(cc('/version.json'), 'no-store');
  assert.match(cc('/assets/*') || '', /max-age=31536000.*immutable/);
});

/* ------------------------------ 2. the service worker, run for real against a fake cache ------------------------------ */

function loadWorker() {
  const caches = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!caches.has(name)) caches.set(name, new Map());
    const m = caches.get(name)!;
    const k = (r: any) => (typeof r === 'string' ? r : r.url);
    return { match: async (r: any) => m.get(k(r))?.clone(), put: async (r: any, res: Response) => void m.set(k(r), res), keys: async () => [...m.keys()].map(url => ({ url })), delete: async (r: any) => m.delete(k(r)), add: async () => {} };
  };
  const listeners: Record<string, ((e: any) => void)[]> = {};
  const self: any = { addEventListener: (t: string, f: any) => (listeners[t] ||= []).push(f), location: { origin: 'https://greatreads.test' }, skipWaiting() {}, clients: { claim: async () => {} } };
  const net: { next: () => Response | Promise<Response> } = { next: () => new Response('net', { status: 200 }) };
  const sandbox: any = { self, caches: { open, keys: async () => [...caches.keys()], delete: async (n: string) => caches.delete(n) }, fetch: async () => net.next(), Response, Headers, Request, URL, setTimeout, clearTimeout, Date, Math, Promise, JSON, Set, Map, console };
  const src = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8').replaceAll('__BUILD_ID__', 'testbuild1').replaceAll('__PRECACHE_LIST__', '[]');
  vm.runInNewContext(src, sandbox);
  const run = async (type: string, e: any) => { const jobs: Promise<any>[] = []; e.waitUntil = (p: Promise<any>) => jobs.push(p); e.respondWith = (p: Promise<any>) => jobs.push(p); (listeners[type] || []).forEach(f => f(e)); return Promise.all(jobs); };
  return { caches, net, run, open };
}

test('the worker reports the build it was made from, so the page can tell a real update from a redeploy', async () => {
  const w = loadWorker();
  const answers: any[] = [];
  await w.run('message', { data: { type: 'GET_BUILD' }, ports: [{ postMessage: (m: any) => answers.push(m) }] });
  assert.equal(JSON.stringify(answers), '[{"build":"testbuild1"}]'); // (compared as text: the worker runs in its own realm)
});

test('activating a new worker removes only the old app-shell caches; book caches (covers, API answers) are kept', async () => {
  const w = loadWorker();
  for (const n of ['rl-shell-oldbuild', 'rl-shell-testbuild1', 'rl-img-v3', 'rl-api-v1', 'rl-font-v1', 'something-else']) await w.open(n);
  await w.run('activate', {});
  assert.deepEqual([...w.caches.keys()].sort(), ['rl-api-v1', 'rl-font-v1', 'rl-img-v3', 'rl-shell-testbuild1']);
});

test('a failed refresh keeps the last good book-API answer: an error answer or no network never replaces it', async () => {
  const w = loadWorker();
  const url = 'https://openlibrary.org/search.json?q=dune';
  const api = await w.open('rl-api-v1');
  const old = new Response('{"good":true}', { status: 200, headers: { 'x-sw-cached-at': String(Date.now() - 13 * 3600_000) } }); // past the 12-hour freshness
  await api.put(url, old);
  const ask = async () => { const [res] = await w.run('fetch', { request: new Request(url) }); return res as Response; };

  w.net.next = () => new Response('slow down', { status: 429 });
  const a = await ask();
  assert.equal(await a.text(), '{"good":true}'); // the saved copy, not the 429
  w.net.next = () => { throw new TypeError('offline'); };
  assert.equal(await (await ask()).text(), '{"good":true}');
  assert.equal(await (await api.match(url))!.text(), '{"good":true}'); // still saved, untouched

  w.net.next = () => new Response('{"good":"newer"}', { status: 200 });
  assert.equal(await (await ask()).text(), '{"good":"newer"}'); // a successful refresh replaces it...
  w.net.next = () => new Response('boom', { status: 500 });
  assert.equal(await (await ask()).text(), '{"good":"newer"}'); // ...and from then on that one is the last good copy
});

test('with nothing saved, an error answer is passed on (so the app can show its own "could not load")', async () => {
  const w = loadWorker();
  w.net.next = () => new Response('nope', { status: 503 });
  const [res] = await w.run('fetch', { request: new Request('https://www.googleapis.com/books/v1/volumes?q=x') });
  assert.equal((res as Response).status, 503);
});

/* ------------------------------ 3. book data: a regenerated bundle replaces stale saved copies ------------------------------ */

const shelf = { id: 'fantasy', emoji: '🐉', title: 'Fantasy', genre: 'Fantasy', seeds: [['A Title', 'An Author'], ['B Title', 'B Author']] } as any;
const rec = (rating: number) => [{ title: 'A Title', coverUrl: 'https://c/a.jpg', ratingAverage: rating, ratingCount: 50, ratingSource: 'apple' }, { title: 'B Title', coverUrl: 'https://c/b.jpg', ratingAverage: rating, ratingCount: 60, ratingSource: 'apple' }];

test('regenerated bundled data changes the shelf signature, so a copy saved from the old bundle is not used for up to a week', () => {
  assert.equal(shelfSig(shelf, rec(4.1)), shelfSig(shelf, rec(4.1)));
  assert.notEqual(shelfSig(shelf, rec(4.1)), shelfSig(shelf, rec(4.3))); // a new rating in the bundle
  assert.notEqual(bundledDataSig('fantasy', rec(4.1)), bundledDataSig('fantasy', [...rec(4.1), null]));
  assert.notEqual(shelfSig(shelf, rec(4.1)), shelfSig({ ...shelf, seeds: [...shelf.seeds, ['C', 'D']] }, rec(4.1))); // an edited pick list still changes it
});

test('a shelf saved by the same bundle is reused; one saved before (older signature format or older data) is ignored', () => {
  const books = shelf.seeds.map(([title, author]: string[]) => ({ id: title, title, author }));
  const key = 'readlife.curated3';
  store.set(key, JSON.stringify({
    fantasy: { t: Date.now(), v: { sig: shelfSig(shelf), books } },
    oldformat: { t: Date.now(), v: { sig: 'A Title|An Author|~B Title|B Author|', books } },
  }));
  // (the cache reads storage at first use, which is here)
  assert.equal(getCachedCurated(shelf)?.length, 2);
  assert.equal(getCachedCurated({ ...shelf, id: 'oldformat' }), null);
});

test('a saved cache entry in a shape this version cannot use is dropped alone; its neighbours and all user data stay', () => {
  const user = JSON.stringify({ books: [{ id: 1, title: 'Mine' }], status: { 1: 'done' }, highlights: ['x'] });
  store.set('readlife.v2', user);
  store.set('readlife.test-shapes', JSON.stringify({ good: { t: Date.now(), v: { n: 1 } }, bad: { t: Date.now(), v: 'old-format-string' }, worse: { t: Date.now(), v: null } }));
  const c = persistentCache<{ n: number }>('readlife.test-shapes', { ttl: 1e9, max: 10, validate: v => !!v && typeof v.n === 'number' });
  assert.deepEqual(c.get('good'), { n: 1 });
  assert.equal(c.get('bad'), undefined);
  assert.equal(c.get('worse'), undefined);
  assert.equal(store.get('readlife.v2'), user);
});

/* ------------------------------ 4. user data is never part of a cache cleanup ------------------------------ */

const USER_OWNED = [
  'readlife.v2', 'readlife.v1', 'readlife.v2.backup', 'readlife.v1.backup', 'readlife.v2.recovery', // the library, reading history, saved books, words, highlights, garden, profile
  'readlife.storeprefs1', // the reader's own shelf order and hidden shelves
  'greatreads_nook_match_theme', 'greatreads_window_follows_time', 'greatreads_clock_theme', 'greatreads_weather_location', 'greatreads_weather_override', // preferences
];

test('no cache cleanup, however it is triggered, can remove anything the reader owns', () => {
  const cleanup = new Set([...clearableCacheKeys(), ...EXTRA_CLEARABLE]); // exactly what the "storage is full" step removes
  for (const key of USER_OWNED) assert.equal(cleanup.has(key), false, key);
  for (const key of cleanup) assert.ok(!USER_OWNED.includes(key), key);
  for (const key of cleanup) assert.match(key, /^readlife\./); // and it is only ever our own cache namespace

  for (const key of USER_OWNED) store.set(key, `{"owner":"${key}"}`);
  store.set('readlife.resolved2', 'old cache'); // a legacy cache: this one IS removed at startup
  dropLegacyBookCaches();
  cleanup.forEach(k => store.delete(k)); // the full storage cleanup
  for (const key of USER_OWNED) assert.equal(store.get(key), `{"owner":"${key}"}`, `${key} survived`);
  assert.equal(store.has('readlife.resolved2'), false);
});

test('the updater\'s own record is a tiny control value in our namespace, not user data', () => {
  const src = fs.readFileSync(path.join(root, 'src/services/appUpdate.ts'), 'utf8');
  assert.ok(src.includes("'readlife.autoUpdate1'"));
  assert.ok(!/localStorage\.(clear|removeItem)/.test(src), 'the updater never clears or removes storage');
  const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
  assert.ok(!/localStorage|indexedDB/.test(sw.replace(/\/\*[\s\S]*?\*\//g, '')), 'the worker never touches app storage');
});
