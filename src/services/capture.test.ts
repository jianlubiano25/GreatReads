// Run with: npm test
// Owner-only capture: stores fetched data as hidden candidates, insert only, never twice, never for a non-owner.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
store.set('readlife.sb1', JSON.stringify({ access: 'a', refresh: 'r', exp: Date.now() + 3600_000, user: { id: 'u1', email: 'me@example.com' } }));

let isAdmin = true;
let forbid = false;
const calls: { method: string; url: string; body?: any }[] = [];
const rows: Record<string, any[]> = { catalog_works: [], catalog_cover_candidates: [], catalog_content_versions: [], catalog_metadata_candidates: [], catalog_rating_candidates: [] };
const uniq: Record<string, (a: any, b: any) => boolean> = {
  catalog_works: (a, b) => a.work_key === b.work_key,
  catalog_cover_candidates: (a, b) => a.work_id === b.work_id && a.image_url === b.image_url,
  catalog_content_versions: (a, b) => a.work_id === b.work_id && a.content_type === b.content_type && a.content === b.content,
  catalog_metadata_candidates: (a, b) => a.work_id === b.work_id && a.field_name === b.field_name && a.field_value === b.field_value,
  catalog_rating_candidates: (a, b) => a.work_id === b.work_id && a.source_name === b.source_name,
};
(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : undefined;
  calls.push({ method, url, body });
  const res = (b: unknown, status = 200) => new Response(b === null ? null : JSON.stringify(b), { status });
  if (url.includes('/rpc/catalog_is_admin')) return res(isAdmin);
  const table = /rest\/v1\/([a-z_]+)/.exec(url)?.[1] || '';
  if (forbid && method === 'POST') return res({ message: 'denied' }, 403);
  if (method === 'GET') return res(table === 'catalog_works' ? rows.catalog_works.map(w => ({ id: w.id, work_key: w.work_key })) : []);
  if (method === 'POST') {
    const list = Array.isArray(body) ? body : [body];
    for (const r of list) if (rows[table].some(x => uniq[table](x, r))) return res({ message: 'duplicate key' }, 409);
    const made = list.map((r: any) => ({ id: `${table}-${rows[table].length + 1}`, ...r }));
    rows[table].push(...made);
    return res(made, 201);
  }
  return res({ message: 'not expected' }, 405);
};

const sb = await import('./supabase');
const cap = await import('./capture');
await sb.checkAdmin();

const item = { title: 'Kin', author: 'Tayari Jones', covers: ['https://is1-ssl.mzstatic.com/a/600x900bb.jpg', 'http://insecure.example/x.jpg'], summary: 'A long enough description of the book to be worth keeping, definitely over forty characters.', year: '2026', pageCount: 368, genre: 'Fiction', ratings: [{ source: 'apple', average: 4.5, count: 533 }, { source: 'nope', average: 4 }] };

test('stores everything as hidden candidates in a draft book, and nothing else', async () => {
  cap.resetCaptureForTests();
  cap.captureBook(item);
  await new Promise(r => setTimeout(r, 400));
  assert.equal(rows.catalog_works.length, 1);
  assert.equal(rows.catalog_works[0].status, 'draft');
  assert.equal(rows.catalog_cover_candidates.length, 1); // the http link was left out
  assert.equal(rows.catalog_cover_candidates[0].status, 'candidate');
  assert.equal(rows.catalog_content_versions[0].status, 'candidate');
  assert.deepEqual(rows.catalog_metadata_candidates.map(r => r.field_name).sort(), ['genre', 'pageCount', 'year']);
  assert.equal(rows.catalog_rating_candidates.length, 1);
  assert.equal(rows.catalog_rating_candidates[0].source_name, 'apple_books');
  assert.ok(calls.every(c => c.method === 'GET' || c.method === 'POST')); // never an update or delete
});

test('the same data is not sent twice, and an existing row is simply "already there"', async () => {
  const before = calls.filter(c => c.method === 'POST').length;
  cap.captureBook(item);
  await new Promise(r => setTimeout(r, 200));
  assert.equal(calls.filter(c => c.method === 'POST').length, before); // already sent: no request at all
  cap.resetCaptureForTests(); // a fresh device that does not know what was sent
  cap.captureBook(item);
  await new Promise(r => setTimeout(r, 500));
  assert.equal(rows.catalog_cover_candidates.length, 1); // 409s were accepted, nothing duplicated
  assert.equal(rows.catalog_works.length, 1);
});

test('a rating already stored (maybe published) is never overwritten', async () => {
  cap.resetCaptureForTests();
  rows.catalog_rating_candidates[0].status = 'published';
  cap.captureBook({ ...item, ratings: [{ source: 'apple', average: 1.1, count: 9 }] });
  await new Promise(r => setTimeout(r, 300));
  assert.equal(rows.catalog_rating_candidates[0].average_rating, 4.5);
  assert.equal(rows.catalog_rating_candidates[0].status, 'published');
});

test('someone who is not signed in as the owner sends nothing', async () => {
  cap.resetCaptureForTests();
  await sb.signOut();
  const before = calls.length;
  cap.captureBook({ ...item, title: 'Other Book' });
  await new Promise(r => setTimeout(r, 200));
  assert.equal(calls.length, before);
  assert.equal(cap.captureOn(), false);
});

test('rowsFor skips short text, odd years and unknown rating sites', () => {
  const r = cap.rowsFor({ title: 'X', author: 'Y', summary: 'too short', year: 'soon', ratings: [{ source: 'amazon', average: 4 }, { source: 'google', average: 9 }] }, 'w');
  assert.equal(r.length, 0);
});
