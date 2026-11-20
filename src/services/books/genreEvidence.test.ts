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

// ---- C19 benchmarks: must-include / must-not-lead, with each book's own subjects ----
import { dropUnread, fillGateFailure, termShare } from './genreEvidence';
const rated = (title: string, ratingCount?: number): Book => ({ ...book(title), ratingCount, ratingAverage: ratingCount ? 4.2 : undefined } as Book);
const subs: Record<string, string[]> = {
  'Dune': ['Science fiction', 'Ecology', 'Desert'], 'Neuromancer': ['Cyberspace', 'Science fiction'], 'Project Hail Mary': ['Science fiction', 'Astronauts'], "Ender's Game": ['Science fiction', 'Space warfare'],
  'Animal Farm': ['Political satire', 'Allegories', 'Totalitarianism', 'Fiction'], 'Misery': ['Horror tales', 'Novelists'], 'Carrie': ['Horror', 'Telekinesis'],
  'Born to Run': ['Rock musicians -- Biography', 'Rock music'], 'Love Is a Mix Tape': ['Rock music -- Biography', 'Popular music'],
  'Chinese Musical Instruments': ['Musical instruments -- China', 'Music -- China -- History and criticism'],
  'The Hobbit': ['Fantasy fiction', 'Hobbits', 'Wizards', 'Dragons', 'Middle Earth', 'Fiction', 'Juvenile fiction', 'Comics & graphic novels', 'Quests', 'Adventure', 'Elves', 'Dwarfs', 'Treasure troves'],
  'Maus': ['Graphic novels', 'Holocaust, Jewish (1939-1945) -- Comic books, strips, etc.', 'Jewish fathers and sons'],
};
const sub = (b: Book) => subs[b.title] ?? subjects[b.title]?.slice() as string[] | undefined;
const pass = (label: string, books: Book[]) => dropUnread(genre(label), filterByGenreEvidence(genre(label), books, sub)).map(b => b.title);

test('C19 Science Fiction: real science fiction passes; Animal Farm, Sapiens, Misery and Carrie do not lead', () => {
  const out = pass('Science Fiction', [rated('Animal Farm', 900), rated('Sapiens', 900), rated('Misery', 900), rated('Carrie', 900), rated('Dune', 900), rated('Neuromancer', 400), rated('Project Hail Mary', 800), rated("Ender's Game", 700)]);
  assert.deepEqual(out, ['Dune', 'Neuromancer', 'Project Hail Mary', "Ender's Game"]);
});

test('C19 Music: readers\' music books pass; rhyme books, scholarly studies and unrated records do not', () => {
  const out = pass('Music', [rated('Green Eggs and Ham', 900), rated('Chinese Musical Instruments'), rated('Just Kids', 800), rated('Born to Run', 600), rated('Love Is a Mix Tape', 300)]);
  assert.deepEqual(out, ['Just Kids', 'Born to Run', 'Love Is a Mix Tape']);
  assert.deepEqual(filterByGenreEvidence(genre('Music'), [rated('Chinese Musical Instruments', 30)], sub), [], 'a scholarly study few readers rated is out even with a few ratings');
  assert.equal(filterByGenreEvidence(genre('Music'), [rated('Just Kids', 800)], sub).length, 1);
});

test('C19 Graphic Novels: a prose classic with one graphic-edition tag is out; a real graphic novel is in', () => {
  assert.deepEqual(pass('Graphic Novels', [rated('The Hobbit', 900), rated('Sapiens', 900), rated('Maus', 700)]), ['Maus']);
  assert.ok(termShare(subs['The Hobbit'], genre('Graphic Novels').subjectTerms!) < 0.2);
});

test('C19 Fill gate: one rated book never makes a list complete', () => {
  const g = genre('Music');
  const forty = (n: number, ratedN: number) => Array.from({ length: n }, (_, i) => rated(`B${i}`, i < ratedN ? 50 : undefined));
  const isRated = (b: Book) => Number(b.ratingCount) > 0;
  const allMusic = () => ['Music'];
  assert.match(fillGateFailure({}, forty(19, 19), isRated, allMusic)!, /only 19 books/);
  assert.match(fillGateFailure({}, forty(40, 1), isRated, allMusic)!, /1 of 40 rated/);
  assert.equal(fillGateFailure({}, forty(40, 30), isRated, allMusic), undefined);
  assert.match(fillGateFailure(g, forty(40, 40), isRated, () => ['Quidditch'])!, /name the genre/);
  assert.equal(fillGateFailure(g, forty(40, 40), isRated, allMusic), undefined);
  assert.match(fillGateFailure(g, forty(40, 40), isRated, () => undefined)!, /name the genre/, 'no subject list counts half: 50% is below 70%');
});
