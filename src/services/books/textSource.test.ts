import test from 'node:test';
import assert from 'node:assert/strict';
import { noteTextSource, textSourceOf, forgetTextSourcesForTests } from './textSource';
import { rowsFor } from '../capture';

test('a description or bio is stored with the provider it came from (and its link); text nobody noted stays "app"', () => {
  forgetTextSourcesForTests();
  const desc = 'Set on the desert planet Arrakis, Dune is the story of the boy Paul Atreides, heir to a noble family.';
  const bio = 'Frank Herbert was an American science fiction author best known for Dune, a bestselling novel.';
  noteTextSource(desc, 'google_books');
  noteTextSource(bio, 'wikipedia', 'https://en.wikipedia.org/wiki/Frank_Herbert');
  const rows = rowsFor({ bookId: '1', title: 'Dune', author: 'Frank Herbert', summary: desc, authorBio: bio } as any, 'w1');
  const text = rows.filter(r => r.table === 'catalog_content_versions').map(r => r.body);
  assert.deepEqual(text.map(b => b.source_name), ['google_books', 'wikipedia']);
  assert.equal(text[1].source_url, 'https://en.wikipedia.org/wiki/Frank_Herbert');
  assert.equal(text[0].source_url, undefined);
  assert.deepEqual(textSourceOf('some text nobody noted'), { name: 'app' });
  // spaces and case do not change which text it is
  assert.equal(textSourceOf(desc.toUpperCase().replace(/ /g, '  ')).name, 'google_books');
  forgetTextSourcesForTests();
});
