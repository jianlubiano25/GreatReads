import test from 'node:test';
import assert from 'node:assert/strict';
import { filterByGenreEvidence, subjectEvidence, isFictionBySubjects } from './genreEvidence';
import { SEARCH_GENRES } from '../../data/searchGenres';
import type { Book } from '../../types';

const book = (title: string): Book => ({ id: title, title, author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, genre: 'Book', year: '2000', summary: '', authorBio: '', pageCount: 100 } as Book);
const genre = (label: string) => SEARCH_GENRES.find(g => g.label === label)!;
const subjects: Record<string, string[]> = {
  'Harry Potter and the Goblet of Fire': ['Wizards', 'Fantasy fiction', 'Juvenile fiction', 'Quidditch'],
  'Green Eggs and Ham': ['Stories in rhyme', 'Juvenile fiction', 'Picture books'],
  'Dracula': ['Vampires', 'Horror tales', 'Fiction'],
  'Sapiens': ['Human evolution', 'Civilization', 'Social history'],
  'Shoe Dog': ['Sports -- Biography', 'Businesspeople', 'Nike (Firm)'],
  'Just Kids': ['Rock musicians', 'Photographers -- Biography'],
  'Maus': ['Graphic novels', 'Holocaust, Jewish (1939-1945) -- Comic books, strips, etc.'],
  'Mere Christianity': ['Christianity', 'Apologetics'],
  'The Hobbit (no subjects)': [],
};
const of = (b: Book) => subjects[b.title]?.length ? subjects[b.title] : undefined;
const keep = (label: string, titles: string[]) => filterByGenreEvidence(genre(label), titles.map(book), of).map(b => b.title);

test('C18: off-genre popular books are dropped by their own subjects (the owner\'s examples)', () => {
  assert.deepEqual(keep('Sports', ['Harry Potter and the Goblet of Fire', 'Shoe Dog']), ['Shoe Dog']);
  assert.deepEqual(keep('Music', ['Green Eggs and Ham', 'Just Kids']), ['Just Kids']);
  assert.deepEqual(keep('Religion', ['Dracula', 'Mere Christianity']), ['Mere Christianity']);
  assert.deepEqual(keep('Graphic Novels', ['Sapiens', 'Maus']), ['Maus']);
  assert.deepEqual(keep('Christian', ['Dracula', 'Mere Christianity']), ['Mere Christianity']);
  assert.deepEqual(keep("Children's", ['Green Eggs and Ham', 'Sapiens']), ['Green Eggs and Ham']);
});

test('C18: no subject list = nothing known against the book (kept); a genre without subjectTerms is never filtered', () => {
  assert.deepEqual(keep('Sports', ['The Hobbit (no subjects)']), ['The Hobbit (no subjects)']);
  assert.deepEqual(filterByGenreEvidence(genre('Fantasy'), ['Dracula', 'Sapiens'].map(book), of).length, 2);
});

test('C18: word-start matching and the nonfiction fiction rule', () => {
  assert.equal(subjectEvidence(['Sports -- History'], ['sport']), 'yes');
  assert.equal(subjectEvidence(['Olympic games'], ['olympic']), 'yes');
  assert.equal(subjectEvidence(['Quidditch'], ['sport']), 'no');
  assert.equal(subjectEvidence(undefined, ['sport']), 'unknown');
  assert.equal(isFictionBySubjects(['Sports -- Fiction']), true);
  assert.equal(isFictionBySubjects(['Sports -- Biography']), false);
  assert.deepEqual(keep('Sports', ['Shoe Dog']).length, 1);
});
