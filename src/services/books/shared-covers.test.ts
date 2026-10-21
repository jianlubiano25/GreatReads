// Run with: npm test
// Covers published for everyone: how the app reads them (rarely, cheaply, never blocking), who wins when, and the owner's hidden tools and publish rules.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

const APPLE = 'https://is1-ssl.mzstatic.com/image/thumb/P/v4/ab/art/600x900bb.jpg';
const OL = 'https://covers.openlibrary.org/b/id/9-L.jpg';
const book = { title: 'Shared One', author: 'Ann Author' };
const KEY = 'shared one|ann author';

type Call = { url: string; init: any };
function server(handler: (c: Call) => { status?: number; body?: unknown; etag?: string } | 'throw') {
  const calls: Call[] = [];
  (globalThis as any).fetch = async (url: string, init: any = {}) => {
    const c = { url: String(url), init };
    calls.push(c);
    const r = handler(c);
    if (r === 'throw') throw new TypeError('offline');
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, headers: { get: (h: string) => (h.toLowerCase() === 'etag' ? r.etag ?? null : null) }, json: async () => r.body };
  };
  return calls;
}
// The modules as the app has them (they share state with each other), and a standalone copy that re-reads storage like a new launch
const base = { shared: await import('./covers'), picks: await import('./covers'), admin: await import('./covers') };
const launch = async (q: string) => {
  const fresh = { ...(await import('./coverLookup')), ...(await import(`./coverPicks?${q}`)) } as typeof import('./covers'); // fresh picks / shared / admin state, the app's one lookup module
  return { shared: fresh, admin: fresh };
};
const covers = await import('./covers');

test('a published cover is used by everyone; your own pick wins on your device; a failing one falls back', async () => {
  const { shared, picks } = base;
  assert.equal(picks.getCoverPick(book), '');
  shared.applySharedCovers(5, { [KEY]: { url: APPLE, source: 'apple', t: 1 } });
  assert.equal(picks.getCoverPick(book, 'L'), APPLE);
  picks.setCoverPick(book, { url: OL, source: 'openlibrary' });
  assert.equal(picks.getCoverPick(book, 'L'), OL); // mine wins
  picks.clearCoverPick(book);
  assert.equal(picks.getCoverPick(book, 'L'), APPLE); // back to the published one
  picks.markCoverPickFailed(book);
  assert.equal(picks.getCoverPick(book), ''); // never a blank card: the normal cover draws
  assert.equal(shared.getSharedPick(KEY)?.url, APPLE); // and the published set itself is untouched
});

test('the saved copy is used at once on the next launch, and bad entries in it are ignored', async () => {
  store.clear();
  const { shared } = await launch('save1');
  shared.applySharedCovers(7, { [KEY]: { url: APPLE, source: 'apple', t: 1 }, bad: { url: 'http://x/y.jpg' } });
  const next = (await launch('save2')).shared;
  assert.equal(next.sharedCoversVersion(), 7);
  assert.deepEqual(Object.keys(next.sharedCoverPicks()), [KEY]);
});

test('a re-draw is asked for only when the published version really changed', async () => {
  const { shared } = base;
  let ticks = 0;
  const off = covers.subscribeCovers(() => { ticks++; });
  shared.applySharedCovers(20, {});
  shared.applySharedCovers(20, {});
  assert.equal(ticks, 1);
  shared.applySharedCovers(21, {});
  assert.equal(ticks, 2);
  off();
});

test('sync: downloads once, asks with the ETag, a 304 costs nothing, and it is not repeated within 10 minutes', async () => {
  store.clear();
  const { shared } = await launch('sync1');
  let calls = server(() => ({ body: { v: 30, picks: { [KEY]: { url: APPLE, source: 'apple', t: 1 } } }, etag: '"30"' }));
  assert.equal(await shared.syncSharedCovers(), true);
  assert.equal(calls.length, 1);
  assert.equal(shared.sharedCoversVersion(), 30);
  assert.equal(await shared.syncSharedCovers(), true);
  assert.equal(calls.length, 1, 'inside the 10 minutes: no request');

  calls = server(c => (c.init.headers?.['If-None-Match'] === '"30"' ? { status: 304 } : { body: { v: 99, picks: {} } }));
  assert.equal(await shared.syncSharedCovers({ force: true }), true);
  assert.equal(calls[0].init.headers['If-None-Match'], '"30"');
  assert.equal(shared.sharedCoversVersion(), 30, 'a 304 changes nothing');
});

test('sync: a failure, an error answer or nonsense keeps the saved copy and never throws', async () => {
  store.clear();
  const { shared } = await launch('sync2');
  shared.applySharedCovers(40, { [KEY]: { url: APPLE, source: 'apple', t: 1 } });
  for (const h of ['throw', { status: 500 }, { status: 404 }, { body: 'junk' }, { body: { v: 1 } }] as const) {
    server(() => h as any);
    assert.equal(await shared.syncSharedCovers({ force: true }), false);
    assert.equal(shared.sharedCoversVersion(), 40);
    assert.equal(shared.getSharedPick(KEY)?.url, APPLE);
  }
});

