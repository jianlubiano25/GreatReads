// Run with: npm test
// MERGE GUARD: a catalog work archived by a merge (status archived + identifiers.mergedInto) keeps its old work_key. Every lookup by key (Save to catalog, cover
// publish, ensureWork, the cover viewer, background capture) must hand back the CANONICAL work, never write to or publish the archived one.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
store.set('readlife.sb1', JSON.stringify({ access: 'a', refresh: 'r', exp: Date.now() + 3600_000, user: { id: 'u1', email: 'me@example.com' } }));

type W = { id: string; work_key: string; status: string; identifiers: Record<string, unknown> };
const CANON = 'c0000000-0000-0000-0000-00000000000c', ARCH = 'a0000000-0000-0000-0000-00000000000a', PLAIN = 'b0000000-0000-0000-0000-00000000000b';
const LOOP1 = 'd0000000-0000-0000-0000-0000000000d1', LOOP2 = 'd0000000-0000-0000-0000-0000000000d2', BROKEN = 'e0000000-0000-0000-0000-00000000000e';
const works: W[] = [
  { id: CANON, work_key: 'nettle & bone|ursula vernon', status: 'published', identifiers: { olWork: 'OL1W' } },
  { id: ARCH, work_key: 'nettle & bone|t. kingfisher', status: 'archived', identifiers: { mergedInto: CANON } },
  { id: PLAIN, work_key: 'hidden book|a writer', status: 'archived', identifiers: {} },
  { id: LOOP1, work_key: 'loop one|x', status: 'archived', identifiers: { mergedInto: LOOP2 } },
  { id: LOOP2, work_key: 'loop two|x', status: 'archived', identifiers: { mergedInto: LOOP1 } },
  { id: BROKEN, work_key: 'broken|x', status: 'archived', identifiers: { mergedInto: 'f0000000-0000-0000-0000-00000000000f' } },
];
let calls: { method: string; table: string; query: string; body?: any }[] = [];
let rpcs: { fn: string; args: any }[] = [];
(globalThis as any).fetch = async (input: any, init: any = {}) => {
  const url = new URL(String(input));
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : undefined;
  const res = (b: unknown, status = 200) => new Response(b === null || b === undefined ? null : JSON.stringify(b), { status });
  if (url.pathname.includes('/rpc/catalog_is_admin')) return res(true);
  if (url.pathname.includes('/rpc/')) { rpcs.push({ fn: url.pathname.split('/').pop()!, args: body }); return res(0); }
  const table = url.pathname.split('/').pop()!;
  calls.push({ method, table, query: url.search, body });
  const q = url.searchParams;
  if (table === 'catalog_works' && method === 'GET') {
    if (q.get('work_key')) return res(works.filter(w => w.work_key === q.get('work_key')!.replace('eq.', '')));
    if (q.get('id')) return res(works.filter(w => w.id === q.get('id')!.replace('eq.', '')));
    return res(works);
  }
  if (method === 'GET') return res([]);
  if (method === 'POST' && table === 'catalog_works' && works.some(w => w.work_key === body.work_key)) return res({ message: 'duplicate key' }, 409);
  if (method === 'POST') return res([{ id: 'new-row' }], 201);
  return res(null, 204);
};

const cat = await import('./catalog');
const cap = await import('./capture');
const sb = await import('./supabase');
await sb.checkAdmin();
const reset = () => { calls = []; rpcs = []; cap.resetCaptureForTests(); };
const touchedWorkIds = () => [...calls.filter(c => c.method !== 'GET').map(c => c.body?.work_id), ...calls.filter(c => c.method !== 'GET').map(c => /work_id=eq\.([^&]+)|[?&]id=eq\.([^&]+)/.exec(c.query)?.slice(1).find(Boolean)), ...rpcs.map(r => r.args?.p_work_id), ...rpcs.flatMap(r => r.args?.p_work_ids ?? [])].filter(Boolean);

