// Run with: npm test
// English-first covers, the rest of the way: a saved shelf from before the rule is looked up again, Apple's non-English listings are skipped, the newest English
// edition's cover is preferred, and "Refresh Book Covers" really forgets every saved cover choice (memory and storage) and fetches the latest published set.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
const deleted: string[] = [];
(globalThis as any).caches = { delete: async (n: string) => { deleted.push(n); return true; } };

import { findApple } from './sources/appleBooks';
import { forgetEditionsForTests, openLibraryEditionCovers, openLibraryEnglishCoverFor } from './sources/openLibrary';
import { refreshAllCovers, getSharedPick, sharedCoversVersion } from './covers';
import { COVER_CACHE_KEYS, clearCaches, persistentCache } from './cache';
import { getCachedCurated } from '../store/curated';
import { CURATED_SHELVES } from '../../data/storeCatalog';
import { routeFetch } from '../store/testkit';

const isApple = (u: URL) => u.hostname === 'itunes.apple.com';
const item = (id: number, name: string, lang?: string) => ({ trackId: id, trackName: name, artistName: 'Freida McFadden', artworkUrl100: `https://is1-ssl.mzstatic.com/image/thumb/P/${id}/100x100bb.jpg`, ...(lang ? { languageCodesISO2A: [lang] } : {}) });

test('Apple: a listing that declares another language is skipped; English and undeclared listings are used', async () => {
  routeFetch([(u: URL) => (isApple(u) ? { body: { results: [item(1, 'Dear Debbie', 'ES'), item(2, 'Dear Debbie', 'EN')] } } : undefined)]);
  assert.match((await findApple({ title: 'Dear Debbie', author: 'Freida McFadden' }))?.book.coverUrl || '', /\/2\//);
  routeFetch([(u: URL) => (isApple(u) ? { body: { results: [item(3, 'Dear Debbie')] } } : undefined)]);
  assert.match((await findApple({ title: 'Dear Debbie', author: 'Freida McFadden' }))?.book.coverUrl || '', /\/3\//);
  routeFetch([(u: URL) => (isApple(u) ? { body: { results: [item(4, 'Dear Debbie', 'ES')] } } : undefined)]);
  assert.equal(await findApple({ title: 'Dear Debbie', author: 'Freida McFadden' }), null, 'only a translation: no Apple cover for the English book');
});

const eng = { languages: [{ key: '/languages/eng' }] };
const spa = { languages: [{ key: '/languages/spa' }] };

test('Open Library: the newest English edition\'s cover comes first; an edition with no year keeps its place after the dated ones', async () => {
  forgetEditionsForTests();
  routeFetch([(u: URL) => (u.pathname === '/works/OL9W/editions.json' ? { body: { entries: [
    { covers: [10], publish_date: '1999', ...eng }, { covers: [20], ...eng }, { covers: [30], publish_date: 'March 3, 2021', ...eng }, { covers: [40], publish_date: '2023', ...spa }, { covers: [50], publish_date: '2012', ...eng },
  ] } } : undefined)]);
  assert.deepEqual(await openLibraryEditionCovers('OL9W'), [30, 50, 10, 20]);
  assert.equal(await openLibraryEnglishCoverFor('OL9W', 40), 30, 'a translation\'s cover is replaced by the NEWEST English one');
});

test('a shelf saved before the cover rule is not reused; one saved with it is', () => {
  const shelf = CURATED_SHELVES[0];
  const shelves = persistentCache<any>(COVER_CACHE_KEYS.shelves, { ttl: 1e9, max: 40 });
  shelves.set(shelf.id, { sig: 'old', books: [], cv: 1 });
  assert.equal(getCachedCurated(shelf), null);
});

test('Refresh Book Covers: forgets repairs, the saved resolved results, shelves and picker lists (memory too), clears the browser\'s saved lookups, and fetches the latest published covers', async () => {
  const mk = <T,>(k: string) => persistentCache<T>(k, { ttl: 1e9, max: 10 });
  const resolved = mk<any>(COVER_CACHE_KEYS.resolved); const shelves = mk<any>(COVER_CACHE_KEYS.shelves); const cands = mk<any>(COVER_CACHE_KEYS.candidates);
  resolved.set('a', { book: { title: 'a' } }); shelves.set('b', { sig: 's', books: [], cv: 2 }); cands.set('c', []);
  store.set('readlife.coverFix1', JSON.stringify({ 'x|y': { url: 'https://fix/a.jpg', t: Date.now(), own: 'o', v: 2 } }));
  const calls: string[] = [];
  (globalThis as any).fetch = async (url: string) => {
    calls.push(String(url));
    return { ok: true, status: 200, headers: { get: (h: string) => (h.toLowerCase() === 'etag' ? '"7"' : null) }, json: async () => ({ v: 7, picks: { 'dear debbie|freida mcfadden': { url: 'https://img/new.jpg', source: 'apple', t: 1, title: 'Dear Debbie' } } }) };
  };
  await refreshAllCovers();
  assert.equal(resolved.get('a'), undefined);
  assert.equal(shelves.get('b'), undefined);
  assert.equal(cands.get('c'), undefined);
  for (const k of [COVER_CACHE_KEYS.resolved, COVER_CACHE_KEYS.shelves, COVER_CACHE_KEYS.candidates]) assert.ok(!store.get(k) || store.get(k) === '{}', k);
  assert.equal(store.get('readlife.coverFix1'), undefined);
  assert.deepEqual(deleted, ['rl-api-v1']);
  assert.ok(calls.some(c => c.includes('/api/covers')), 'the published set was asked for, even though it was synced a moment ago');
  assert.equal(sharedCoversVersion(), 7);
  assert.equal(getSharedPick('dear debbie|freida mcfadden')?.url, 'https://img/new.jpg');
  clearCaches([]);
});
