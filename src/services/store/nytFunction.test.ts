// Tests the Cloudflare Pages Function that proxies the NYT API (functions/api/nyt.js) with a scripted upstream.
import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS module with no type declarations
import { onRequestGet as nyt } from '../../../functions/api/nyt.js';
// @ts-ignore plain JS module with no type declarations
import { onRequestGet as charts } from '../../../functions/api/apple-charts.js';

const call = (fn: any, path: string, env: Record<string, string> = {}) => fn({ request: new Request(`https://greatreads.pages.dev${path}`), env });

function upstream(status: number, body: unknown = { results: { books: [] } }) {
  const seen: { url: string; init: any }[] = [];
  (globalThis as any).fetch = async (url: string, init: any) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return seen;
}

test('NYT function: without the key it says so (503) and the answer is never cached', async () => {
  const res = await call(nyt, '/api/nyt?list=combined-print-and-e-book-fiction');
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'not_configured' });
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('NYT function: rejects a bad list name before calling the NYT, and never puts the key in a response', async () => {
  const seen = upstream(200);
  const res = await call(nyt, '/api/nyt?list=../../etc', { NYT_API_KEY: 'SECRETKEY' });
  assert.equal(res.status, 400);
  assert.equal(seen.length, 0);
  assert.ok(!(await res.text()).includes('SECRETKEY'));
});

test('NYT function: a successful answer is passed through and cached; the key goes only to the NYT', async () => {
  const seen = upstream(200, { results: { books: [{ rank: 1 }] } });
  const res = await call(nyt, '/api/nyt?list=combined-print-and-e-book-fiction', { NYT_API_KEY: 'SECRETKEY' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') || '', /max-age=1800/);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].url.startsWith('https://api.nytimes.com/svc/books/v3/lists/current/combined-print-and-e-book-fiction.json?api-key=SECRETKEY'));
  assert.deepEqual(seen[0].init.cf.cacheTtlByStatus, { '200-299': 3600, '400-599': -1 }); // errors are never cached at the edge
  assert.ok(!(await res.text()).includes('SECRETKEY'));
});

test('NYT function: upstream errors are reported precisely and are not cacheable', async () => {
  for (const [status, error, code] of [[401, 'unauthorized', 502], [403, 'unauthorized', 502], [429, 'rate_limited', 429], [500, 'upstream_error', 502]] as const) {
    upstream(status, { fault: 'x' });
    const res = await call(nyt, '/api/nyt?list=combined-print-and-e-book-nonfiction', { NYT_API_KEY: 'k' });
    assert.equal(res.status, code, `status ${status}`);
    assert.equal((await res.json()).error, error);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  (globalThis as any).fetch = async () => { throw new Error('boom'); };
  const res = await call(nyt, '/api/nyt?list=combined-print-and-e-book-fiction', { NYT_API_KEY: 'k' });
  assert.equal(res.status, 502);
});

test('Apple charts function: only top-free / top-paid, success cached, errors not', async () => {
  const seen = upstream(200, { feed: { results: [] } });
  const ok = await call(charts, '/api/apple-charts?feed=top-paid&limit=500');
  assert.equal(ok.status, 200);
  assert.ok(seen[0].url.endsWith('/books/top-paid/100/books.json')); // limit is capped
  const odd = await call(charts, '/api/apple-charts?feed=../../x');
  assert.ok(seen[1].url.includes('/books/top-free/')); // anything else becomes the default chart, never a free-form path
  assert.equal(odd.status, 200);
  upstream(500);
  const bad = await call(charts, '/api/apple-charts?feed=top-free');
  assert.equal(bad.status, 502);
  assert.equal(bad.headers.get('cache-control'), 'no-store');
});
