import test from 'node:test';
import assert from 'node:assert/strict';
import { groupTerms, type TermRow } from './catalogTermReview';

const row = (id: string, status: TermRow['status'], source: string, kind: string, name: string, raw: string | null = null): TermRow => ({ id, status, source, raw_label: raw, term: { kind, name } });

test('terms are grouped per term with every source and label; approved first, then candidates, then rejected', () => {
  const g = groupTerms([row('1', 'candidate', 'openlibrary', 'subject', 'Friendship', 'Friendship, fiction'), row('2', 'candidate', 'hardcover', 'subject', 'Friendship', 'friendship'), row('3', 'approved', 'app', 'genre', 'Mystery'), row('4', 'rejected', 'google', 'collection', 'Prize winner', 'x')]);
  assert.deepEqual(g.map(x => x.name), ['Mystery', 'Friendship', 'Prize winner']);
  const f = g[1];
  assert.deepEqual(f.ids, ['1', '2']);
  assert.deepEqual(f.sources, ['openlibrary', 'hardcover']);
  assert.deepEqual(f.labels, ['Friendship, fiction', 'friendship']);
  assert.equal(f.status, 'candidate');
});

test('one approved row makes the term approved; a row with no term is ignored', () => {
  const g = groupTerms([row('1', 'candidate', 'apple', 'genre', 'Fantasy'), row('2', 'approved', 'owner', 'genre', 'Fantasy'), { id: '3', status: 'candidate', source: 'apple', raw_label: null, term: null }]);
  assert.equal(g.length, 1);
  assert.equal(g[0].status, 'approved');
});
