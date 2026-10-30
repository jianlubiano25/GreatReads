// Run with: npm test
// Phase 1 write path of "Save to catalog": saveFactsToCatalog against an in-memory fake of the catalog tables, plus the provider-facts memory the adapters fill.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { saveFactsToCatalog } from '../catalog';
import { forgetProviderFactsForTests, providerFactsFor, rememberProviderFacts, type ProviderFacts } from './providerFacts';
import { gbItemToHit } from './sources/googleBooks';
import { olDocToHit } from './sources/openLibrary';

type Work = { id: string; genres: string[]; honors: string[] };
type Ed = { id: string; work_id: string; google_volume_id: string | null; publisher: string | null; publication_date: string | null; publication_year: number | null; page_count: number | null; language_code: string | null; format: string | null };
type Cand = { work_id: string; field_name: string; field_value: unknown; source_name: string; status: string };

function fake(works: Work[], editions: Ed[], cands: Cand[] = []) {
  const calls: { method: string; table: string; query: string; body?: any }[] = [];
  (globalThis as any).fetch = async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const table = url.pathname.split('/').pop()!;
    calls.push({ method, table, query: url.search, body });
    const reply = (status: number, data: unknown) => ({ ok: status < 300, status, text: async () => (data === undefined ? '' : JSON.stringify(data)), json: async () => (status < 300 ? data : { message: String(data) }) });
    const q = url.searchParams;
    const eq = (k: string) => (q.get(k) || '').replace(/^eq\./, '');
    if (table === 'catalog_works') {
      const w = works.find(x => x.id === eq('id'));
      if (method === 'GET') return reply(200, w ? [{ genres: w.genres, honors: w.honors }] : []);
      if (method === 'PATCH') { Object.assign(w!, body); return reply(204, undefined); }
    }
    if (table === 'catalog_metadata_candidates' && method === 'POST') {
      if (cands.some(c => c.work_id === body.work_id && c.field_name === body.field_name && c.source_name === body.source_name && JSON.stringify(c.field_value) === JSON.stringify(body.field_value))) return reply(409, 'duplicate key');
      cands.push({ work_id: body.work_id, field_name: body.field_name, field_value: body.field_value, source_name: body.source_name, status: body.status });
      return reply(201, undefined);
    }
    if (table === 'catalog_editions') {
      if (method === 'GET') return reply(200, editions.filter(e => e.work_id === eq('work_id') && e.google_volume_id === eq('google_volume_id')));
      if (method === 'PATCH') { Object.assign(editions.find(e => e.id === eq('id'))!, body); return reply(204, undefined); }
    }
    return reply(404, 'unexpected ' + method + ' ' + table);
  };
  return calls;
}

const ed = (o: Partial<Ed> = {}): Ed => ({ id: 'e1', work_id: 'w1', google_volume_id: 'volGOOGLE1', publisher: null, publication_date: null, publication_year: null, page_count: null, language_code: null, format: null, ...o });
const gFacts = (o: Partial<ProviderFacts> = {}): ProviderFacts => ({ provider: 'google', recordId: 'volGOOGLE1', publisher: 'Penguin', publishedDate: '2021-03-03', genres: ['Fiction / Fantasy'], pages: 320, language: 'en', authors: ['T. Kingfisher', 'Co Author'], seenAt: 'x', ...o });
const base = { id: 'gb_volGOOGLE1', identity: { gbVolume: 'volGOOGLE1' } };

test('a shelf name is filed under honors and never as a genre; real genres are appended', async () => {
  const works: Work[] = [{ id: 'w1', genres: [], honors: [] }];
  fake(works, []);
  const r = await saveFactsToCatalog('w1', { ...base, genre: "Reese's Book Club", awardLabel: "Reese's Book Club - Jan 2026" }, [gFacts({ publisher: undefined, pages: undefined })]);
  assert.deepEqual(works[0].genres, ['Fiction', 'Fantasy']);
  assert.deepEqual(works[0].honors, ["Reese's Book Club - Jan 2026", "Reese's Book Club"]);
  assert.ok(r.saved.includes('genres') && r.saved.includes('honors'));
});

