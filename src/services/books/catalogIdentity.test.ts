// Run with: npm test
// Catalog identity rules (exact ids only, conflicts reported never merged) and the owner's "Save to catalog" id writes, against an in-memory fake of the catalog tables.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { catalogIdsFrom, planEdition, planWorkIdentifiers, validIsbn10, validIsbn13, type EditionRow } from './catalogIdentity';
import { saveIdentityToCatalog } from '../catalog';

const G13 = '9780743273565'; // The Great Gatsby
const G10 = '0743273567';

/* ---------- pure rules ---------- */

test('ISBN check digits: real numbers pass, a wrong last digit or a made-up number does not', () => {
  assert.equal(validIsbn13(G13), G13);
  assert.equal(validIsbn13('978-0-7432-7356-5'), G13);
  assert.equal(validIsbn13('9780743273566'), '');
  assert.equal(validIsbn13('1234567890123'), '');
  assert.equal(validIsbn10(G10), G10);
  assert.equal(validIsbn10('0743273568'), '');
  assert.equal(validIsbn10('080442957X'), '080442957X', 'X check digit');
});

test('catalogIdsFrom keeps valid ids, drops invalid ones by name, and never invents an id', () => {
  const r = catalogIdsFrom({ olWork: 'OL468431W', olEdition: 'OL7353617M', gbVolume: 'iXn5U2IzVH0C', isbn13: G13, isbn10: G10 });
  assert.deepEqual(r.ids, { olWork: 'OL468431W', olEdition: 'OL7353617M', gbVolume: 'iXn5U2IzVH0C', isbn13: G13, isbn10: G10 });
  assert.deepEqual(r.rejected, []);
  const bad = catalogIdsFrom({ olWork: 'not-an-id', isbn13: '9780743273566' });
  assert.deepEqual(bad.ids, {});
  assert.deepEqual(bad.rejected.sort(), ['isbn13', 'olWork']);
  assert.deepEqual(catalogIdsFrom(undefined), { ids: {}, rejected: [] });
  assert.deepEqual(catalogIdsFrom({ isbn13: G13 }).ids, { isbn13: G13 }, 'a lone ISBN-13 stays alone: no ISBN-10 is made up');
});

test('an ISBN-10 and ISBN-13 that are not the same number are two different books: neither is kept', () => {
  const r = catalogIdsFrom({ isbn13: G13, isbn10: '0306406152' });
  assert.deepEqual(r.ids, {});
  assert.deepEqual(r.rejected, ['isbn10/isbn13 disagree']);
});

test('work ids: added when empty, same is fine, a different Open Library work id is a conflict and is not overwritten', () => {
  assert.deepEqual(planWorkIdentifiers({}, { olWork: 'OL1W' }), { patch: { olWork: 'OL1W' }, conflicts: [] });
  assert.deepEqual(planWorkIdentifiers({ alt_keys: ['x'] }, { olWork: 'OL1W' }).patch, { olWork: 'OL1W' });
  assert.deepEqual(planWorkIdentifiers({ olWork: 'OL1W' }, { olWork: 'OL1W' }), { conflicts: [] });
  const c = planWorkIdentifiers({ olWork: 'OL1W' }, { olWork: 'OL2W' });
  assert.equal(c.patch, undefined);
  assert.equal(c.conflicts.length, 1);
  assert.deepEqual(planWorkIdentifiers({}, {}), { conflicts: [] });
});

const row = (o: Partial<EditionRow> = {}): EditionRow => ({ id: 'e1', work_id: 'w1', isbn13: null, isbn10: null, openlibrary_edition_id: null, google_volume_id: null, ...o });

test('edition plan: nothing known = no edition; unknown ids = insert; known edition of this work = fill only the empty columns', () => {
  assert.deepEqual(planEdition('w1', {}, []), { action: 'none' });
  assert.deepEqual(planEdition('w1', { isbn13: G13 }, []), { action: 'insert', body: { isbn13: G13 } });
  assert.deepEqual(planEdition('w1', { isbn13: G13, gbVolume: 'abcdef' }, [row({ isbn13: G13 })]), { action: 'update', id: 'e1', body: { google_volume_id: 'abcdef' } });
  assert.deepEqual(planEdition('w1', { isbn13: G13 }, [row({ isbn13: G13 })]), { action: 'same', id: 'e1' });
});

