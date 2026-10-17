// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { rank, forgetRecentSearchesForTests } from './search';
import { forgetSeenForTests } from './localIndex';
import { parseQuery } from './query';

const book = (o: any) => ({ id: o.title, title: 'T', author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2015', genre: 'Fantasy', summary: 'A fantasy story of magic and dragons in a far kingdom.', authorBio: '', pageCount: 300, ratingCount: 5000, ratingAverage: 4.2, coverUrl: 'x', ...o }) as any;
const reset = () => { store.clear(); forgetRecentSearchesForTests(); forgetSeenForTests(); };
/** What a genre tap shows: the books the catalogs returned for the subject, ranked for the genre (the Keywords scope). */
const genreRank = (books: any[], word: string, limit = 10) => rank(books, parseQuery(word, '', false, 'keywords'), limit).map(b => b.title);

test('a Fantasy search puts fantasy novels above a non-fiction book about fantasy', () => {
  reset();
  const known = [
    book({ title: 'The Psychology of Fantasy', author: 'Pat Doe', genre: 'Psychology', summary: 'A study of fantasy in the mind.' }),
    book({ title: 'The Name of the Wind', author: 'Patrick Rothfuss' }),
    book({ title: 'A Wizard of Earthsea', author: 'Ursula K. Le Guin' }),
  ];
  const out = genreRank(known, 'fantasy');
  assert.ok(out.includes('The Name of the Wind') && out.includes('The Psychology of Fantasy'), out.join(' | '));
  assert.ok(out.indexOf('The Psychology of Fantasy') > out.indexOf('The Name of the Wind'));
  assert.ok(out.indexOf('The Psychology of Fantasy') > out.indexOf('A Wizard of Earthsea'));
});

test('a Psychology search is the other way round: a novel with "psychology" in its words ranks below real psychology books', () => {
  reset();
  const known = [
    book({ title: 'The Psychology Teacher', author: 'Lee Roe', genre: 'Fiction', summary: 'A novel about a psychology teacher who falls in love.' }),
    book({ title: 'Thinking, Fast and Slow', author: 'Daniel Kahneman', genre: 'Psychology', summary: 'How the mind makes choices: a psychology classic.' }),
  ];
  const out = genreRank(known, 'psychology');
  assert.equal(out[0], 'Thinking, Fast and Slow', out.join(' | '));
});

test('one author does not fill a Fantasy search: the others come before the third book of one series', () => {
  reset();
  const series = ['One', 'Two', 'Three', 'Four'].map((n, i) => book({ title: `Dragon Saga ${n}`, author: 'Sam Series', ratingCount: 9000 - i }));
  const others = [book({ title: 'Earthsea Tale', author: 'Ann Other' }), book({ title: 'Mistborn Tale', author: 'Bo Another' })];
  const out = genreRank([...series, ...others], 'fantasy');
  const third = out.indexOf('Dragon Saga Three');
  assert.ok(third === -1 || third > out.indexOf('Earthsea Tale'), out.join(' | '));
  assert.ok(third === -1 || third > out.indexOf('Mistborn Tale'), out.join(' | '));
});

test('typing a genre word in a plain (All) search is not turned into a mood search', async () => {
  const { isMoodQuery } = await import('./keywords');
  for (const w of ['thriller', 'horror', 'romance', 'history', 'fantasy', 'psychology', 'business']) assert.equal(isMoodQuery([w]), false, w);
});
