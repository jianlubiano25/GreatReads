// Run with: npm test
// The Google Books proxy (functions/api/google-books.js) and the client that calls it:
//  - the function validates input, keeps the key server-side, maps Google's failures to small JSON errors, and only ever marks a 2xx as cacheable
//  - in the browser the app calls /api/google-books (same origin, NO key); Node (prefetch, scripts, tests) still calls Google directly with the env key
// Manual check after deploying: open /api/google-books?q=intitle:%22Dune%22&maxResults=2 on the site (503 "not_configured" = the secret is not set for that environment).
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

// @ts-ignore plain JS module with no type declarations
import { onRequestGet, onRequest } from '../../../functions/api/google-books.js';
import { findGoogleRating, googleVolume, searchGoogle, setGoogleModeForTests, resetGoogleKeyForTests } from './sources/googleBooks';
import { perfSnapshot } from './perf';
import { routeFetch } from '../store/testkit';

const KEY = 'AIzaSyFAKE-SECRET-KEY-for-tests';
const call = (qs: string, env: any = { GOOGLE_BOOKS_API_KEY: KEY }) => onRequestGet({ request: new Request(`https://x.test/api/google-books?${qs}`), env });

/** A scripted upstream: records every Google request (with the init it was sent with) and answers as told. */
function upstream(status: number, body: unknown = { items: [] }) {
  const seen: { url: URL; init: any }[] = [];
  (globalThis as any).fetch = async (input: any, init: any) => {
    seen.push({ url: new URL(String(input)), init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return seen;
}
const dune = encodeURIComponent('intitle:"Dune"');

test('function: a search is forwarded to Google with the key added server-side, maxResults capped at 40, and the app\'s own parameters kept', async () => {
  const seen = upstream(200, { items: [{ id: 'a' }] });
  const r = await call(`q=${dune}&maxResults=500&startIndex=20&langRestrict=en&printType=books&fields=${encodeURIComponent('totalItems,items(id,volumeInfo(title))')}`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { items: [{ id: 'a' }] });
  assert.equal(seen.length, 1);
  const u = seen[0].url;
  assert.equal(`${u.origin}${u.pathname}`, 'https://www.googleapis.com/books/v1/volumes');
  assert.deepEqual([u.searchParams.get('q'), u.searchParams.get('maxResults'), u.searchParams.get('startIndex'), u.searchParams.get('langRestrict'), u.searchParams.get('printType')], ['intitle:"Dune"', '40', '20', 'en', 'books']);
  assert.equal(u.searchParams.get('fields'), 'totalItems,items(id,volumeInfo(title))');
  assert.equal(u.searchParams.get('key'), KEY);
  assert.ok(!(await (await call(`q=x`)).text()).includes(KEY), 'the key is never in a response');
  assert.match(r.headers.get('cache-control') || '', /public, max-age=\d+/);
});

test('function: a volume lookup goes to /volumes/<id>', async () => {
  const seen = upstream(200, { id: 'B1hSG45JCX4C' });
  const r = await call('volumeId=B1hSG45JCX4C&fields=id,volumeInfo(title)');
  assert.equal(r.status, 200);
  assert.equal(seen[0].url.pathname, '/books/v1/volumes/B1hSG45JCX4C');
  assert.equal(seen[0].url.searchParams.get('key'), KEY);
});

test('function: the edge caches only 2xx answers; errors are never cached', async () => {
  const seen = upstream(200);
  await call(`q=${dune}`);
  const cf = seen[0].init.cf;
  assert.equal(cf.cacheEverything, true);
  assert.ok(cf.cacheTtlByStatus['200-299'] > 0);
  assert.ok(cf.cacheTtlByStatus['400-599'] < 0, 'errors are not cached at the edge');
  for (const status of [429, 403, 500, 503]) {
    upstream(status, { error: { code: status, message: `secret detail ${KEY}`, errors: [{ reason: 'whatever' }] } });
    const r = await call(`q=${dune}`);
    assert.equal(r.headers.get('cache-control'), 'no-store', `HTTP ${status} is not cacheable`);
    assert.ok(r.status === 429 || r.status === 502);
  }
});

test('function: bad input is a 400 and never reaches Google', async () => {
  const seen = upstream(200);
  for (const qs of [
    '', // neither q nor volumeId
    `q=${dune}&volumeId=abc123`, // both
    'q=', 'q=%20%20', // empty
    `q=${'x'.repeat(301)}`, // too long
    'q=bad%0Aquery', // control character
    'volumeId=../../etc/passwd', 'volumeId=a%20b', 'volumeId=ab', // bad ids
    `q=${dune}&maxResults=abc`, `q=${dune}&maxResults=-3`, `q=${dune}&startIndex=1.5`, // bad numbers
    `q=${dune}&fields=${encodeURIComponent('id&key=other')}`, // fields cannot smuggle a parameter
    `q=${dune}&langRestrict=english-please`, `q=${dune}&printType=everything`,
  ]) {
    const r = await call(qs);
    assert.equal(r.status, 400, qs);
    assert.equal((await r.json()).error, 'bad_request', qs);
  }
  assert.equal(seen.length, 0);
});

test('function: a key sent by the client is never forwarded', async () => {
  const seen = upstream(200);
  await call(`q=${dune}&key=CLIENT-KEY&other=1`);
  assert.deepEqual([...seen[0].url.searchParams.keys()].sort(), ['key', 'maxResults', 'q']);
  assert.equal(seen[0].url.searchParams.get('key'), KEY);
});

test('function: secret missing -> 503 not_configured, and Google is not called', async () => {
  const seen = upstream(200);
  const r = await call(`q=${dune}`, {});
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'not_configured' });
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(seen.length, 0);
  assert.equal((await call(`q=${dune}`, { VITE_GOOGLE_BOOKS_API_KEY: KEY })).status, 503, 'a VITE_ variable is not the secret');
});

test('function: Google 429 (or a 403 quota reason) -> 429 rate_limited; other failures -> 502 without Google\'s body or the key', async () => {
  upstream(429, { error: { message: `quota ${KEY}` } });
  let r = await call(`q=${dune}`);
  assert.equal(r.status, 429);
  assert.deepEqual(await r.json(), { error: 'rate_limited', upstream: 429 });

  upstream(403, { error: { message: 'Quota exceeded', errors: [{ reason: 'rateLimitExceeded' }] } });
  assert.equal((await call(`q=${dune}`)).status, 429);

  upstream(403, { error: { message: `Requests from referer <empty> are blocked. key=${KEY}`, errors: [{ reason: 'ipRefererBlocked' }] } });
  r = await call(`q=${dune}`);
  const text = await r.text();
  assert.equal(r.status, 502);
  assert.deepEqual(JSON.parse(text), { error: 'upstream_error', upstream: 403, reason: 'ipRefererBlocked' }); // a short reason code helps find a setup mistake
  assert.ok(!text.includes(KEY) && !text.includes('blocked'), 'neither the key nor Google\'s message is passed on');

  upstream(500, 'not json at all');
  r = await call(`q=${dune}`);
  assert.deepEqual(await r.json(), { error: 'upstream_error', upstream: 500 });

  (globalThis as any).fetch = async () => { throw new TypeError(`network down for ${KEY}`); };
  r = await call(`q=${dune}`);
  assert.equal(r.status, 502);
  assert.ok(!(await r.text()).includes(KEY));
});

test('function: only GET is allowed', async () => {
  const r = onRequest();
  assert.equal(r.status, 405);
  assert.equal(r.headers.get('allow'), 'GET');
});

// ---------------------------------------------------------------- the client

const gbItem = (id: string, title: string, author: string, extra: any = {}) => ({ id, volumeInfo: { title, authors: [author], publishedDate: '1965', pageCount: 412, ...extra } });
const isProxy = (u: URL) => u.pathname === '/api/google-books';

test('client (browser mode): searches and volume lookups call /api/google-books with the same parameters, and carry no key', async () => {
  resetGoogleKeyForTests();
  setGoogleModeForTests('proxy');
  (globalThis as any).process.env.VITE_GOOGLE_BOOKS_API_KEY = 'SHOULD-NOT-BE-USED';
  (globalThis as any).process.env.GOOGLE_BOOKS_API_KEY = 'SHOULD-NOT-BE-USED-EITHER';
  try {
    const calls = routeFetch([u => (isProxy(u) ? { body: { totalItems: 1, items: [gbItem('d2', 'Dune', 'Frank Herbert', { averageRating: 4.5, ratingsCount: 120 })] } } : undefined)]);
    const hits = await searchGoogle('intitle:"Dune"', 2);
    assert.equal(hits.length, 1);
    await googleVolume('B1hSG45JCX4C');
    assert.equal(calls.length, 2);
    for (const c of calls) {
      assert.ok(c.startsWith('/api/google-books?'), c); // same origin, relative
      assert.ok(!c.includes('googleapis.com') && !c.includes('key=') && !c.includes('SHOULD-NOT'), c);
    }
    const search = new URL(calls[0], 'https://x.test').searchParams;
    assert.deepEqual([search.get('q'), search.get('maxResults'), search.get('langRestrict'), search.get('printType')], ['intitle:"Dune"', '2', 'en', 'books']);
    assert.match(search.get('fields') || '', /^totalItems,items\(id,volumeInfo\(/);
    assert.equal(new URL(calls[1], 'https://x.test').searchParams.get('volumeId'), 'B1hSG45JCX4C');
  } finally {
    delete (globalThis as any).process.env.VITE_GOOGLE_BOOKS_API_KEY;
    delete (globalThis as any).process.env.GOOGLE_BOOKS_API_KEY;
    setGoogleModeForTests(null);
  }
});

test('client (browser mode): findGoogleRating keeps its rating pair rules through the proxy', async () => {
  resetGoogleKeyForTests();
  setGoogleModeForTests('proxy');
  try {
    routeFetch([u => (isProxy(u) ? { body: { items: [
      gbItem('o1', 'Dune Messiah', 'Frank Herbert', { averageRating: 3.0, ratingsCount: 9999 }), // another book
      gbItem('d1', 'Dune', 'Frank Herbert', { averageRating: 4.9 }), // an average with no count is not a rating
      gbItem('d2', 'Dune', 'Frank Herbert', { averageRating: 4.5, ratingsCount: 120 }),
    ] } } : undefined)]);
    const r = await findGoogleRating({ title: 'Dune', author: 'Frank Herbert' });
    assert.deepEqual([r.hit?.book.ratingAverage, r.hit?.book.ratingCount, r.hit?.book.identity?.gbVolume, r.failed], [4.5, 120, 'd2', false]);
  } finally {
    setGoogleModeForTests(null);
  }
});

test('client (browser mode): a missing server secret is noticed once, counted, and not retried for every book; it is never remembered as "no rating"', async () => {
  resetGoogleKeyForTests();
  setGoogleModeForTests('proxy');
  const warn = (console as any).warn;
  (console as any).warn = () => {};
  try {
    const calls = routeFetch([u => (isProxy(u) ? { status: 503, body: { error: 'not_configured' } } : undefined)]);
    const first = await findGoogleRating({ title: 'Secret Alpha', author: 'Jo Author' });
    assert.deepEqual([first.hit, first.failed], [null, true]);
    const after = calls.length;
    assert.ok(after >= 1);
    const second = await findGoogleRating({ title: 'Secret Beta', author: 'Jo Author' });
    assert.deepEqual([second.hit, second.failed], [null, true]);
    assert.equal(calls.length, after, 'no further requests once the proxy said it is not configured');
    assert.ok((perfSnapshot().counters['google.proxyNotConfigured'] || 0) >= 1);
  } finally {
    (console as any).warn = warn;
    setGoogleModeForTests(null);
  }
});

test('client (browser mode): a rate limit from the proxy stops the remaining searches for that book and is reported as a failure', async () => {
  resetGoogleKeyForTests();
  setGoogleModeForTests('proxy');
  try {
    const calls = routeFetch([u => (isProxy(u) ? { status: 429, body: { error: 'rate_limited' } } : undefined)]);
    const r = await findGoogleRating({ title: 'Limited Alpha', author: 'Jo Author' });
    assert.deepEqual([r.hit, r.failed], [null, true]);
    assert.ok(calls.length <= 2, `at most one request and its single retry (${calls.length})`);
  } finally {
    setGoogleModeForTests(null);
  }
});

test('client (Node: prefetch, check scripts, tests): still calls Google directly with the environment key', async () => {
  resetGoogleKeyForTests();
  setGoogleModeForTests(null);
  (globalThis as any).process.env.GOOGLE_BOOKS_API_KEY = 'ENV-KEY-1';
  try {
    const calls = routeFetch([u => (u.hostname === 'www.googleapis.com' ? { body: { items: [] } } : undefined)]);
    await searchGoogle('intitle:"Dune"', 2);
    assert.equal(new URL(calls[0]).hostname, 'www.googleapis.com');
    assert.equal(new URL(calls[0]).searchParams.get('key'), 'ENV-KEY-1');
    delete (globalThis as any).process.env.GOOGLE_BOOKS_API_KEY;
    (globalThis as any).process.env.VITE_GOOGLE_BOOKS_API_KEY = 'ENV-KEY-2';
    const again = routeFetch([u => (u.hostname === 'www.googleapis.com' ? { body: { items: [] } } : undefined)]);
    await googleVolume('abc123');
    assert.equal(new URL(again[0]).searchParams.get('key'), 'ENV-KEY-2', 'VITE_GOOGLE_BOOKS_API_KEY still works for local scripts');
  } finally {
    delete (globalThis as any).process.env.GOOGLE_BOOKS_API_KEY;
    delete (globalThis as any).process.env.VITE_GOOGLE_BOOKS_API_KEY;
    resetGoogleKeyForTests();
  }
});