test('edition plan conflicts write nothing: another book owns the id, ids point at two editions, or a filled column would change', () => {
  assert.equal(planEdition('w1', { isbn13: G13 }, [row({ work_id: 'OTHER', isbn13: G13 })]).action, 'conflict');
  assert.equal(planEdition('w1', { isbn13: G13, gbVolume: 'abcdef' }, [row({ id: 'a', isbn13: G13 }), row({ id: 'b', google_volume_id: 'abcdef' })]).action, 'conflict');
  assert.equal(planEdition('w1', { isbn13: G13, gbVolume: 'abcdef' }, [row({ google_volume_id: 'zzzzzz' })]).action, 'conflict');
});

/* ---------- the owner's write path, against a fake catalog ---------- */

type Work = { id: string; identifiers: Record<string, unknown> };
type Ed = EditionRow & { status?: string; source_name?: string };
function fakeCatalog(works: Work[], editions: Ed[]) {
  const calls: { method: string; path: string; body?: any }[] = [];
  let seq = 0;
  (globalThis as any).fetch = async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const table = url.pathname.split('/').pop()!;
    calls.push({ method, path: table + url.search, body });
    const reply = (status: number, data: unknown) => ({ ok: status < 300, status, text: async () => (data === undefined ? '' : JSON.stringify(data)), json: async () => (status < 300 ? data : { message: String(data) }) });
    const q = url.searchParams;
    if (table === 'catalog_works') {
      const id = q.get('id')!.replace('eq.', '');
      const w = works.find(x => x.id === id);
      if (method === 'GET') return reply(200, w ? [{ identifiers: w.identifiers }] : []);
      if (method === 'PATCH') {
        const ol = body.identifiers.olWork;
        if (ol && works.some(x => x.id !== id && x.identifiers.olWork === ol)) return reply(409, 'duplicate key value violates unique constraint');
        w!.identifiers = body.identifiers; return reply(204, undefined);
      }
    }
    if (table === 'catalog_editions') {
      if (method === 'GET') {
        const clauses = q.get('or')!.slice(1, -1).split(',').map(c => c.split('.eq.'));
        const col = (k: string) => k;
        return reply(200, editions.filter(e => clauses.some(([k, v]) => (e as any)[col(k)] === v)));
      }
      if (method === 'POST') {
        for (const k of ['isbn13', 'openlibrary_edition_id', 'google_volume_id']) if (body[k] && editions.some(e => (e as any)[k] === body[k])) return reply(409, 'duplicate key');
        editions.push({ id: `new${++seq}`, work_id: body.work_id, isbn13: body.isbn13 ?? null, isbn10: body.isbn10 ?? null, openlibrary_edition_id: body.openlibrary_edition_id ?? null, google_volume_id: body.google_volume_id ?? null, status: body.status, source_name: body.source_name });
        return reply(201, undefined);
      }
      if (method === 'PATCH') { Object.assign(editions.find(e => e.id === q.get('id')!.replace('eq.', ''))!, body); return reply(204, undefined); }
    }
    return reply(404, 'unexpected');
  };
  return calls;
}

test('save: a new book gets its Open Library work id on the work and one edition row with its ISBNs, source and status', async () => {
  const works: Work[] = [{ id: 'w1', identifiers: { alt_keys: ['a'] } }];
  const editions: Ed[] = [];
  fakeCatalog(works, editions);
  const r = await saveIdentityToCatalog('w1', { olWork: 'OL468431W', olEdition: 'OL7353617M', gbVolume: 'iXn5U2IzVH0C', isbn13: G13, isbn10: G10 });
  assert.deepEqual(r, { saved: ['olWork', 'edition'], skipped: [] });
  assert.deepEqual(works[0].identifiers, { alt_keys: ['a'], olWork: 'OL468431W' }, 'existing identifiers are kept');
  assert.equal(editions.length, 1);
  assert.deepEqual([editions[0].work_id, editions[0].isbn13, editions[0].isbn10, editions[0].openlibrary_edition_id, editions[0].google_volume_id, editions[0].source_name, editions[0].status], ['w1', G13, G10, 'OL7353617M', 'iXn5U2IzVH0C', 'app', 'published']);
});

