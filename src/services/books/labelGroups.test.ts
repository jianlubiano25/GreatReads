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
  assert.deepEqual(by['Genres'].map(c => c.label), ['Science Fiction']);
  assert.deepEqual(by['Genres'][0].sources.sort(), ['app', 'google', 'hardcover']);
  assert.deepEqual(by['Subgenres'].map(c => c.label), ['Dystopian']);
  assert.deepEqual(by['Subjects & themes'].map(c => c.label), ['Space']);
  assert.deepEqual(by['Keywords & tags'].map(c => c.label).sort(), ['Desert planets', 'Epic']);
});

test('without the vocabulary every label still shows, as tags; nothing is repeated', () => {
  const g = labelGroups(['Fantasy'], [f('apple', ['Fantasy', 'Magic'])], null);
  assert.deepEqual(g.map(x => x.name), ['Genres', 'Keywords & tags']);
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

test('library headings split at commas: "Fiction, fantasy, epic" gives Fantasy and, with Fantasy as context, Epic fantasy', () => {
  const v2 = { terms: [...vocab.terms, { id: 'g2', kind: 'genre', name: 'Fantasy', slug: 'fantasy' }, { id: 's2', kind: 'subgenre', name: 'Epic fantasy', slug: 'epic-fantasy' }],
    aliases: [{ source: 'any', label_norm: 'epic', term_id: 's2', requires_genre: 'Fantasy', implies_genre: null }] };
  const g = labelGroups([], [f('openlibrary', ['Fiction, fantasy, epic', 'Fiction, general'])], v2);
  const by = Object.fromEntries(g.map(x => [x.name, x.chips.map(c => c.label)]));
  assert.ok(by['Genres'].includes('Fantasy'));
  assert.deepEqual(by['Subgenres'], ['Epic fantasy']);
});

import { providerAwards } from './labelGroups';
test('award labels go to Awards & honors, once, and never show as tags', () => {
  const facts = [f('openlibrary', ['Hugo Award winner'], ['award:hugo_award=1966', 'Space']), f('hardcover', ['Hugo Award'])];
  const a = providerAwards(facts);
  assert.deepEqual(a.map(c => c.label).sort(), ['Hugo Award', 'Hugo Award 1966']);
  assert.deepEqual(a.find(c => c.label === 'Hugo Award')!.sources.sort(), ['hardcover', 'openlibrary']);
  const g = labelGroups([], facts, vocab);
  assert.ok(!g.some(x => x.chips.some(c => /hugo/i.test(c.label))));
});
