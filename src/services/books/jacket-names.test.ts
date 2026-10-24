// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { learnAuthorGroup, preferredAuthor, authorNames, sameAuthorByAlias } from './authorAliases';
import { displayBook, englishTitleNow, nameAlternates, setNameChoice, nameChoiceOf } from './englishTitle';
import { knownEnglishTitle, authorKey } from './identity';
import { makeBook } from './model';

test('the jacket name (Apple, rank 3) wins over the legal name for the whole alias group', () => {
  // Open Library knew the pen name only as an alternate: a group with no shown name yet
  learnAuthorGroup(['Ursula Vernon', 'T. Kingfisher']);
  assert.equal(preferredAuthor('Ursula Vernon'), 'Ursula Vernon');
  // Apple prints the pen name: it becomes the one shown, for either spelling
  learnAuthorGroup(['Ursula Vernon', 'T. Kingfisher'], { name: 'T. Kingfisher', rank: 3 });
  assert.equal(preferredAuthor('Ursula Vernon'), 'T. Kingfisher');
  assert.equal(preferredAuthor('T. Kingfisher'), 'T. Kingfisher');
  // a lower-ranked source (Open Library's legal name) never takes it back
  learnAuthorGroup(['Ursula Vernon', 'T. Kingfisher'], { name: 'Ursula Vernon', rank: 1 });
  assert.equal(preferredAuthor('Ursula Vernon'), 'T. Kingfisher');
  // matching still treats the two names as one author
  assert.equal(sameAuthorByAlias(authorKey('Ursula Vernon'), authorKey('T. Kingfisher')), true);
  assert.equal(authorNames('Ursula Vernon')[0], 'T. Kingfisher');
  assert.ok(authorNames('T. Kingfisher').includes('Ursula Vernon'));
});

test('displayBook shows the jacket author without touching the saved record', () => {
  learnAuthorGroup(['Ursula Vernon', 'T. Kingfisher'], { name: 'T. Kingfisher', rank: 3 });
  const saved = makeBook({ id: 'x1', title: 'Nettle & Bone', author: 'Ursula Vernon' });
  const shown = displayBook(saved);
  assert.equal(shown.author, 'T. Kingfisher');
  assert.equal(saved.author, 'Ursula Vernon');
  // an author with no group is left alone (the very same object comes back)
  const plain = makeBook({ id: 'x2', title: 'Dune', author: 'Frank Herbert' });
  assert.equal(displayBook(plain), plain);
});

test('a known English title is applied by displayBook, and the original is kept', () => {
  assert.equal(knownEnglishTitle('変な絵'), 'Strange Pictures');
  assert.equal(knownEnglishTitle('変な絵 '), 'Strange Pictures');
  assert.equal(englishTitleNow('変な絵'), 'Strange Pictures');
  const saved = makeBook({ id: 'j1', title: '変な絵', author: 'Unknown Author' });
  const shown = displayBook(saved);
  assert.equal(shown.title, 'Strange Pictures');
  assert.equal(shown.originalTitle, '変な絵');
  assert.equal(saved.title, '変な絵');
  // drawing it again changes nothing
  assert.equal(displayBook(shown).title, 'Strange Pictures');
});

test('the owner can choose another title/author for one book; nothing else changes', () => {
  learnAuthorGroup(['Ursula Vernon', 'T. Kingfisher'], { name: 'T. Kingfisher', rank: 3 });
  const jp = displayBook(makeBook({ id: 'j2', title: '変な絵', author: 'Unknown Author' }));
  const alt = nameAlternates(jp);
  assert.deepEqual(alt.titles, ['Strange Pictures', '変な絵']);
  setNameChoice(jp, { title: 'original' });
  assert.equal(displayBook(jp).title, '変な絵');
  assert.equal(displayBook(makeBook({ id: 'j3', title: '変な絵', author: 'Unknown Author' })).title, '変な絵');
  setNameChoice(jp, {});
  assert.deepEqual(nameChoiceOf(jp), {});
  assert.equal(displayBook(makeBook({ id: 'j4', title: '変な絵', author: 'Unknown Author' })).title, 'Strange Pictures');

  const nb = makeBook({ id: 'n1', title: 'Nettle & Bone', author: 'Ursula Vernon' });
  assert.ok(nameAlternates(nb).authors.length > 1);
  setNameChoice(nb, { author: 'Ursula Vernon' });
  assert.equal(displayBook(nb).author, 'Ursula Vernon');
  setNameChoice(nb, {});
  assert.equal(displayBook(nb).author, 'T. Kingfisher');
  // a book with no other names offers no choice
  assert.deepEqual(nameAlternates(makeBook({ id: 'd1', title: 'Dune', author: 'Frank Herbert' })), { titles: [], authors: [] });
});
