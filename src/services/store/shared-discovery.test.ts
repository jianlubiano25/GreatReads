import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateBooks, readShared, resetSharedDiscoveryForTests, slimBooks, writeShared, type SharedDeps } from './sharedDiscovery';
import type { Book } from '../../types';

const book = (title: string, over: Partial<Book> = {}): Book => ({ id: title, title, author: 'A', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2020', genre: 'Fantasy', summary: 'long text from Google', authorBio: '', pageCount: 300, coverUrl: 'https://covers.openlibrary.org/b/id/1-M.jpg', ...over } as Book);

const fake = (admin: boolean, handler: (path: string, init?: any) => any) => {
  const calls: { path: string; init?: any }[] = [];
  let t = 1_000_000;
  const deps: SharedDeps = { rest: (async (path: string, init?: any) => { calls.push({ path, init }); return handler(path, init); }) as any, isAdmin: () => admin, now: () => t };
  return { deps, calls, advance: (ms: number) => { t += ms; } };
};

test('the slim list keeps public book facts only: no Google rating, cover, volume id, summary or reader data', () => {
  const [s] = slimBooks([book('Dune', { ratingAverage: 4.5, ratingCount: 900, ratingSource: 'google', coverUrl: 'https://books.google.com/x.jpg', identity: { olWork: 'OL1W', gbVolume: 'vol1', isbn13: '9780000000002' } })]);
  assert.equal(s.ra, undefined); assert.equal(s.c, undefined);
  assert.deepEqual(s.id, { olWork: 'OL1W', isbn13: '9780000000002' });
  assert.equal(JSON.stringify(s).includes('Google'), false);
  assert.equal(JSON.stringify(s).includes('long text'), false);
  const [o] = slimBooks([book('Dune', { ratingAverage: 4.5, ratingCount: 900, ratingSource: 'openlibrary' })]);
  assert.deepEqual([o.ra, o.rc, o.rs], [4.5, 900, 'openlibrary']);
  assert.equal(hydrateBooks([o])[0].ratingAverage, 4.5);
});

test('Open Library hits (no ratingSource, only source + ol_ id) keep their rating in the shared list: Hidden Gems needs it', () => {
  const ol = book('Gem', { id: 'ol__works_OL9W', source: 'openlibrary', ratingAverage: 4.4, ratingCount: 250 });
  const [s] = slimBooks([ol]);
  assert.deepEqual([s.ra, s.rc, s.rs], [4.4, 250, 'openlibrary']);
  const [h] = hydrateBooks([s]);
  assert.deepEqual([h.ratingAverage, h.ratingCount, h.ratingSource], [4.4, 250, 'openlibrary']);
  const [g] = slimBooks([book('G', { id: 'gb1', source: 'google', ratingAverage: 4.4, ratingCount: 250 })]);
  assert.equal(g.ra, undefined, 'Google ratings are still never shared');
});

test('shared rows are versioned: a row of the old shape (key without v2|) is never read or replaced', async () => {
  resetSharedDiscoveryForTests();
  const ok = fake(true, p => (p.includes('select=item_count') ? { ok: true, data: [] } : { ok: true, data: [{ payload: slimBooks([book('A'), book('B'), book('C')]) }] }));
  await readShared('genre_pool', 'fantasy', ok.deps);
  assert.match(ok.calls[0].path, /cache_key=eq\.v2%7Cfantasy/);
  await writeShared('genre_pool', 'fantasy', [book('A'), book('B'), book('C')], ok.deps);
  assert.equal(ok.calls.find(c => c.init?.method === 'POST')!.init.body.cache_key, 'v2|fantasy');
});

test('read: a live row becomes books; a missing table is noticed once and not asked again for a while', async () => {
  resetSharedDiscoveryForTests();
  const rows = [book('A'), book('B'), book('C')];
  const ok = fake(false, () => ({ ok: true, data: [{ payload: slimBooks(rows) }] }));
  const got = await readShared('genre_pool', 'fantasy', ok.deps);
  assert.deepEqual(got?.map(b => b.title), ['A', 'B', 'C']);
  assert.match(ok.calls[0].path, /^discovery_cache\?kind=eq\.genre_pool&cache_key=eq\.v2%7Cfantasy/);

  const missing = fake(false, () => ({ ok: false, status: 404, error: 'relation does not exist' }));
  assert.equal(await readShared('genre_pool', 'x', missing.deps), null);
  assert.equal(await readShared('genre_pool', 'y', missing.deps), null);
  assert.equal(missing.calls.length, 1, 'asked once, then quiet');
  missing.advance(11 * 60 * 1000);
  await readShared('genre_pool', 'z', missing.deps);
  assert.equal(missing.calls.length, 2, 'asked again after 10 minutes');
  resetSharedDiscoveryForTests();
  const thin = fake(false, () => ({ ok: true, data: [{ payload: slimBooks([book('A')]) }] }));
  assert.equal(await readShared('genre_pool', 'thin', thin.deps), null, 'a thin row is not used');
});

test('write: admin devices only, never empty or thin, never a much thinner list over a fuller one', async () => {
  resetSharedDiscoveryForTests();
  const many = Array.from({ length: 20 }, (_, i) => book('B' + i));
  const notAdmin = fake(false, () => ({ ok: true, data: [] }));
  assert.equal(await writeShared('genre_pool', 'k', many, notAdmin.deps), false);
  assert.equal(notAdmin.calls.length, 0, 'a reader\'s device never writes');

  const admin = fake(true, p => (p.includes('select=item_count') ? { ok: true, data: [] } : { ok: true, data: null }));
  assert.equal(await writeShared('genre_pool', 'k', [book('only'), book('two')], admin.deps), false, 'thin: not written');
  assert.equal(admin.calls.length, 0);
  assert.equal(await writeShared('genre_pool', 'k', many, admin.deps), true);
  const post = admin.calls.find(c => c.init?.method === 'POST')!;
  assert.equal(post.init.body.kind, 'genre_pool');
  assert.equal(post.init.body.payload.length, 20);
  assert.ok(Date.parse(post.init.body.expires_at) - Date.parse(post.init.body.fetched_at) === 24 * 3600 * 1000, 'expires after a day');

  const fuller = fake(true, p => (p.includes('select=item_count') ? { ok: true, data: [{ item_count: 40 }] } : { ok: true, data: null }));
  assert.equal(await writeShared('genre_pool', 'k', many.slice(0, 15), fuller.deps), false, '15 over 40 is much thinner');
  assert.equal(fuller.calls.some(c => c.init?.method === 'POST'), false);
});

test('the migration and its rollback exist, say when they were applied, and stop empty/thin rows and non-admin writes', async () => {
  const { readFileSync } = await import('node:fs');
  const up = readFileSync(new URL('../../../supabase/migrations/20261101000001_discovery_cache.sql', import.meta.url), 'utf8');
  const down = readFileSync(new URL('../../../supabase/rollbacks/20261101000001_discovery_cache.rollback.sql', import.meta.url), 'utf8');
  assert.match(up, /APPLIED to production 2026-11-01/);
  assert.match(up, /jsonb_array_length\(payload\) >= 3/);
  assert.match(up, /catalog_admins/);
  assert.match(up, /expires_at > now\(\)/);
  assert.match(down, /drop table if exists public\.discovery_cache/);
});
