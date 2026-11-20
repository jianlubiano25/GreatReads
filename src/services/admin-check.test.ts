// Run with: npm test
// A failed or slow admin check must never be remembered as "not an admin" (the owner tools would stay off until sign-out); only the database's own "no" is a no.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
store.set('readlife.sb1', JSON.stringify({ access: 'a', refresh: 'r', exp: Date.now() + 3600_000, user: { id: 'u1', email: 'me@example.com' } }));

let answer: 'fail' | 'yes' | 'no' = 'fail';
(globalThis as any).fetch = async (url: string) => {
  if (!url.includes('/rpc/catalog_is_admin')) return new Response('{}', { status: 404 });
  if (answer === 'fail') return new Response('{"message":"upstream"}', { status: 503 });
  return new Response(JSON.stringify(answer === 'yes'), { status: 200 });
};
const sb = await import('./supabase');

test('a failed check leaves the admin state unknown (asked again later), a later yes turns the tools on, a real no stays no', async () => {
  assert.equal(await sb.checkAdmin(), false);
  assert.equal(sb.isAdminKnown(), undefined, 'a failure is not a "no"');
  answer = 'yes';
  assert.equal(await sb.checkAdmin(), true);
  assert.equal(sb.isAdminKnown(), true);
  answer = 'no';
  assert.equal(await sb.checkAdmin(), false);
  assert.equal(sb.isAdminKnown(), false);
});
