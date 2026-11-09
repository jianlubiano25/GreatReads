import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLabelsToTerms, type Vocab } from './catalogTerms';

const T = (id: string, kind: string, name: string) => ({ id, kind, name, slug: name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-') });
const vocab: Vocab = {
  terms: [T('g-fic', 'genre', 'Fiction'), T('g-rom', 'genre', 'Romance'), T('g-sf', 'genre', 'Science fiction'), T('g-nf', 'genre', 'Non-fiction'), T('g-fan', 'genre', 'Fantasy'),
    T('s-rc', 'subgenre', 'Romantic comedy'), T('s-dys', 'subgenre', 'Dystopian'), T('s-myth', 'subject', 'Mythology'), T('s-pol', 'subject', 'Politics')],
  aliases: [
    { source: 'any', label_norm: 'romcom', term_id: 's-rc', requires_genre: 'Fiction', implies_genre: 'Romance' },
    { source: 'any', label_norm: 'dystopian', term_id: 's-dys', requires_genre: 'Fiction', implies_genre: 'Science fiction' },
    { source: 'any', label_norm: 'myth', term_id: 's-myth', requires_genre: 'Fiction', implies_genre: 'Fantasy' },
    { source: 'any', label_norm: 'political science', term_id: 's-pol', requires_genre: null, implies_genre: 'Non-fiction' },
    { source: 'hardcover', label_norm: 'speculative', term_id: 's-dys', requires_genre: null, implies_genre: null },
  ],
};
const ids = (r: { term_id: string }[]) => r.map(x => x.term_id).sort();

test('an alias applies only when the work already has the genre it requires; then it also adds the implied genre', () => {
  assert.deepEqual(ids(mapLabelsToTerms('apple', ['Romcom'], ['Fiction'], vocab)), ['g-rom', 's-rc']);
  assert.deepEqual(mapLabelsToTerms('apple', ['Romcom'], ['Non-fiction'], vocab), [], 'context does not agree: nothing');
  assert.deepEqual(ids(mapLabelsToTerms('google', ['Myth'], ['Fiction'], vocab)), ['g-fan', 's-myth']);
  assert.deepEqual(mapLabelsToTerms('google', ['Myth'], [], vocab), []);
});

test('an alias with no requirement applies, and a provider-specific alias applies to that provider only', () => {
  assert.deepEqual(ids(mapLabelsToTerms('openlibrary', ['Political Science'], [], vocab)), ['g-nf', 's-pol']);
  assert.deepEqual(ids(mapLabelsToTerms('hardcover', ['Speculative'], [], vocab)), ['s-dys']);
  assert.deepEqual(mapLabelsToTerms('apple', ['Speculative'], [], vocab), []);
});

test('with no alias a label that IS a term name maps to it; an unknown label maps to nothing; one term is never listed twice', () => {
  const r = mapLabelsToTerms('hardcover', ['Fantasy', 'fantasy', 'Zebra studies', 'Mythology'], [], vocab);
  assert.deepEqual(ids(r), ['g-fan', 's-myth']);
  assert.ok(r.every(x => x.source === 'hardcover'));
  assert.equal(r.find(x => x.term_id === 'g-fan')!.raw_label, 'Fantasy');
  assert.deepEqual(mapLabelsToTerms('apple', ['', '   ', 'x'.repeat(200)], [], vocab), []);
});

test('a category path gives its parts; its root is the context an alias may require, and a lone label without that context still maps to nothing', () => {
  assert.deepEqual(ids(mapLabelsToTerms('google', ['Fiction / Dystopian'], [], vocab)), ['g-fic', 'g-sf', 's-dys']);
  assert.deepEqual(ids(mapLabelsToTerms('google', ['Dystopian'], [], vocab)), [], 'no Fiction context: stays a plain provider label');
});
