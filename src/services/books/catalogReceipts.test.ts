// Run with: npm test
// Phase 2b: provider receipts (catalog_provider_records): created once, trimmed, linked to candidates, never moved or overwritten; owner-only persistence of provider facts.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { saveFactsToCatalog } from '../catalog';
import { receiptPayload, receiptRow, receiptSignature, saveProviderReceipts } from '../catalogReceipts';
import { flushProviderFacts, forgetProviderFactsForTests, providerFactsFor, rememberProviderFacts, setProviderFactsPersistence, type ProviderFacts } from './providerFacts';

type Rec = { id: string; provider: string; record_kind: string; provider_record_id: string; work_id: string | null; payload: unknown; refresh_after: string | null; match_status: string; [k: string]: unknown };
type Cand = { work_id: string; field_name: string; source_name: string; provider_record_id?: string; raw_value?: unknown; status: string; field_value: unknown };

function fake(receipts: Rec[] = [], cands: Cand[] = [], opts: { failRead?: boolean; raceOnPost?: boolean } = {}) {
  const calls: { method: string; table: string; query: string; body?: any }[] = [];
  (globalThis as any).fetch = async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const table = url.pathname.split('/').pop()!;
    calls.push({ method, table, query: url.search, body });
    const reply = (status: number, data: unknown) => ({ ok: status < 300, status, text: async () => (data === undefined ? '' : JSON.stringify(data)), json: async () => (status < 300 ? data : { message: String(data) }) });
    const q = url.searchParams; const eq = (k: string) => (q.get(k) || '').replace(/^eq\./, '');
    if (table === 'catalog_provider_records') {
      if (method === 'GET') { if (opts.failRead) throw new Error('offline'); return reply(200, receipts.filter(r => r.provider === eq('provider') && r.record_kind === eq('record_kind') && r.provider_record_id === eq('provider_record_id'))); }
      if (method === 'POST') {
        if (receipts.some(r => r.provider === body.provider && r.record_kind === body.record_kind && r.provider_record_id === body.provider_record_id)) return reply(409, 'duplicate key');
        if (opts.raceOnPost) { receipts.push({ id: 'rec-other', ...body, work_id: body.work_id }); opts.raceOnPost = false; return reply(409, 'duplicate key'); }
        const made = { id: `rec-${receipts.length + 1}`, ...body }; receipts.push(made); return reply(201, [made]);
      }
      if (method === 'PATCH') { Object.assign(receipts.find(r => r.id === eq('id'))!, body); return reply(204, undefined); }
    }
    if (table === 'catalog_metadata_candidates' && method === 'POST') { cands.push({ ...body }); return reply(201, undefined); }
    if (table === 'catalog_works' && method === 'GET') return reply(200, [{ genres: [], honors: [] }]);
    return reply(404, 'unexpected ' + method + ' ' + table);
  };
  return calls;
}

const NOW = new Date('2026-10-27T12:00:00Z');
const gf = (o: Partial<ProviderFacts> = {}): ProviderFacts => ({ provider: 'google', recordId: 'volGOOGLE1', publisher: 'Penguin', publishedDate: '2021-03-03', genres: ['Fiction'], authors: ['A', 'B'], pages: 320, language: 'en', seenAt: '2026-10-27T11:00:00Z', ...o });
const base = { id: 'gb_volGOOGLE1', identity: { gbVolume: 'volGOOGLE1' }, genre: 'Book' };