test('save twice: the second save changes nothing (no duplicate edition, no second write)', async () => {
  const works: Work[] = [{ id: 'w1', identifiers: {} }];
  const editions: Ed[] = [];
  const calls = fakeCatalog(works, editions);
  const id = { olWork: 'OL1W', isbn13: G13 };
  await saveIdentityToCatalog('w1', id);
  const before = calls.length;
  const r = await saveIdentityToCatalog('w1', id);
  assert.deepEqual(r, { saved: [], skipped: [] });
  assert.equal(editions.length, 1);
  assert.equal(calls.slice(before).filter(c => c.method !== 'GET').length, 0, 'only reads the second time');
});

test('save: a book with no ISBN and no edition is fine (work id only, no edition row); a book with no ids at all writes nothing', async () => {
  const works: Work[] = [{ id: 'w1', identifiers: {} }];
  const editions: Ed[] = [];
  const calls = fakeCatalog(works, editions);
  assert.deepEqual(await saveIdentityToCatalog('w1', { olWork: 'OL1W' }), { saved: ['olWork'], skipped: [] });
  assert.equal(editions.length, 0);
  calls.length = 0;
  assert.deepEqual(await saveIdentityToCatalog('w1', undefined), { saved: [], skipped: [] });
  assert.equal(calls.length, 0);
});

test('save: an ISBN already on another catalog book is reported and NOT moved or merged', async () => {
  const works: Work[] = [{ id: 'w1', identifiers: {} }, { id: 'w2', identifiers: {} }];
  const editions: Ed[] = [{ id: 'eX', work_id: 'w2', isbn13: G13, isbn10: null, openlibrary_edition_id: null, google_volume_id: null }];
  fakeCatalog(works, editions);
  const r = await saveIdentityToCatalog('w1', { isbn13: G13 });
  assert.deepEqual(r.saved, []);
  assert.match(r.skipped[0], /different catalog book/);
  assert.equal(editions.length, 1);
  assert.equal(editions[0].work_id, 'w2', 'the edition stays with its own book');
});

test('save: an Open Library work id that another catalog book has is refused by the database and reported; the work is unchanged', async () => {
  const works: Work[] = [{ id: 'w1', identifiers: {} }, { id: 'w2', identifiers: { olWork: 'OL9W' } }];
  fakeCatalog(works, []);
  const r = await saveIdentityToCatalog('w1', { olWork: 'OL9W' });
  assert.deepEqual(r.saved, []);
  assert.match(r.skipped[0], /another catalog book/);
  assert.deepEqual(works[0].identifiers, {});
});

test('save: a work that already has a different Open Library id keeps it (conflict reported; the only write is the unpublished alternateIds note)', async () => {
  const works: Work[] = [{ id: 'w1', identifiers: { olWork: 'OL1W' } }];
  const calls = fakeCatalog(works, []);
  const r = await saveIdentityToCatalog('w1', { olWork: 'OL2W' });
  assert.deepEqual(r.saved, []);
  assert.match(r.skipped[0], /already has Open Library id OL1W/);
  const writes = calls.filter(c => c.method !== 'GET');
  assert.ok(writes.every(c => c.path.startsWith('catalog_metadata_candidates') && c.body?.field_name === 'alternateIds' && c.body?.status === 'candidate'), 'no work or edition is changed');
});

test('save: an invalid ISBN is named and never written', async () => {
  const works: Work[] = [{ id: 'w1', identifiers: {} }];
  const editions: Ed[] = [];
  fakeCatalog(works, editions);
  const r = await saveIdentityToCatalog('w1', { isbn13: '9780743273566' });
  assert.deepEqual(r.saved, []);
  assert.deepEqual(r.skipped, ['identity:isbn13 not valid']);
  assert.equal(editions.length, 0);
});

test('save: a known edition of this book gets a newly learned id filled in; existing ids are left alone', async () => {
  const works: Work[] = [{ id: 'w1', identifiers: {} }];
  const editions: Ed[] = [{ id: 'e1', work_id: 'w1', isbn13: G13, isbn10: null, openlibrary_edition_id: null, google_volume_id: null }];
  fakeCatalog(works, editions);
  const r = await saveIdentityToCatalog('w1', { isbn13: G13, gbVolume: 'iXn5U2IzVH0C' });
  assert.deepEqual(r, { saved: ['edition'], skipped: [] });
  assert.equal(editions.length, 1);
  assert.deepEqual([editions[0].isbn13, editions[0].google_volume_id], [G13, 'iXn5U2IzVH0C']);
});
