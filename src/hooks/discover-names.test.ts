// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StoreShelf } from '../components/StoreShelf';
import { displayBooks, displayBook, nameAlternates, setNameChoice } from '../services/books/englishTitle';
import { authorKey } from '../services/books/identity';
import { sameAuthorByAlias, preferredAuthor, learnAuthorGroup } from '../services/books/authorAliases';
import { sameWork, bookKey } from '../services/books/identity';
import { makeBook } from '../services/books/model';

// what the lookups learn when Apple prints the jacket name (no pen name is built in)
learnAuthorGroup(['Ursula Vernon', 'T. Kingfisher'], { name: 'T. Kingfisher', rank: 3 });

const strange = makeBook({ id: 'cat_hen', title: '変な絵', author: 'Uketsu' });
const nettle = makeBook({ id: 'cat_nb', title: 'Nettle & Bone', author: 'Ursula Vernon' });

test('Discover shelf draws the English title and the jacket author, never the raw catalogue names', () => {
  const html = renderToStaticMarkup(React.createElement(StoreShelf, { id: 't', title: 'Test', books: [strange, nettle], onOpen: () => {} }));
  assert.match(html, /Strange Pictures/);
  assert.doesNotMatch(html, />変な絵</);
  assert.match(html, /T\. Kingfisher/);
  assert.doesNotMatch(html, />Ursula Vernon</);
});

test('the learned jacket author applies to every spelling in the alias group', () => {
  assert.equal(preferredAuthor('Ursula Vernon'), 'T. Kingfisher');
  assert.equal(preferredAuthor('T. Kingfisher'), 'T. Kingfisher');
  assert.equal(displayBooks([nettle])[0].author, 'T. Kingfisher');
});

test('display names never touch identity: the raw records and matching are unchanged', () => {
  const [s, n] = displayBooks([strange, nettle]);
  assert.equal(strange.title, '変な絵');
  assert.equal(nettle.author, 'Ursula Vernon');
  assert.equal(s.id, strange.id);
  assert.equal(s.originalTitle, '変な絵');
  assert.equal(n.originalAuthor, 'Ursula Vernon');
  assert.equal(sameWork(s as any, strange as any), true); // original and English title: one book
  assert.equal(sameWork(strange as any, s as any), true);
  assert.equal(bookKey(strange as any), 'ta:変な絵|uketsu'); // the saved record's key is unchanged
  assert.equal(sameWork(n as any, nettle as any), true);
  assert.equal(sameAuthorByAlias(authorKey('Ursula Vernon'), authorKey('T. Kingfisher')), true);
});

test('Nettle & Bone offers its known author names, even drawn from an already-displayed copy', () => {
  const shown = displayBook(nettle);
  for (const b of [nettle, shown]) {
    const a = nameAlternates(b).authors;
    assert.equal(a[0], 'T. Kingfisher');
    assert.ok(a.includes('Ursula Vernon'));
  }
  setNameChoice(shown, { author: 'Ursula Vernon' });
  assert.equal(displayBook(nettle).author, 'Ursula Vernon');
  assert.equal(displayBook(shown).author, 'Ursula Vernon');
  setNameChoice(shown, {});
  assert.equal(displayBook(nettle).author, 'T. Kingfisher');
});
