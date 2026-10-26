// Run with: npm test
// Owner-only capture also records each book's outside ids (work + edition) like Save to catalog: once per book, retried only after a failed request,
// invalid / conflicting ids reported and never written.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
store.set('readlife.sb1', JSON.stringify({ access: 'a', refresh: 'r', exp: Date.now() + 3600_000, user: { id: 'u1', email: 'me@example.com' } }));

const T = ['catalog_works', 'catalog_cover_candidates', 'catalog_content_versions', 'catalog_metadata_candidates', 'catalog_rating_candidates', 'catalog_editions'] as const;
const rows: Record<string, any[]> = Object.fromEntries(T.map(t => [t, []]));
let failEditionReads = false;
let calls: { method: string; table: string; query: string; body?: any }[] = [];
(globalThis as any).fetch = async (input: string, init: any = {}) => {
  const url = new URL(input);
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : undefined;
  const res = (b: unknown, status = 200) => new Response(b === null || b === undefined ? null : JSON.stringify(b), { status });
  if (url.pathname.includes('/rpc/catalog_is_admin')) return res(true);
  if (url.pathname.includes('/rpc/')) return res(0);
  const table = url.pathname.split('/').pop()!;
  calls.push({ method, table, query: url.search, body });
  const q = url.searchParams;
  if (method === 'GET') {
    if (table === 'catalog_works') {
      const id = q.get('id')?.replace('eq.', '');
      return res(id ? rows.catalog_works.filter(w => w.id === id).map(w => ({ identifiers: w.identifiers })) : rows.catalog_works.map(w => ({ id: w.id, work_key: w.work_key })));
    }
    if (table === 'catalog_editions') {
      if (failEditionReads) return res({ message: 'server error' }, 500);
      const clauses = q.get('or')!.slice(1, -1).split(',').map(c => c.split('.eq.'));
      return res(rows.catalog_editions.filter(e => clauses.some(([k, v]) => e[k] === v)));
    }
    return res([]);
  }
  if (method === 'POST') {
    const list = Array.isArray(body) ? body : [body];
    for (const r of list) {
      if (table === 'catalog_works' && rows[table].some(x => x.work_key === r.work_key)) return res({ message: 'dup' }, 409);
      if (table === 'catalog_editions' && ['isbn13', 'openlibrary_edition_id', 'google_volume_id'].some(k => r[k] && rows[table].some(x => x[k] === r[k]))) return res({ message: 'dup' }, 409);
    }
    const made = list.map((r: any) => ({ id: `${table}-${rows[table].length + 1}`, identifiers: {}, ...r }));
    rows[table].push(...made);
    return res(made, 201);
  }
  if (method === 'PATCH' && table === 'catalog_works') {
    const id = q.get('id')!.replace('eq.', '');
    const ol = body.identifiers?.olWork;
    if (ol && rows.catalog_works.some(w => w.id !== id && w.identifiers?.olWork === ol)) return res({ message: 'dup' }, 409);
    rows.catalog_works.find(w => w.id === id).identifiers = body.identifiers;
    return res(null, 204);
  }
  if (method === 'PATCH' && table === 'catalog_editions') { Object.assign(rows.catalog_editions.find(e => e.id === q.get('id')!.replace('eq.', '')), body); return res(null, 204); }
  return res({ message: 'not expected' }, 405);
};

const sb = await import('./supabase');
const cap = await import('./capture');
await sb.checkAdmin();