test('receipt rows are trimmed (no descriptions, no raw response), matched, and due for refresh in 90 days', () => {
  const row: any = receiptRow(gf({ sourceUrl: 'https://books.google.com/x', subjects: Array.from({ length: 60 }, (_, i) => `s${i}`) }), 'w1', NOW);
  assert.equal(row.payload_policy, 'trimmed');
  assert.equal(row.record_kind, 'volume');
  assert.equal(row.match_status, 'matched');
  assert.equal(row.payload.subjects.length, 40);
  assert.deepEqual(Object.keys(row.payload).sort(), ['authors', 'genres', 'language', 'pages', 'publishedDate', 'publisher', 'subjects']);
  assert.equal(row.refresh_after, '2027-01-25T11:00:00.000Z');
  assert.equal(row.source_url, 'https://books.google.com/x');
  assert.equal((receiptRow(gf({ sourceUrl: 'http://insecure' }), null, NOW) as any).source_url, undefined, 'only https links are kept');
  assert.equal((receiptRow(gf(), null, NOW) as any).match_status, 'unmatched');
  assert.equal((receiptRow(gf({ seenAt: '2099-01-01T00:00:00Z' }), 'w1', NOW) as any).fetched_at, NOW.toISOString(), 'a future timestamp is not trusted');
});

test('the signature changes only when what the provider said changes', () => {
  assert.equal(receiptSignature(gf()), receiptSignature(gf({ seenAt: '2030-01-01T00:00:00Z' })));
  assert.notEqual(receiptSignature(gf()), receiptSignature(gf({ pages: 321 })));
  assert.deepEqual(receiptPayload({ provider: 'apple', recordId: '1', seenAt: 'x' }), {});
});

test('a receipt is created once; saving again only reads (idempotent)', async () => {
  const receipts: Rec[] = [];
  const calls = fake(receipts);
  const r1 = await saveProviderReceipts('w1', [gf()], NOW);
  assert.equal(r1.created, 1); assert.equal(receipts.length, 1);
  const writes = calls.filter(c => c.method !== 'GET').length;
  const r2 = await saveProviderReceipts('w1', [gf()], NOW);
  assert.equal(r2.created, 0);
  assert.equal(calls.filter(c => c.method !== 'GET').length, writes, 'no second write');
  assert.equal(r2.ids.get('google:volGOOGLE1'), receipts[0].id);
});

test('an existing receipt with no work gets linked; one that belongs to another work is NOT moved and is flagged for review', async () => {
  const receipts: Rec[] = [
    { id: 'r-free', provider: 'google', record_kind: 'volume', provider_record_id: 'volFree', work_id: null, payload: {}, refresh_after: '2099-01-01T00:00:00Z', match_status: 'unmatched' },
    { id: 'r-taken', provider: 'apple', record_kind: 'listing', provider_record_id: '77', work_id: 'OTHER', payload: { a: 1 }, refresh_after: '2099-01-01T00:00:00Z', match_status: 'matched' },
  ];
  fake(receipts);
  const r = await saveProviderReceipts('w1', [gf({ recordId: 'volFree' }), { provider: 'apple', recordId: '77', seenAt: 'x', genres: ['Fiction'] }], NOW);
  assert.equal(receipts[0].work_id, 'w1'); assert.equal(receipts[0].match_status, 'matched');
  assert.equal(receipts[1].work_id, 'OTHER', 'never moved to another work');
  assert.equal(receipts[1].match_status, 'needs_review');
  assert.deepEqual(receipts[1].payload, { a: 1 }, 'payload of the other work\'s receipt untouched');
  assert.ok(r.skipped.some(x => /another catalog book/.test(x)));
});

test('a fresh receipt of the same work is left alone; an expired one is refreshed, work link unchanged', async () => {
  const fresh: Rec = { id: 'r1', provider: 'google', record_kind: 'volume', provider_record_id: 'volGOOGLE1', work_id: 'w1', payload: { old: true }, refresh_after: '2027-01-01T00:00:00Z', match_status: 'matched' };
  const receipts = [fresh]; const calls = fake(receipts);
  await saveProviderReceipts('w1', [gf()], NOW);
  assert.equal(calls.filter(c => c.method === 'PATCH').length, 0);
  fresh.refresh_after = '2026-10-01T00:00:00Z';
  await saveProviderReceipts('w1', [gf()], NOW);
  assert.equal((fresh.payload as any).publisher, 'Penguin');
  assert.equal(fresh.work_id, 'w1');
});