test('existing genres and honors are never removed, reordered or duplicated; saving twice writes nothing new', async () => {
  const works: Work[] = [{ id: 'w1', genres: ['Fantasy', 'Mystery'], honors: ['Prize winner'] }];
  const calls = fake(works, []);
  await saveFactsToCatalog('w1', { ...base, genre: 'fantasy', awardLabel: 'prize winner' }, []);
  assert.deepEqual(works[0], { id: 'w1', genres: ['Fantasy', 'Mystery'], honors: ['Prize winner'] });
  assert.equal(calls.filter(c => c.method !== 'GET').length, 0, 'only reads when nothing is new');
});

test('provider facts are kept as UNPUBLISHED candidates with their source; the same save twice adds no duplicates', async () => {
  const cands: Cand[] = [];
  fake([{ id: 'w1', genres: [], honors: [] }], [], cands);
  const r1 = await saveFactsToCatalog('w1', { ...base, genre: 'Fiction' }, [gFacts()]);
  assert.ok(cands.length >= 6);
  assert.ok(cands.every(c => c.status === 'candidate' && c.source_name === 'google'), 'never published, source is the provider');
  assert.deepEqual(cands.find(c => c.field_name === 'providerAuthors')!.field_value, ['T. Kingfisher', 'Co Author'], 'every author kept, not only the first');
  assert.ok(r1.saved.some(s => s.startsWith('provider facts (')));
  const n = cands.length;
  await saveFactsToCatalog('w1', { ...base, genre: 'Fiction' }, [gFacts()]);
  assert.equal(cands.length, n);
});

test('edition details: only the empty columns of the edition with this exact Google volume are filled', async () => {
  const editions = [ed({ publisher: 'Tor' })];
  fake([{ id: 'w1', genres: [], honors: [] }], editions);
  const r = await saveFactsToCatalog('w1', { ...base, genre: 'Book' }, [gFacts()]);
  assert.equal(editions[0].publisher, 'Tor', 'a filled value is not overwritten');
  assert.deepEqual([editions[0].publication_date, editions[0].publication_year, editions[0].page_count, editions[0].language_code], ['2021-03-03', 2021, 320, 'en']);
  assert.ok(r.saved.includes('edition details'));
  assert.ok(r.skipped.some(s => /publisher/.test(s) && /kept both/.test(s)), 'the disagreement is reported');
});

test('edition details: no edition with that volume id, or an edition of another work, is left alone', async () => {
  const other = [ed({ work_id: 'OTHER' }), ed({ id: 'e2', google_volume_id: 'differentVol' })];
  fake([{ id: 'w1', genres: [], honors: [] }], other);
  await saveFactsToCatalog('w1', { ...base, genre: 'Book' }, [gFacts()]);
  assert.ok(other.every(e => e.publisher === null && e.page_count === null));
});

test('only Google facts reach edition columns; Apple and Open Library facts become candidates only', async () => {
  const editions = [ed()];
  const cands: Cand[] = [];
  fake([{ id: 'w1', genres: [], honors: [] }], editions, cands);
  await saveFactsToCatalog('w1', { id: 'apple_77', genre: 'Fiction' }, [{ provider: 'apple', recordId: '77', publishedDate: '2021-03-03T08:00:00Z', genres: ['Mysteries & Thrillers'], seenAt: 'x' }, { provider: 'openlibrary', recordId: 'OL1W', subjects: ['Dragons', 'Fantasy'], altAuthorNames: ['Ursula Vernon'], seenAt: 'x' }]);
  assert.equal(editions[0].publication_date, null);
  assert.ok(cands.some(c => c.source_name === 'apple' && c.field_name === 'providerRecord'));
  assert.deepEqual(cands.find(c => c.field_name === 'altAuthorNames')!.field_value, ['Ursula Vernon']);
});

