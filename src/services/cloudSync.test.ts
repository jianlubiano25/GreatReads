// Run with: npm test
// Cloud backup: a first upload creates the record; a newer copy from another device is a conflict (nothing written) until the person replaces it on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
store.set('readlife.sb1', JSON.stringify({ access: 'a', refresh: 'r', exp: Date.now() + 3600_000, user: { id: 'u1', email: 'me@example.com' } }));

const rows = new Map<string, any>();
(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const parsed = new URL(url);
  const method = init.method || 'GET';
  const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  if (parsed.pathname.endsWith('/auth/v1/logout')) return res({});
  if (parsed.pathname.endsWith('/auth/v1/token')) return res({ access_token: 'u2-a', refresh_token: 'u2-r', expires_in: 3600, user: { id: 'u2', email: 'other@example.com' } });
  const userId = method === 'POST' ? JSON.parse(init.body).user_id : parsed.searchParams.get('user_id')?.replace(/^eq\./, '');
  if (method === 'GET') { const found = rows.get(userId); return res(found ? [found] : []); }
  if (method === 'POST') { const body = JSON.parse(init.body); rows.set(userId, { ...body, device_id: body.device_id }); return res(null, 201); }
  if (method === 'PATCH') {
    const wanted = Number(/revision=eq\.(\d+)/.exec(url)![1]);
    const found = rows.get(userId);
    if (!found || found.revision !== wanted) return res([]);
    const next = { ...found, ...JSON.parse(init.body) };
    rows.set(userId, next);
    return res([next]);
  }
  return res({}, 404);
};

const cloud = await import('./cloudSync');

test('first backup, second backup, and a conflict from another device', async () => {
  assert.equal((await cloud.backUpNow('{"a":1}')).ok, true);
  assert.equal(rows.get('u1').revision, 1);
  assert.equal((await cloud.backUpNow('{"a":2}')).ok, true);
  assert.equal(rows.get('u1').revision, 2);
  rows.set('u1', { ...rows.get('u1'), revision: 5, payload: { json: '{"other":1}' } }); // another device uploaded meanwhile
  const r = await cloud.backUpNow('{"a":3}');
  assert.equal(r.ok, false);
  assert.equal((r as any).conflict, true);
  assert.equal(rows.get('u1').revision, 5); // nothing was overwritten
  assert.equal(cloud.lastSynced().conflict, true);
  assert.equal((await cloud.backUpNow('{"a":3}', true)).ok, true); // replaced on purpose
  assert.equal(rows.get('u1').revision, 6);

  rows.set('u2', { user_id: 'u2', record_type: 'backup', record_id: 'main', revision: 6, payload: { json: '{"private":"other account"}' }, updated_at: new Date().toISOString(), device_id: 'another-device' });
  const sb = await import('./supabase');
  await sb.signOut();
  assert.equal((await sb.signIn('other@example.com', 'password')).ok, true);
  const accountSwitch = await cloud.backUpNow('{"a":"must not replace another account"}');
  assert.equal(accountSwitch.ok, false);
  assert.equal((accountSwitch as any).conflict, true);
  assert.deepEqual(rows.get('u2').payload, { json: '{"private":"other account"}' });
});

test('restore reads the cloud copy and a bad backup text is refused', async () => {
  const got = await cloud.fetchCloudBackup();
  assert.equal(got.ok, true);
  assert.equal((await cloud.backUpNow('not json')).ok, false);
});