test('another device writing the same receipt first (409) is treated as existing, not an error', async () => {
  const receipts: Rec[] = [];
  fake(receipts, [], { raceOnPost: true });
  const r = await saveProviderReceipts('w1', [gf()], NOW);
  assert.equal(r.skipped.length, 0);
  assert.equal(r.ids.get('google:volGOOGLE1'), 'rec-other');
});

test('offline: nothing is written and the caller is told to retry', async () => {
  fake([], [], { failRead: true });
  const r = await saveProviderReceipts('w1', [gf()], NOW);
  assert.equal(r.retry, true); assert.equal(r.created, 0);
});

test('Save to catalog: candidates point at their receipt and keep the original value; saving twice adds no second receipt', async () => {
  const receipts: Rec[] = []; const cands: Cand[] = [];
  fake(receipts, cands);
  const r = await saveFactsToCatalog('w1', base, [gf()]);
  assert.equal(receipts.length, 1);
  assert.ok(r.saved.some(s => s.startsWith('provider receipts')));
  assert.ok(cands.length >= 5 && cands.every(c => c.provider_record_id === receipts[0].id && c.status === 'candidate' && c.source_name === 'google'));
  assert.deepEqual(cands.find(c => c.field_name === 'providerAuthors')!.raw_value, ['A', 'B']);
  await saveFactsToCatalog('w1', base, [gf()]);
  assert.equal(receipts.length, 1);
});

test('a receipt failure never blocks the rest, and a network failure sets retry', async () => {
  const cands: Cand[] = [];
  fake([], cands, { failRead: true });
  const r = await saveFactsToCatalog('w1', base, [gf()]);
  assert.equal(r.retry, true);
});

/* ---------- facts kept on the owner's device ---------- */

test('provider facts survive a reload only on the owner device', () => {
  store.clear(); forgetProviderFactsForTests();
  setProviderFactsPersistence(() => false); // not the owner
  rememberProviderFacts({ provider: 'google', recordId: 'vol1', publisher: 'X' }); flushProviderFacts();
  assert.equal(store.get('readlife.providerfacts1'), undefined, 'nothing is stored for a non-owner');

  forgetProviderFactsForTests();
  setProviderFactsPersistence(() => true); // owner
  rememberProviderFacts({ provider: 'google', recordId: 'vol1', publisher: 'X', genres: ['Fiction'] }); flushProviderFacts();
  assert.ok(store.get('readlife.providerfacts1'));

  forgetProviderFactsForTests(); // "reload": memory is empty again
  assert.equal(providerFactsFor({ identity: { gbVolume: 'vol1' } }).length, 0, 'not owner yet: nothing loaded');
  setProviderFactsPersistence(() => true);
  const f = providerFactsFor({ identity: { gbVolume: 'vol1' } });
  assert.equal(f.length, 1); assert.equal(f[0].publisher, 'X');
});

test('stored facts: junk is ignored, and what was seen this session wins over what was stored', () => {
  forgetProviderFactsForTests();
  store.set('readlife.providerfacts1', JSON.stringify([{ provider: 'google', recordId: 'v9', publisher: 'OLD', seenAt: 'x' }, { provider: 'amazon', recordId: 'z' }, 5, null, { provider: 'apple' }]));
  setProviderFactsPersistence(() => true);
  rememberProviderFacts({ provider: 'google', recordId: 'v9', publisher: 'NEW' });
  const f = providerFactsFor({ identity: { gbVolume: 'v9' } });
  assert.deepEqual(f.map(x => x.publisher), ['NEW']);
  assert.equal(providerFactsFor({ id: 'apple_1' }).length, 0);
  forgetProviderFactsForTests(); store.set('readlife.providerfacts1', '{not json');
  setProviderFactsPersistence(() => true);
  assert.deepEqual(providerFactsFor({ identity: { gbVolume: 'v9' } }), [], 'unreadable storage = start empty');
  forgetProviderFactsForTests(); store.clear();
});