test('findWorkByKey: a merged work hands over to its canonical work; a hidden (not merged) one is returned as before; broken and looping merges are refused', async () => {
  assert.deepEqual(await cat.findWorkByKey('nettle & bone|t. kingfisher'), { ok: true, id: CANON });
  assert.deepEqual(await cat.findWorkByKey('nettle & bone|ursula vernon'), { ok: true, id: CANON });
  assert.deepEqual(await cat.findWorkByKey('hidden book|a writer'), { ok: true, id: PLAIN });
  assert.deepEqual(await cat.findWorkByKey('nobody|nothing'), { ok: true });
  for (const k of ['loop one|x', 'broken|x']) { const r = await cat.findWorkByKey(k); assert.equal(r.ok, false, k); }
});

test('cover star on the archived duplicate\'s key publishes the CANONICAL work and never touches the archived one', async () => {
  reset();
  const r = await cat.publishCoverToCatalog({ title: 'Nettle & Bone', author: 'T. Kingfisher' }, 'https://covers.openlibrary.org/b/id/1-L.jpg');
  assert.equal(r.ok, true);
  const ids = touchedWorkIds();
  assert.ok(ids.includes(CANON));
  assert.ok(!ids.includes(ARCH), 'the archived work is not written to or published');
  assert.ok(!calls.some(c => c.table === 'catalog_works' && c.method === 'POST'), 'no new work is created');
});

test('ensureWork returns the canonical id; a broken merge is refused with nothing written', async () => {
  reset();
  assert.deepEqual(await cat.ensureWork({ title: 'Nettle & Bone', author: 'T. Kingfisher' }), { ok: true, id: CANON });
  const bad = await cat.ensureWork({ title: 'Broken', author: 'X' });
  assert.equal(bad.ok, false);
  assert.ok(!calls.some(c => c.method !== 'GET'));
});

test('setWorkStatus never publishes a work that was archived by a merge; other changes and plain works are as before', async () => {
  reset();
  const r = await cat.setWorkStatus(ARCH, 'published');
  assert.equal(r.ok, false);
  assert.equal(rpcs.length, 0, 'no publish request was sent');
  assert.equal((await cat.setWorkStatus(CANON, 'published')).ok, true);
  assert.equal((await cat.setWorkStatus(ARCH, 'archived')).ok, true, 'archiving is still allowed');
  assert.equal((await cat.setWorkStatus(PLAIN, 'published')).ok, true, 'a hidden, not merged, work can be published by the owner');
});

test('Save to catalog on the archived key writes to the canonical work only', async () => {
  reset();
  await cat.saveBookToCatalog({ id: 'x', title: 'Nettle & Bone', author: 'T. Kingfisher', summary: 'A long enough description of the book to be stored, definitely over forty characters.', year: '2022' } as any, []);
  const ids = touchedWorkIds();
  assert.ok(ids.includes(CANON) && !ids.includes(ARCH));
});

test('background capture: books under the archived key go to the canonical work; the archived work is never published; a broken merge writes nothing', async () => {
  reset();
  cap.captureBook({ title: 'Nettle & Bone', author: 'T. Kingfisher', summary: 'A long enough description of the book to be stored, definitely over forty characters.', year: '2022' });
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 50)); const s = cap.captureStatus(); if (!s.running && !s.queued) break; }
  const ids = touchedWorkIds();
  assert.ok(ids.includes(CANON), 'rows were sent');
  assert.ok(!ids.includes(ARCH));
  assert.ok(!calls.some(c => c.table === 'catalog_works' && c.method === 'POST'));
  await cap.publishAllMissing();
  assert.ok(rpcs.some(r => r.fn === 'catalog_publish_defaults'));
  assert.ok(![...rpcs.flatMap(r => r.args?.p_work_ids ?? [])].includes(ARCH));
  reset();
  cap.captureBook({ title: 'Broken', author: 'X', summary: 'A long enough description of the book to be stored, definitely over forty characters.' });
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 50)); const s = cap.captureStatus(); if (!s.running && !s.queued) break; }
  assert.ok(!calls.some(c => c.method !== 'GET'), 'nothing written for a key whose merge target is missing');
});
