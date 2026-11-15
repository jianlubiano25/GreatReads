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
