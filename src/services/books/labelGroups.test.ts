import test from 'node:test';
import assert from 'node:assert/strict';
import { labelGroups } from './labelGroups';
import type { ProviderFacts } from './providerFacts';

const vocab = {
  terms: [
    { id: 'g1', kind: 'genre', name: 'Science Fiction', slug: 'science-fiction' },
    { id: 's1', kind: 'subgenre', name: 'Dystopian', slug: 'dystopian' },
    { id: 'u1', kind: 'subject', name: 'Space', slug: 'space' },
  ],
  aliases: [{ source: 'any', label_norm: 'sci-fi', term_id: 'g1', requires_genre: null, implies_genre: null }],
};
const f = (provider: ProviderFacts['provider'], genres: string[], subjects: string[] = []): ProviderFacts => ({ provider, recordId: '1', genres, subjects, seenAt: 'x' });

test('labels group by term kind, keep unknown labels as tags, show which providers said it', () => {
  const g = labelGroups(['Science Fiction'], [f('google', ['Sci-Fi', 'Dystopian'], ['Desert planets']), f('hardcover', ['Science Fiction', 'Space', 'Epic'])], vocab);
  const by = Object.fromEntries(g.map(x => [x.name, x.chips]));
  assert.deepEqual(by['Genre'].map(c => c.label), ['Science Fiction']);
  assert.deepEqual(by['Genre'][0].sources.sort(), ['app', 'google', 'hardcover']);
  assert.deepEqual(by['Sub-genre'].map(c => c.label), ['Dystopian']);
  assert.deepEqual(by['Subjects'].map(c => c.label), ['Space']);
  assert.deepEqual(by['Tags'].map(c => c.label).sort(), ['Desert planets', 'Epic']);
});

test('without the vocabulary every label still shows, as tags; nothing is repeated', () => {
  const g = labelGroups(['Fantasy'], [f('apple', ['Fantasy', 'Magic'])], null);
  assert.deepEqual(g.map(x => x.name), ['Genre', 'Tags']);
  assert.deepEqual(g[1].chips.map(c => c.label), ['Magic']);
});

test('no labels, no sections', () => { assert.deepEqual(labelGroups([], [], vocab), []); });

import { labelRowsFor } from '../catalogTerms';
test('every provider label becomes one row, mapped ones carry their term, repeats are dropped', () => {
  const rows = labelRowsFor('w1', [f('google', ['Science Fiction', 'Desert planets', 'science  fiction'], ['Space']), f('hardcover', ['Epic'])], vocab, new Map([['google:1', 'r1']]));
  assert.equal(rows.length, 4);
  assert.equal(rows.find(r => r.label === 'Science Fiction')!.term_id, 'g1');
  assert.equal(rows.find(r => r.label === 'Space')!.label_kind, 'subject');
  assert.equal(rows.find(r => r.label === 'Desert planets')!.term_id, null);
  assert.equal(rows.find(r => r.label === 'Epic')!.provider_record_id, undefined);
  assert.equal(rows.find(r => r.label === 'Space')!.provider_record_id, 'r1');
});
