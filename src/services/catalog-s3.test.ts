// Run with: npm test
// S3: a conflicting id is kept as one unpublished note (never written over what the work has); the owner's cover viewer lists the stored covers.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

const { saveIdentityToCatalog, storedCovers } = await import('./catalog');

type Call = { method: string; table: string; query: string; body?: any };
const work: any = { id: 'w1', identifiers: { olWork: 'OL46092476W' } };
const edition: any = { id: 'e1', work_id: 'w1', isbn13: null, isbn10: null, openlibrary_edition_id: 'OL62673502M', google_volume_id: null };
const notes: any[] = [];
let covers: { image_url: string; status: string }[] = [];
let calls: Call[] = [];
(globalThis as any).fetch = async (input: any, init: any = {}) => {
  const url = new URL(String(input));
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : undefined;
  const table = url.pathname.split('/').pop()!;
  calls.push({ method, table, query: url.search, body });
  const reply = (status: number, data: unknown) => ({ ok: status < 300, status, text: async () => (data === undefined ? '' : JSON.stringify(data)), json: async () => (status < 300 ? data : { message: String(data) }) });
  if (table === 'catalog_works' && method === 'GET') return reply(200, url.searchParams.get('work_key') ? [{ id: 'w1' }] : [{ identifiers: work.identifiers }]);
  if (table === 'catalog_editions' && method === 'GET') return reply(200, [edition]);
  if (table === 'catalog_metadata_candidates' && method === 'POST') {
    if (notes.some(n => JSON.stringify(n.field_value) === JSON.stringify(body.field_value) && n.field_name === body.field_name)) return reply(409, 'dup');
    notes.push(body); return reply(201, undefined);
  }
  if (table === 'catalog_cover_candidates' && method === 'GET') return reply(200, covers.filter(c => !url.searchParams.get('status')?.startsWith('neq.') || c.status !== url.searchParams.get('status')!.slice(4)));
  return reply(405, 'not expected ' + method + ' ' + table);
};

test('a conflicting Open Library id / edition id is reported, written nowhere, and kept once as an unpublished alternateIds note', async () => {
  const id = { olWork: 'OL46092477W', olEdition: 'OL62697657M' };
  const r1 = await saveIdentityToCatalog('w1', id);
  assert.ok(r1.skipped.some(x => /work already has Open Library id/.test(x)) && r1.skipped.some(x => /edition already has/.test(x)));
  assert.equal(r1.saved.length, 0);
  assert.ok(!calls.some(c => c.method === 'PATCH' || c.method === 'DELETE'), 'nothing existing is changed');
  assert.equal(notes.length, 1);
  assert.deepEqual({ f: notes[0].field_name, v: notes[0].field_value, s: notes[0].source_name, st: notes[0].status }, { f: 'alternateIds', v: id, s: 'app', st: 'candidate' });
  await saveIdentityToCatalog('w1', id); // again: the database ignores the same note
  assert.equal(notes.length, 1);
  assert.equal(r1.retry, undefined);
});

test('no conflict, no note', async () => {
  notes.length = 0; calls = [];
  const r = await saveIdentityToCatalog('w1', { olWork: 'OL46092476W' });
  assert.equal(notes.length, 0);
  assert.equal(r.skipped.length, 0);
});

test('the cover viewer lists stored covers (not rejected, https only), found through the catalog key', async () => {
  covers = [{ image_url: 'https://a/1.jpg', status: 'published' }, { image_url: 'https://a/2.jpg', status: 'candidate' }, { image_url: 'https://a/3.jpg', status: 'rejected' }, { image_url: 'http://a/4.jpg', status: 'candidate' }];
  const list = await storedCovers({ title: 'The Witch', author: 'Someone' });
  assert.deepEqual(list.map(x => x.url), ['https://a/1.jpg', 'https://a/2.jpg']);
});