test('sync: callers at the same moment share one request, and a failed try waits a minute before the next', async () => {
  store.clear();
  const { shared } = await launch('sync3');
  const calls = server(() => ({ status: 500 }));
  const [a, b] = await Promise.all([shared.syncSharedCovers({ force: true }), shared.syncSharedCovers({ force: true })]);
  assert.deepEqual([a, b], [false, false]);
  assert.equal(calls.length, 1);
  await shared.syncSharedCovers(); // not forced: too soon after the failed try
  assert.equal(calls.length, 1);
});

test('the owner\'s tools: five quick taps switch them on, slow taps do not, five more switch them off, and the token stays on the device', async () => {
  store.clear();
  const { admin } = await launch('admin');
  assert.equal(admin.isCoverAdminOn(), false);
  let seen = 0;
  const off = admin.subscribeCoverAdmin(() => { seen++; });
  for (let i = 0; i < 4; i++) assert.equal(admin.tapSecret(1000 + i * 100), undefined);
  assert.equal(admin.tapSecret(5000), undefined, 'the first taps are too old by now');
  assert.equal(admin.isCoverAdminOn(), false);
  for (let i = 0; i < 3; i++) admin.tapSecret(5100 + i * 100);
  assert.equal(admin.tapSecret(5400), true);
  assert.equal(admin.isCoverAdminOn(), true);
  assert.equal(seen, 1);
  assert.equal((await launch('admin2')).admin.isCoverAdminOn(), true, 'stays on across launches');
  for (let i = 0; i < 4; i++) admin.tapSecret(9000 + i * 100);
  assert.equal(admin.tapSecret(9400), false);
  assert.equal(admin.isCoverAdminOn(), false);
  admin.setCoverToken('secret-token-123');
  assert.equal(admin.getCoverToken(), 'secret-token-123');
  admin.setCoverToken('');
  assert.equal(admin.getCoverToken(), '');
  off();
});

test('publish list: published + yours (yours win) minus what you removed, with a status for each', async () => {
  const { buildDraft, draftStatus, countChanges } = await import('./covers');
  const rec = (url: string) => ({ url, source: 'link' as const, t: 1 });
  const shared = { a: rec('https://x/a1'), b: rec('https://x/b1'), c: rec('https://x/c1') };
  const mine = { b: rec('https://x/b2'), d: rec('https://x/d1') };
  const draft = buildDraft(shared, mine, new Set(['c']));
  assert.deepEqual(Object.keys(draft).sort(), ['a', 'b', 'd']);
  assert.equal(draft.b.url, 'https://x/b2');
  assert.equal(draftStatus('a', draft.a, shared), 'published');
  assert.equal(draftStatus('b', draft.b, shared), 'changed');
  assert.equal(draftStatus('d', draft.d, shared), 'new');
  assert.deepEqual(countChanges(draft, shared), { changed: 2, removed: 1 });
  assert.deepEqual(Object.keys(buildDraft(shared, {}, new Set())).sort(), ['a', 'b', 'c'], 'a phone with no picks of its own cannot wipe the set');
});

test('publish: sends the token and the set, then everyone (this device too) draws the published set', async () => {
  const { shared, picks } = base;
  const NEW = 'https://is1-ssl.mzstatic.com/image/thumb/P/v4/cd/art2/600x900bb.jpg';
  const { publishCovers } = await import('./covers');
  const draft = { [KEY]: { url: NEW, source: 'apple' as const, t: 2, title: 'Shared One', author: 'Ann Author' } };
  const calls = server(() => ({ body: { v: 50, picks: draft, dropped: 0 } }));
  const r = await publishCovers(draft, 'tok');
  assert.deepEqual(r, { ok: true, count: 1, dropped: 0 });
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.headers.authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(calls[0].init.body), { picks: draft });
  assert.equal(shared.sharedCoversVersion(), 50);
  assert.equal(picks.getCoverPick(book, 'L'), NEW);
});

test('publish: says why it failed and changes nothing', async () => {
  const { shared } = base;
  const before = shared.sharedCoversVersion();
  const { publishCovers } = await import('./covers');
  const cases: [any, string][] = [
    [{ status: 401, body: { error: 'unauthorized' } }, 'unauthorized'],
    [{ status: 503, body: { error: 'not_configured' } }, 'not_configured'],
    [{ status: 413, body: {} }, 'too_large'],
    [{ status: 400, body: {} }, 'invalid'],
    [{ status: 503, body: { error: 'store_unavailable' } }, 'error'],
    ['throw', 'network'],
  ];
  for (const [reply, reason] of cases) {
    server(() => reply);
    assert.deepEqual(await publishCovers({}, 'tok'), { ok: false, reason });
    assert.equal(shared.sharedCoversVersion(), before);
  }
});
