// Tests the shared cover store (functions/api/covers.js): anyone reads, only the owner's token writes, and bad data never gets in.
import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS module with no type declarations
import { onRequestGet, onRequestPut, cleanPicks } from '../../../functions/api/covers.js';

const TOKEN = 'a-long-secret-token-1234';
const kv = (initial?: unknown) => {
  let value: unknown = initial;
  return { puts: [] as string[], get: async () => value, put: async function (this: any, _k: string, v: string) { this.puts.push(v); value = JSON.parse(v); } };
};
const get = (env: any, headers: Record<string, string> = {}) => onRequestGet({ request: new Request('https://x.test/api/covers', { headers }), env });
const put = (env: any, body: unknown, auth: string | null = `Bearer ${TOKEN}`) =>
  onRequestPut({ request: new Request('https://x.test/api/covers', { method: 'PUT', headers: auth ? { authorization: auth } : {}, body: typeof body === 'string' ? body : JSON.stringify(body) }), env });
const good = { 'a book|an author': { url: 'https://covers.openlibrary.org/b/id/1-L.jpg', source: 'openlibrary', t: 5, title: 'A Book', author: 'An Author' } };

test('not set up: reading gives an empty set (the app works as before), writing says 503', async () => {
  const r = await get({});
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { v: 0, picks: {} });
  assert.equal((await put({}, { picks: good })).status, 503);
  assert.equal((await put({ COVERS: kv() }, { picks: good })).status, 503, 'no token set');
  assert.equal((await put({ COVERS: kv(), COVER_ADMIN_TOKEN: 'short' }, { picks: good }, 'Bearer short')).status, 503, 'a weak token is refused');
});

test('reading: the stored set with an ETag and a short cache; the same ETag gets a 304', async () => {
  const env = { COVERS: kv({ v: 12, picks: good }) };
  const r = await get(env);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('etag'), '"12"');
  assert.match(r.headers.get('cache-control') || '', /max-age=60/);
  assert.deepEqual((await r.json()).picks, good);
  const again = await get(env, { 'if-none-match': '"12"' });
  assert.equal(again.status, 304);
  assert.equal((await get(env, { 'if-none-match': '"11"' })).status, 200);
});

test('writing: no token or a wrong one is refused and nothing is stored', async () => {
  const store = kv();
  const env = { COVERS: store, COVER_ADMIN_TOKEN: TOKEN };
  for (const auth of [null, 'Bearer nope', `Bearer ${TOKEN}x`, TOKEN.slice(0, -1), 'Basic abc']) assert.equal((await put(env, { picks: good }, auth as any)).status, 401);
  assert.equal(store.puts.length, 0);
});

test('writing: the owner\'s set is stored, the version only goes up, and the answer is the stored set', async () => {
  const store = kv({ v: Date.now() + 10_000_000, picks: {} });
  const env = { COVERS: store, COVER_ADMIN_TOKEN: TOKEN };
  const before = (await store.get() as any).v;
  const r = await put(env, { picks: good });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.v, before + 1);
  assert.deepEqual(body.picks, good);
  assert.equal(body.dropped, 0);
  assert.deepEqual(((await get(env)).json as any) && (await (await get(env)).json()).picks, good);
});

test('writing: bad entries are dropped, odd text is trimmed, and nonsense bodies are refused', async () => {
  const env = { COVERS: kv(), COVER_ADMIN_TOKEN: TOKEN };
  const body = await (await put(env, { picks: { ...good, nothttps: { url: 'http://x/y.jpg' }, js: { url: 'javascript:alert(1)' }, space: { url: 'https://x/a b.jpg' }, '': { url: 'https://x/y.jpg' }, odd: { url: 'https://x/z.jpg', source: 'weird', title: `  ${'t'.repeat(500)} ` } } })).json();
  assert.deepEqual(Object.keys(body.picks).sort(), ['a book|an author', 'odd']);
  assert.equal(body.dropped, 4);
  assert.equal(body.picks.odd.source, 'link');
  assert.equal(body.picks.odd.title.length, 200);
  assert.equal((await put(env, 'not json')).status, 400);
  assert.equal((await put(env, { picks: 'x' })).status, 400);
  assert.equal((await put(env, { nothing: 1 })).status, 400);
  assert.equal((await put(env, 'x'.repeat(400_001))).status, 413);
});

test('writing: at most 600 covers are kept', () => {
  const many = Object.fromEntries(Array.from({ length: 650 }, (_, i) => [`k${i}`, { url: `https://x/${i}.jpg` }]));
  const { picks, dropped } = cleanPicks(many);
  assert.equal(Object.keys(picks).length, 600);
  assert.equal(dropped, 50);
});

test('writing: a store that fails says so (503) instead of pretending it saved', async () => {
  const broken = { get: async () => ({ v: 1, picks: {} }), put: async () => { throw new Error('kv down'); } };
  assert.equal((await put({ COVERS: broken, COVER_ADMIN_TOKEN: TOKEN }, { picks: good })).status, 503);
});