const idle = async () => { for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 50)); const s = cap.captureStatus(); if (!s.running && !s.queued) return; } };
const reset = () => { for (const t of T) rows[t].length = 0; calls = []; failEditionReads = false; cap.resetCaptureForTests(); };
const G13 = '9780743273565';
const book = (over: object = {}) => ({ title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', identity: { olWork: 'OL468431W', olEdition: 'OL7353617M', isbn13: G13 }, ...over });

test('a captured book gets its Open Library work id and an edition row with its ISBN', async () => {
  reset();
  cap.captureBook(book());
  await idle();
  assert.equal(rows.catalog_works.length, 1);
  assert.equal(rows.catalog_works[0].identifiers.olWork, 'OL468431W');
  assert.equal(rows.catalog_editions.length, 1);
  assert.equal(rows.catalog_editions[0].isbn13, G13);
  assert.equal(rows.catalog_editions[0].work_id, rows.catalog_works[0].id);
  assert.equal(rows.catalog_editions[0].status, 'published');
});

test('ids are sent once: the same book again makes no request; a fresh device adds no duplicate', async () => {
  const before = calls.length;
  cap.captureBook(book());
  await idle();
  assert.equal(calls.length, before, 'already judged: nothing asked');
  cap.resetCaptureForTests(); // a device that does not remember
  cap.captureBook(book());
  await idle();
  assert.equal(rows.catalog_editions.length, 1);
  assert.equal(rows.catalog_works.length, 1);
});

test('a book with no ids (or only an invalid ISBN) touches no edition and no identifier', async () => {
  reset();
  cap.captureBook({ title: 'No Ids Book', author: 'A Writer', summary: 'A long enough description of the book to be worth keeping, definitely over forty characters.' });
  cap.captureBook({ title: 'Bad Isbn Book', author: 'A Writer', summary: 'Another long enough description of the book to be worth keeping, over forty characters too.', identity: { isbn13: '9780743273566' } });
  await idle();
  assert.equal(rows.catalog_editions.length, 0);
  assert.ok(rows.catalog_works.every(w => !w.identifiers.olWork));
  assert.ok(!calls.some(c => c.table === 'catalog_editions'));
});

test('a failed request is retried next time; a judged id is not', async () => {
  reset();
  failEditionReads = true;
  cap.captureBook(book());
  await idle();
  assert.equal(rows.catalog_editions.length, 0, 'server error: nothing written');
  failEditionReads = false;
  cap.captureBook(book());
  await idle();
  assert.equal(rows.catalog_editions.length, 1, 'asked again and saved');
});

test('an ISBN already on another catalog book is reported to the owner and not moved; it is not asked again', async () => {
  reset();
  rows.catalog_works.push({ id: 'other', work_key: 'someone else|x', identifiers: {} });
  rows.catalog_editions.push({ id: 'ed0', work_id: 'other', isbn13: G13, isbn10: null, openlibrary_edition_id: null, google_volume_id: null });
  cap.captureBook(book());
  await idle();
  assert.equal(rows.catalog_editions.length, 1);
  assert.equal(rows.catalog_editions[0].work_id, 'other', 'the edition stays with its own book');
  const st = cap.captureStatus();
  assert.equal(st.idSkipped, 1);
  assert.match(st.idNotes![0], /The Great Gatsby/);
  const before = calls.length;
  cap.captureBook(book());
  await idle();
  assert.equal(calls.length, before, 'a judged conflict is not asked again');
});

test('the same Open Library work id on two catalog books: the second is refused and reported, the first is untouched', async () => {
  reset();
  rows.catalog_works.push({ id: 'first', work_key: 'first|a', identifiers: { olWork: 'OL468431W' } });
  cap.captureBook(book());
  await idle();
  assert.equal(rows.catalog_works.find(w => w.id === 'first')!.identifiers.olWork, 'OL468431W');
  const mine = rows.catalog_works.find(w => w.id !== 'first')!;
  assert.equal(mine.identifiers.olWork, undefined);
  assert.ok(cap.captureStatus().idSkipped! >= 1);
});

test('publishing a cover from the cover dialog records the same ids as Save to catalog', async () => {
  reset();
  const { publishCoverToCatalog } = await import('./catalog');
  const r = await publishCoverToCatalog(book(), 'https://is1-ssl.mzstatic.com/a/600x900bb.jpg');
  assert.equal(r.ok, true);
  assert.deepEqual(r.ids, { saved: ['olWork', 'edition'], skipped: [] });
  assert.equal(rows.catalog_works[0].identifiers.olWork, 'OL468431W');
  assert.equal(rows.catalog_editions[0].isbn13, G13);
  assert.equal(rows.catalog_cover_candidates.length, 1);
  // a book the device does not hold (no ids) still publishes its cover and simply has no ids
  const plain = await publishCoverToCatalog({ title: 'Unknown Ids', author: 'Someone' }, 'https://is1-ssl.mzstatic.com/b/600x900bb.jpg');
  assert.equal(plain.ok, true);
  assert.deepEqual(plain.ids, { saved: [], skipped: [] });
  assert.equal(rows.catalog_editions.length, 1);
});
