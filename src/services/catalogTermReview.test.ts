import test from 'node:test';
import assert from 'node:assert/strict';
import { toItems, type AwardRow, type LabelRow, type TermRow } from './catalogTermReview';

const term = (id: string, status: TermRow['status'], source: string, kind: string, name: string, raw: string | null = null): TermRow => ({ id, status, source, raw_label: raw, term: { kind, name } });
const label = (id: string, status: LabelRow['status'], source: string, text: string, term_id: string | null = null): LabelRow => ({ id, status, source, label: text, term_id });
const award = (id: string, name: string, year: number | null, result = 'won', status: AwardRow['status'] = 'candidate'): AwardRow => ({ id, status, source: 'openlibrary', raw_label: null, award_year: year, result, award: { name } });

test('everything suggested for a book lands in plain sections, in order, one item per thing with every source and label', () => {
  const items = toItems(
    [term('1', 'candidate', 'openlibrary', 'subject', 'Friendship', 'Friendship, fiction'), term('2', 'candidate', 'hardcover', 'subject', 'Friendship', 'friendship'), term('3', 'approved', 'app', 'genre', 'Mystery'), term('4', 'candidate', 'openlibrary', 'collection', 'New York Times bestseller'), term('5', 'candidate', 'apple', 'subgenre', 'Domestic thriller')],
    [label('l1', 'candidate', 'google', 'Large type books'), label('l2', 'candidate', 'google', 'Mystery', 'some-term-id')],
    [award('a1', 'Hugo Award', 2026), award('a2', 'Booker Prize', 2024, 'shortlisted')],
  );
  assert.deepEqual(items.map(i => `${i.section}: ${i.name}`), ['Genres: Mystery', 'Subgenres: Domestic thriller', 'Subjects & themes: Friendship', 'Collections: New York Times bestseller', 'Keywords & tags: Large type books', 'Awards & honors: Booker Prize 2024 (shortlisted)', 'Awards & honors: Hugo Award 2026']);
  const f = items.find(i => i.name === 'Friendship')!;
  assert.deepEqual(f.ids, ['1', '2']);
  assert.deepEqual(f.sources, ['openlibrary', 'hardcover']);
  assert.deepEqual(f.labels, ['Friendship, fiction']);
  assert.equal(f.table, 'catalog_work_terms');
  assert.equal(items.find(i => i.name === 'Large type books')!.table, 'catalog_work_labels');
});

test('one approved row makes the item approved; a label that already has a vocabulary term is reviewed as that term, not twice', () => {
  const items = toItems([term('1', 'candidate', 'apple', 'genre', 'Fantasy'), term('2', 'approved', 'owner', 'genre', 'Fantasy')], [label('l1', 'candidate', 'apple', 'Fantasy', 't1')], []);
  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'approved');
});

import { countByStatus, setItemsStatus, STATUS_LABEL } from './catalogTermReview';

test('owner wording and counts: approved = Published, candidate = Not reviewed', () => {
  assert.equal(STATUS_LABEL.approved, 'Published');
  assert.equal(STATUS_LABEL.candidate, 'Not reviewed');
  const items = toItems([term('1', 'approved', 'app', 'genre', 'Mystery'), term('2', 'candidate', 'apple', 'subject', 'Murder'), term('3', 'rejected', 'google', 'subject', 'Suburbs')], [], []);
  assert.deepEqual(countByStatus(items), { approved: 1, candidate: 1, rejected: 1 });
});

test('publishing several items at once sends one request per table and reports a failure', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  store.set('readlife.sb1', JSON.stringify({ access: 'a', refresh: 'r', exp: Date.now() + 3600_000, user: { id: 'u1', email: 'me@example.com' } }));
  let fail = false;
  (globalThis as any).fetch = async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return fail ? new Response('{"message":"no"}', { status: 403 }) : new Response(null, { status: 204 }); };
  const r = await setItemsStatus([{ table: 'catalog_work_terms', ids: ['t1', 't2'] }, { table: 'catalog_work_terms', ids: ['t3'] }, { table: 'catalog_work_labels', ids: ['l1'] }], 'approved');
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2, 'one PATCH per table');
  assert.ok(calls[0].url.includes('catalog_work_terms?id=in.(t1,t2,t3)'));
  assert.deepEqual(calls[1].body, { status: 'approved' });
  fail = true;
  assert.equal((await setItemsStatus([{ table: 'catalog_work_awards', ids: ['a1'] }], 'rejected')).ok, false);
});
