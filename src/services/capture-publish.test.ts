// Run with: npm test
// The owner's capture also publishes what is missing (database step), only when switched on, and tells the app to refresh.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
store.set('readlife.sb1', JSON.stringify({ access: 'a', refresh: 'r', exp: Date.now() + 3600_000, user: { id: 'u1', email: 'me@example.com' } }));

const published: string[][] = [];
let n = 0;
(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const method = init.method || 'GET';
  const res = (b: unknown, status = 200) => new Response(b === null ? null : JSON.stringify(b), { status });
  if (url.includes('/rpc/catalog_is_admin')) return res(true);
  if (url.includes('/rpc/catalog_publish_defaults')) { published.push(JSON.parse(init.body).p_work_ids); return res(3); }
  if (method === 'GET') return res(url.includes('catalog_works') ? [{ id: 'w-old', work_key: 'old book|old author' }] : []);
  if (method === 'POST') { const b = JSON.parse(init.body); return res(url.includes('catalog_works') ? [{ id: `w-${++n}`, ...b }] : null, 201); }
  return res({}, 405);
};

const sb = await import('./supabase');
const cap = await import('./capture');
await sb.checkAdmin();
let refreshed = 0;
cap.setPublishedSink(() => { refreshed++; });
const item = { title: 'Kin', author: 'Tayari Jones', covers: ['https://is1-ssl.mzstatic.com/a/600x900bb.jpg'], year: '2026' };

test('after storing a book, the missing parts are published for it and the app is told', async () => {
  cap.resetCaptureForTests();
  cap.captureBook(item);
  await new Promise(r => setTimeout(r, 500));
  assert.deepEqual(published, [['w-1']]);
  assert.equal(refreshed, 1);
  assert.equal(cap.captureStatus().published, 3);
});

test('publishing everything missing covers every book the catalog has', async () => {
  cap.resetCaptureForTests();
  published.length = 0;
  await cap.publishAllMissing();
  assert.equal(published.length, 1);
  assert.ok(published[0].includes('w-old'));
});

test('with auto-publish switched off, data is stored but nothing is published', async () => {
  cap.resetCaptureForTests();
  published.length = 0;
  cap.setAutoPublish(false);
  cap.captureBook({ ...item, title: 'Another' });
  await new Promise(r => setTimeout(r, 500));
  await cap.publishAllMissing();
  assert.equal(published.length, 0);
  cap.setAutoPublish(true);
});
