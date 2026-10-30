// Run with: npm test
// Guards the "is this the same book / author?" rules that Search and the library rely on. These cases came from comparing Jldata2
// with the evidence-based identity engine tried on vscode-antigravity-edits: the engine was stricter about merging, but it stopped
// matching titles that differ only by a leading "The"/"A", reversed or suffixed author names, etc., which hurt Search.
import test from 'node:test';
import assert from 'node:assert/strict';
import { authorListMatches, sameEdition, sameWork, titlesMatch, validIsbn } from './identity';

const B = (title: string, author: string, identity?: any, id = 'x') => ({ id, title, author, identity } as any);

test('a leading article never stops two titles matching (either direction)', () => {
  for (const [a, b] of [['The Midnight Library', 'Midnight Library'], ['The Great Gatsby', 'Great Gatsby'], ['A Little Life', 'Little Life'], ['The Hobbit', 'Hobbit']]) {
    assert.ok(titlesMatch(a, b), `${a} / ${b}`);
    assert.ok(titlesMatch(b, a), `${b} / ${a}`);
    assert.ok(sameWork(B(a, 'X Y'), B(b, 'X Y')), `sameWork ${a}`);
    assert.ok(sameWork(B(a, 'X Y'), B(b, 'X Y'), true), `strict sameWork ${a}`);
  }
});

test('the same author written differently still matches', () => {
  assert.ok(authorListMatches('Murakami Haruki', 'Haruki Murakami'), 'family name first, no comma');
  assert.ok(authorListMatches('Murakami, Haruki', 'Haruki Murakami'));
  assert.ok(authorListMatches('Martin Luther King', 'Martin Luther King Jr.'), 'suffix');
  assert.ok(authorListMatches('Marieke Lucas Rijneveld', 'Lucas Rijneveld'), 'a dropped given name');
  assert.ok(authorListMatches('Gabriel Garcia Marquez', 'Gabriel García Márquez'), 'accents');
  assert.ok(authorListMatches('Jokha Alharthi', 'Jokha al-Harthi'), 'hyphenated surname');
  assert.ok(sameWork(B('The Discomfort of Evening', 'Marieke Lucas Rijneveld'), B('The Discomfort of Evening', 'Lucas Rijneveld'), true));
});

test('different books and different authors stay apart', () => {
  assert.ok(!sameWork(B('Dune', 'Frank Herbert'), B('Dune', 'Brian Herbert')), 'same title, different author');
  assert.ok(!sameWork(B('Dune: Messiah', 'Frank Herbert'), B('Dune: Children of Dune', 'Frank Herbert')), 'sequels');
  assert.ok(!sameWork(B('Piranesi', 'Susanna Clarke'), B('Study Guide: Piranesi', 'Susanna Clarke')), 'study guide');
  assert.ok(!sameWork(B('Untitled', 'Unknown Author'), B('Untitled', 'Unknown Author'), true), 'unknown authors are never merged in the library');
  assert.ok(!authorListMatches('Brian Herbert', 'Frank Herbert'));
});

test('a shared ISBN only joins two records when it is a real ISBN', () => {
  assert.ok(validIsbn('9780306406157'));
  assert.ok(validIsbn('0306406152'));
  assert.ok(!validIsbn('1234567890123'));
  assert.ok(sameEdition(B('A', 'X', { isbn13: '9780306406157' }), B('B', 'Y', { isbn13: '9780306406157' }, 'y')));
  assert.ok(!sameEdition(B('A', 'X', { isbn13: '1234567890123' }), B('B', 'Y', { isbn13: '1234567890123' }, 'y')));
});
