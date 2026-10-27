// Run with: npm test
// Phase 2b: the owner's background capture and "Send and publish everything on this device" persist provider receipts from facts the device already holds. No provider request is ever made from there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
store.set('readlife.sb1', JSON.stringify({ access: 'a', refresh: 'r', exp: Date.now() + 3600_000, user: { id: 'u1', email: 'me@example.com' } }));

let isAdmin = true;
const calls: { method: string; url: string; body?: any }[] = [];
const rows: Record<string, any[]> = { catalog_works: [], catalog_cover_candidates: [], catalog_content_versions: [], catalog_metadata_candidates: [], catalog_rating_candidates: [], catalog_provider_records: [], catalog_works_x: [] };
const otherHosts: string[] = [];
(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : undefined;
  calls.push({ method, url, body });
  if (!/supabase|rest\/v1|rpc/.test(url)) otherHosts.push(url);
  const res = (b: unknown, status = 200) => new Response(b === null ? null : JSON.stringify(b), { status });
  if (url.includes('/rpc/catalog_is_admin')) return res(isAdmin);
  if (url.includes('/rpc/')) return res(0);
  const u = new URL(url); const table = /rest\/v1\/([a-z_]+)/.exec(url)?.[1] || '';
  if (method === 'GET') {
    if (table === 'catalog_works') return res(rows.catalog_works.map(w => ({ id: w.id, work_key: w.work_key, genres: [], honors: [] })));
    if (table === 'catalog_provider_records') { const eq = (k: string) => (u.searchParams.get(k) || '').replace(/^eq\./, ''); return res(rows.catalog_provider_records.filter(r => r.provider === eq('provider') && r.provider_record_id === eq('provider_record_id'))); }
    return res([]);
  }
  if (method === 'POST') {
    const list = Array.isArray(body) ? body : [body];
    const key = (a: any, b: any) => table === 'catalog_works' ? a.work_key === b.work_key : table === 'catalog_provider_records' ? a.provider === b.provider && a.provider_record_id === b.provider_record_id : JSON.stringify([a.work_id, a.field_name, a.source_name, a.field_value]) === JSON.stringify([b.work_id, b.field_name, b.source_name, b.field_value]) && a.image_url === b.image_url;
    for (const r of list) if ((rows[table] ||= []).some(x => key(x, r))) return res({ message: 'duplicate key' }, 409);
    const made = list.map((r: any) => ({ id: `${table}-${rows[table].length + 1}`, ...r }));
    rows[table].push(...made);
    return res(made, 201);
  }
  return res({ message: 'not expected' }, 405);
};

const sb = await import('./supabase');
const cap = await import('./capture');
const dev = await import('./captureDevice');
const pf = await import('./books/providerFacts');
await sb.checkAdmin();

const item = { title: 'Nettle & Bone', author: 'T. Kingfisher', bookId: 'apple_77', identity: { gbVolume: 'volGB1' }, genre: 'Fantasy' };
const seed = () => {
  pf.forgetProviderFactsForTests(); pf.setProviderFactsPersistence(() => true);
  pf.rememberProviderFacts({ provider: 'apple', recordId: '77', publishedDate: '2022-04-26T07:00:00Z', genres: ['Science Fiction & Fantasy'], authors: ['T. Kingfisher'], sourceUrl: 'https://books.apple.com/us/book/x/id77' });
  pf.rememberProviderFacts({ provider: 'google', recordId: 'volGB1', publisher: 'Tor', publishedDate: '2022-04-26', genres: ['Fiction / Fantasy'], pages: 250 });
};
const wait = (ms = 500) => new Promise(r => setTimeout(r, ms));

test('capture stores a receipt per provider from the facts this device holds, links the candidates, and sends nothing twice', async () => {
  cap.resetCaptureForTests(); seed();
  cap.captureBook(item); await wait();
  assert.deepEqual(rows.catalog_provider_records.map(r => `${r.provider}:${r.record_kind}:${r.payload_policy}`).sort(), ['apple:listing:trimmed', 'google:volume:trimmed']);
  const apple = rows.catalog_provider_records.find(r => r.provider === 'apple');
  assert.equal(apple.work_id, rows.catalog_works[0].id);
  assert.ok(rows.catalog_metadata_candidates.some(c => c.provider_record_id === apple.id && c.field_name === 'providerGenres' && c.source_name === 'apple'));
  assert.ok(rows.catalog_metadata_candidates.filter(c => c.provider_record_id).every(c => c.status === 'candidate'), 'never published');
  const posts = calls.filter(c => c.method === 'POST').length;
  cap.captureBook(item); await wait(250);
  assert.equal(calls.filter(c => c.method === 'POST').length, posts, 'same facts again: no request');
  cap.resetCaptureForTests(); // a fresh device that does not remember what was sent
  cap.captureBook(item); await wait();
  assert.equal(rows.catalog_provider_records.length, 2, 'no duplicate receipts');
});

test('changed provider facts are sent again (as a new candidate value) while the receipt stays one row; the receipt itself is refreshed only when due', async () => {
  seed(); pf.rememberProviderFacts({ provider: 'google', recordId: 'volGB1', publisher: 'Tor', publishedDate: '2022-04-26', genres: ['Fiction / Fantasy'], pages: 251 });
  cap.captureBook(item); await wait();
  assert.equal(rows.catalog_provider_records.filter(r => r.provider === 'google').length, 1);
});

test('a device that is not the owner makes no receipt request at all', async () => {
  isAdmin = false; await sb.checkAdmin(); cap.resetCaptureForTests(); seed();
  const before = calls.length;
  cap.captureBook({ ...item, title: 'Another Book' }); await wait(250);
  assert.equal(calls.length, before);
  isAdmin = true; await sb.checkAdmin();
});

test('the device item carries the book id so remembered facts are found; merging keeps it', () => {
  const it = dev.itemOf({ id: 'apple_77', title: 'Nettle & Bone', author: 'T. Kingfisher' });
  assert.equal(it.bookId, 'apple_77');
  assert.equal(dev.mergeItems({ title: 'A' }, { title: 'A', bookId: 'x1' }).bookId, 'x1');
  assert.equal('bookId' in dev.mergeItems({ title: 'A' }, { title: 'A' }), false);
});

test('the capture path never asks a provider for anything (docs/provider-terms.md): no provider source imported, no provider URL in it', () => {
  for (const f of ['src/services/capture.ts', 'src/services/captureDevice.ts', 'src/services/catalogReceipts.ts']) {
    const code = readFileSync(f, 'utf8');
    assert.ok(!/sources\/(appleBooks|googleBooks|openLibrary)/.test(code), `${f} imports a provider adapter`);
    assert.ok(!/itunes\.apple\.com|googleapis\.com|openlibrary\.org/.test(code), `${f} names a provider URL`);
  }
  assert.deepEqual(otherHosts, [], 'every request in these tests went to the catalog database only');
});

test('capture only ever writes to catalog tables (never personal data) and never deletes', () => {
  assert.ok(calls.every(c => c.method !== 'DELETE' && c.method !== 'PUT'));
  assert.ok(calls.every(c => !/user_/.test(c.url)));
});
