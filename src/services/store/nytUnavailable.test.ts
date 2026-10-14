// Run with: npm test
// An NYT list name the NYT does not publish (the Paperback Non-Fiction 404): told apart from a routing / upstream fault, hidden alone, never retried every load.
import test from 'node:test';
import assert from 'node:assert/strict';
const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };

// @ts-ignore plain JS module with no type declarations
import { onRequestGet as nyt } from '../../../functions/api/nyt.js';
import { classifyNytFailure, loadNytList, lastNytFailure, forgetNytList } from '../books/sources/nyt';
import { NYT_EXTRA_SHELVES, NYT_SHELVES } from './lists';
import { checkNytLists } from './nytListNames';
import { routeFetch, nytList } from './testkit';

const call = (list: string, env: Record<string, string> = { NYT_API_KEY: 'SECRETKEY' }) => (nyt as any)({ request: new Request(`https://greatreads.pages.dev/api/nyt?list=${list}`), env });
const NAMES = { results: [{ list_name_encoded: 'hardcover-nonfiction', display_name: 'Hardcover Nonfiction', list_name: 'Hardcover Nonfiction' }, { list_name_encoded: 'trade-fiction-paperback', display_name: 'Paperback Trade Fiction' }, { list_name_encoded: 'combined-print-and-e-book-nonfiction' }] };

function upstream(handler: (url: string) => { status: number; body: unknown } | 'throw') {
  const seen: string[] = [];
  (globalThis as any).fetch = async (url: string) => {
    seen.push(String(url));
    const r = handler(String(url));
    if (r === 'throw') throw new Error('boom');
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  };
  return seen;
}

test('function: a list the NYT does not publish is reported as list_not_found (404), with the names that ARE published; the key never leaks', async () => {
  const seen = upstream(u => (u.includes('/lists/names.json') ? { status: 200, body: NAMES } : { status: 404, body: { fault: 'x' } }));
  const res = await call('paperback-nonfiction');
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const text = await res.text();
  assert.ok(!text.includes('SECRETKEY'));
  const body = JSON.parse(text);
  assert.deepEqual([body.error, body.upstream, body.published], ['list_not_found', 404, false]);
  assert.ok(body.suggestions.includes('hardcover-nonfiction'));
  assert.ok(seen.some(u => u.includes('/lists/names.json')));
});

test('function: a 404 for a list the NYT DOES publish is an upstream fault, not a missing list', async () => {
  upstream(u => (u.includes('/lists/names.json') ? { status: 200, body: NAMES } : { status: 404, body: {} }));
  const res = await call('hardcover-nonfiction');
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: 'upstream_error', upstream: 404, published: true });
  // names.json unreadable: it cannot be classified, so it is reported as an upstream error, never as a missing list
  upstream(u => (u.includes('/lists/names.json') ? 'throw' : { status: 404, body: {} }));
  const res2 = await call('paperback-nonfiction');
  assert.equal(res2.status, 502);
  assert.equal((await res2.json()).published, null);
});

test('function: a working list is untouched (no names.json request, cached success)', async () => {
  const seen = upstream(() => ({ status: 200, body: { results: { books: [{ rank: 1 }] } } }));
  const res = await call('combined-print-and-e-book-fiction');
  assert.equal(res.status, 200);
  assert.equal(seen.length, 1);
  assert.match(res.headers.get('cache-control') || '', /max-age=3600/);
});

test('client: list_not_found, and the older { upstream_error, upstream: 404 } answer, both mean "this list is unavailable"; other failures keep their meaning', () => {
  assert.equal(classifyNytFailure({ status: 404, body: { error: 'list_not_found', published: false } }), 'list_unavailable');
  assert.equal(classifyNytFailure({ status: 502, body: { error: 'upstream_error', upstream: 404 } }), 'list_unavailable');
  assert.equal(classifyNytFailure({ status: 502, body: { error: 'upstream_error', upstream: 404, published: true } }), 'upstream_error');
  assert.equal(classifyNytFailure({ status: 502, body: { error: 'upstream_error', upstream: 500 } }), 'upstream_error');
  assert.equal(classifyNytFailure({ status: 404, failure: 'http' }), 'no_function'); // no JSON body at all: the function is not deployed
  assert.equal(classifyNytFailure({ status: 200, failure: 'not-json' }), 'no_function');
  assert.equal(classifyNytFailure({ status: 401 }), 'unauthorized');
  assert.equal(classifyNytFailure({ status: 429 }), 'rate_limited');
  assert.equal(classifyNytFailure({ status: 503, body: { error: 'not_configured' } }), 'not_configured');
});

test('shelf behaviour: only the unavailable shelf fails, it is not asked again, and the working shelves keep loading', async () => {
  const gone = 'paperback-nonfiction-t1';
  const calls = routeFetch([
    u => (u.pathname === '/api/nyt' && u.searchParams.get('list') === gone ? { status: 404, body: { error: 'list_not_found', upstream: 404, published: false, suggestions: [] } } : undefined),
    u => (u.pathname === '/api/nyt' ? { body: nytList([['Fine Book', 'Ann Author', '9780000000001']]) } : undefined),
  ]);
  const r = await loadNytList(gone);
  assert.deepEqual([r.entries, r.failure], [null, 'list_unavailable']);
  assert.equal(lastNytFailure(gone), 'list_unavailable');
  const asked = calls.length;
  const again = await loadNytList(gone);
  assert.equal(again.failure, 'list_unavailable');
  assert.equal(calls.length, asked, 'a list the NYT does not publish is not requested again on every load');

  const ok = await loadNytList('combined-print-and-e-book-nonfiction-t1');
  assert.equal(ok.entries?.length, 1);
  assert.equal(lastNytFailure('combined-print-and-e-book-nonfiction-t1'), undefined);
  forgetNytList('combined-print-and-e-book-nonfiction-t1');
});

test('check:nyt matches the Store lists against names.json, finds the Paperback Non-Fiction problem and suggests what the NYT does publish', () => {
  const wanted = [...NYT_SHELVES, ...NYT_EXTRA_SHELVES].map(s => ({ id: s.id, list: s.list }));
  const r = checkNytLists([{ list_name_encoded: 'combined-print-and-e-book-fiction' }, { list_name_encoded: 'combined-print-and-e-book-nonfiction' }, { list_name_encoded: 'nonfiction-paperback-new', display_name: 'Paperback Nonfiction' }], wanted);
  const pb = r.missing.find(m => m.id === 'nyt-paperback-nonfiction');
  assert.ok(pb, 'a name the NYT does not publish is reported');
  assert.ok(pb!.suggestions.includes('nonfiction-paperback-new'), 'with a published name that looks like it');
  assert.ok(r.found.some(f => f.id === 'nyt-fiction') && r.found.some(f => f.id === 'nyt-nonfiction'), 'working shelves are untouched');
});