test('Open Library subjects are never turned into genres; Apple genres are', async () => {
  const works: Work[] = [{ id: 'w1', genres: [], honors: [] }];
  fake(works, []);
  await saveFactsToCatalog('w1', { id: 'x', genre: 'Book' }, [{ provider: 'openlibrary', recordId: 'OL1W', subjects: ['Romance', 'Horror'], seenAt: 'x' }]);
  assert.deepEqual(works[0].genres, []);
  await saveFactsToCatalog('w1', { id: 'x', genre: 'Book' }, [{ provider: 'apple', recordId: '1', genres: ['Mysteries & Thrillers'], seenAt: 'x' }]);
  assert.deepEqual(works[0].genres, ['Mystery', 'Thriller']);
});

test('safety: the fill step never deletes, never touches personal tables, never publishes', async () => {
  const calls = fake([{ id: 'w1', genres: [], honors: [] }], [ed()]);
  await saveFactsToCatalog('w1', { ...base, genre: 'Prize winner', awardLabel: 'Booker 2025' }, [gFacts()]);
  assert.ok(calls.every(c => c.method !== 'DELETE'));
  assert.ok(calls.every(c => /^catalog_(works|editions|metadata_candidates|provider_records)$/.test(c.table)), 'no user_* or rpc calls');
  assert.ok(calls.filter(c => c.table === 'catalog_metadata_candidates').every(c => c.body.status === 'candidate'));
});

test('a failed read writes nothing and is reported, not thrown', async () => {
  (globalThis as any).fetch = async () => { throw new Error('offline'); };
  const r = await saveFactsToCatalog('w1', { ...base, genre: 'Fantasy' }, []);
  assert.deepEqual(r.saved, []);
  assert.ok(r.skipped.length > 0);
});

/* ---------- the memory the adapters fill ---------- */

test('adapters note provider facts in memory; they are found again by the ids a book carries', () => {
  forgetProviderFactsForTests();
  gbItemToHit({ id: 'volGOOGLE1', volumeInfo: { title: 'Nettle & Bone', authors: ['T. Kingfisher', 'Second'], publisher: 'Tor', publishedDate: '2022-04-26', categories: ['Fiction'], pageCount: 250, language: 'en' } });
  olDocToHit({ key: '/works/OL123W', title: 'Nettle & Bone', author_name: ['Ursula Vernon'], author_alternative_name: ['T. Kingfisher'], subject: ['Dragons', 'Fantasy'], language: ['eng'] });
  const g = providerFactsFor({ id: 'lib-1', identity: { gbVolume: 'volGOOGLE1', olWork: 'OL123W' } });
  assert.deepEqual(g.map(f => f.provider).sort(), ['google', 'openlibrary']);
  const gf = g.find(f => f.provider === 'google')!;
  assert.deepEqual([gf.publisher, gf.publishedDate, gf.pages, gf.authors?.length], ['Tor', '2022-04-26', 250, 2]);
  assert.deepEqual(g.find(f => f.provider === 'openlibrary')!.altAuthorNames, ['T. Kingfisher']);
  assert.deepEqual(providerFactsFor({ id: 'nothing' }), []);
});

test('the facts memory is bounded and holds nothing after a reset', () => {
  forgetProviderFactsForTests();
  for (let i = 0; i < 400; i++) rememberProviderFacts({ provider: 'apple', recordId: String(i), genres: ['Fiction'] });
  assert.equal(providerFactsFor({ id: 'apple_0' }).length, 0, 'oldest dropped');
  assert.equal(providerFactsFor({ id: 'apple_399' }).length, 1);
  forgetProviderFactsForTests();
  assert.equal(providerFactsFor({ id: 'apple_399' }).length, 0);
});
