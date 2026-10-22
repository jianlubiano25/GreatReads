// Run with: npm test
// Cloud backup: a first upload creates the record; a newer copy from another device is a conflict (nothing written) until the person replaces it on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
store.set('readlife.sb1', JSON.stringify({ access: 'a', refresh: 'r', exp: Date.now() + 3600_000, user: { id: 'u1', email: 'me@example.com' } }));

let row: any = null;
(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const method = init.method || 'GET';
  const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  if (method === 'GET') return res(row ? [row] : []);
  if (method === 'POST') { row = { ...JSON.parse(init.body), device_id: JSON.parse(init.body).device_id }; return res(null, 201); }
  if (method === 'PATCH') {
    const wanted = Number(/revision=eq\.(\d+)/.exec(url)![1]);
    if (!row || row.revision !== wanted) return res([]);
    row = { ...row, ...JSON.parse(init.body) };
    return res([row]);
  }
  return res({}, 404);
};

const cloud = await import('./cloudSync');

test('first backup, second backup, and a conflict from another device', async () => {
  assert.equal((await cloud.backUpNow('{"a":1}')).ok, true);
  assert.equal(row.revision, 1);
  assert.equal((await cloud.backUpNow('{"a":2}')).ok, true);
  assert.equal(row.revision, 2);
  row = { ...row, revision: 5, payload: { json: '{"other":1}' } }; // another device uploaded meanwhile
  const r = await cloud.backUpNow('{"a":3}');
  assert.equal(r.ok, false);
  assert.equal((r as any).conflict, true);
  assert.equal(row.revision, 5); // nothing was overwritten
  assert.equal(cloud.lastSynced().conflict, true);
  assert.equal((await cloud.backUpNow('{"a":3}', true)).ok, true); // replaced on purpose
  assert.equal(row.revision, 6);
});

test('restore reads the cloud copy and a bad backup text is refused', async () => {
  const got = await cloud.fetchCloudBackup();
  assert.equal(got.ok, true);
  assert.equal((await cloud.backUpNow('not json')).ok, false);
});
