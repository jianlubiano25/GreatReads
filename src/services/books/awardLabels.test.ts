import test from 'node:test';
import assert from 'node:assert/strict';
import { awardFromLabel as a } from './awardLabels';

test('award labels become a named award, year and result', () => {
  assert.deepEqual(a('Hugo Award winner'), { name: 'Hugo Award', slug: 'hugo-award', year: null, result: 'won' });
  assert.deepEqual(a('award:pulitzer_prize=1932'), { name: 'Pulitzer Prize', slug: 'pulitzer-prize', year: 1932, result: 'won' });
  assert.equal(a('award:hugo_award=novella')!.year, null);
  assert.equal(a('Newbery Honor Book')!.name, 'Newbery Honor');
  assert.equal(a('Newbery Honor Book')!.result, 'shortlisted');
  assert.equal(a('Newbery Medal Books')!.name, 'Newbery Medal');
  assert.equal(a('National Book Awards longlist')!.result, 'nominated');
  assert.equal(a('National Book Awards longlist')!.name, 'National Book Award');
  assert.equal(a('Women’s Prize for Fiction winner')!.name, 'Women’s Prize for Fiction');
  assert.equal(a('Nobel Prize for Literature laureate')!.name, 'Nobel Prize for Literature');
});

test('lists, clubs and unrelated words are not awards', () => {
  for (const x of ['New York Times bestseller', 'Award winning books', 'Devotional medals', 'Carnegie, Andrew, 1835-1919', 'Book clubs (discussion groups)', 'Fantasy', '']) assert.equal(a(x), null, x);
});

import { saveAwardRows } from '../catalogTerms';
test('saveAwardRows keeps each award once as a candidate row with its provider', async () => {
  const calls: { path: string; method?: string; body: any }[] = [];
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = async (u: string, init: any = {}) => {
    const path = String(u).split('/rest/v1/')[1] || ''; calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    if (path.startsWith('catalog_awards?select')) return new Response(JSON.stringify([{ id: 'a1', slug: 'hugo-award' }]), { status: 200 });
    return new Response('', { status: 201 });
  };
  try {
    const r = await saveAwardRows('w1', [{ provider: 'openlibrary', recordId: 'OL1W', genres: ['Hugo Award winner'], subjects: ['award:hugo_award=1966', 'Space'], seenAt: 'x' }], new Map([['openlibrary:OL1W', 'rec1']]));
    assert.equal(r.kept, 2);
    const posts = calls.filter(c => c.path === 'catalog_work_awards');
    assert.deepEqual(posts.map(p => p.body.award_year).sort(), [1966, null]);
    assert.ok(posts.every(p => p.body.status === 'candidate' && p.body.source === 'openlibrary' && p.body.provider_record_id === 'rec1'));
  } finally { (globalThis as any).fetch = realFetch; }
});

import { storedClassification, resetClassificationForTests } from '../catalog';
test('storedClassification reads the work\'s labels, terms and awards and groups them by term kind', async () => {
  resetClassificationForTests();
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = async (u: string) => {
    const path = String(u).split('/rest/v1/')[1] || '';
    if (path.startsWith('catalog_works?work_key')) return new Response(JSON.stringify([{ id: 'w1', status: 'published', identifiers: {} }]), { status: 200 });
    if (path.startsWith('catalog_work_labels')) return new Response(JSON.stringify([{ label: 'Desert planets', source: 'openlibrary', catalog_terms: null }, { label: 'Fantasy fiction', source: 'openlibrary', catalog_terms: { kind: 'genre', name: 'Fantasy' } }]), { status: 200 });
    if (path.startsWith('catalog_work_terms')) return new Response(JSON.stringify([{ source: 'hardcover', catalog_terms: { kind: 'subgenre', name: 'Epic fantasy' } }]), { status: 200 });
    if (path.startsWith('catalog_work_awards')) return new Response(JSON.stringify([{ award_year: 1966, source: 'openlibrary', catalog_awards: { name: 'Hugo Award' } }]), { status: 200 });
    return new Response('[]', { status: 200 });
  };
  try {
    const v = await storedClassification({ title: 'Dune Test Book', author: 'Frank Herbert' });
    assert.deepEqual(v.labels.map(l => `${l.group}:${l.label}`).sort(), ['Genres:Fantasy', 'Keywords & tags:Desert planets', 'Subgenres:Epic fantasy']);
    assert.deepEqual(v.awards, [{ label: 'Hugo Award 1966', source: 'openlibrary' }]);
  } finally { (globalThis as any).fetch = realFetch; resetClassificationForTests(); }
});
