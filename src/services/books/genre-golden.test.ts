// Run with: npm test
// "Golden" genre searches. Each pool below stands in for what the catalogs return for a genre's Keywords search: the well-known books that belong,
// mixed with the things that spoil a genre page (study guides, non-fiction ABOUT the genre, one author's whole series, thin records). These are written
// by hand, not recorded from the live catalogs, so they test the ranking and never need the network.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { rank, forgetRecentSearchesForTests } from './search';
import { forgetSeenForTests } from './localIndex';
import { parseQuery } from './query';

let n = 0;
const book = (o: any) => ({ id: `b${n++}`, title: 'T', author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2012', genre: 'Fantasy', summary: '', authorBio: '', pageCount: 350, ratingCount: 20000, ratingAverage: 4.2, coverUrl: 'x', ...o }) as any;
const top = (pool: any[], word: string, limit = 8) => { forgetRecentSearchesForTests(); forgetSeenForTests(); return rank(pool, parseQuery(word, '', false, 'keywords'), limit).map(b => b.title); };

interface Golden { word: string; genre: string; targets: [string, string][]; spoilers: any[]; series: { author: string; titles: string[] } }
const CASES: Golden[] = [
  { word: 'fantasy', genre: 'Fantasy',
    targets: [['The Name of the Wind', 'Patrick Rothfuss'], ['A Wizard of Earthsea', 'Ursula K. Le Guin'], ['Mistborn', 'Brandon Sanderson'], ['The Hobbit', 'J. R. R. Tolkien']],
    spoilers: [{ title: 'The Psychology of Fantasy', author: 'Pat Doe', genre: 'Psychology' }, { title: 'Fantasy Football for Dummies', author: 'Lee Roe', genre: 'Sports', ratingCount: 3000 }, { title: 'Fantasy Study Guide', author: 'SparkNotes' }, { title: 'Fantasy', author: 'Nobody', ratingCount: undefined, ratingAverage: undefined, coverUrl: undefined }],
    series: { author: 'Sam Series', titles: ['Dragon Saga One', 'Dragon Saga Two', 'Dragon Saga Three', 'Dragon Saga Four'] } },
  { word: 'romance', genre: 'Romance',
    targets: [['Pride and Prejudice', 'Jane Austen'], ['Outlander', 'Diana Gabaldon'], ['The Notebook', 'Nicholas Sparks'], ['Beach Read', 'Emily Henry']],
    spoilers: [{ title: 'The Psychology of Romance', author: 'Pat Doe', genre: 'Psychology' }, { title: 'Romance Study Guide', author: 'CliffsNotes' }, { title: 'Romance', author: 'Nobody', ratingCount: undefined, ratingAverage: undefined, coverUrl: undefined }],
    series: { author: 'Rita Repeat', titles: ['Love Book One', 'Love Book Two', 'Love Book Three', 'Love Book Four'] } },
  { word: 'mystery', genre: 'Mystery',
    targets: [['And Then There Were None', 'Agatha Christie'], ['The Hound of the Baskervilles', 'Arthur Conan Doyle'], ['The Big Sleep', 'Raymond Chandler'], ['In the Woods', 'Tana French']],
    spoilers: [{ title: 'The Mystery of Consciousness', author: 'Pat Doe', genre: 'Philosophy' }, { title: 'Mystery Summary of Plots', author: 'Summary Press', genre: 'Fiction' }, { title: 'Mystery', author: 'Nobody', ratingCount: undefined, ratingAverage: undefined, coverUrl: undefined }],
    series: { author: 'Mo Mystery', titles: ['Case One', 'Case Two', 'Case Three', 'Case Four'] } },
  { word: 'science fiction', genre: 'Science Fiction',
    targets: [['Dune', 'Frank Herbert'], ['Foundation', 'Isaac Asimov'], ['The Left Hand of Darkness', 'Ursula K. Le Guin'], ['Neuromancer', 'William Gibson']],
    spoilers: [{ title: 'The Science of Science Fiction', author: 'Pat Doe', genre: 'Science' }, { title: 'Science Fiction Study Guide', author: 'SparkNotes' }],
    series: { author: 'Sid Starship', titles: ['Star Run One', 'Star Run Two', 'Star Run Three', 'Star Run Four'] } },
  { word: 'classics', genre: 'Classics',
    targets: [['Jane Eyre', 'Charlotte Brontë'], ['Great Expectations', 'Charles Dickens'], ['Crime and Punishment', 'Fyodor Dostoevsky'], ['Moby-Dick', 'Herman Melville']],
    spoilers: [{ title: 'Classics Study Guide', author: 'SparkNotes' }, { title: 'Classics', author: 'Nobody', ratingCount: undefined, ratingAverage: undefined, coverUrl: undefined }],
    series: { author: 'Cy Collected', titles: ['Collected Tales One', 'Collected Tales Two', 'Collected Tales Three', 'Collected Tales Four'] } },
];

for (const c of CASES) {
  test(`golden "${c.word}": the well-known books lead, the spoilers and the one-author flood do not`, () => {
    const pool = [
      ...c.series.titles.map((t, i) => book({ title: t, author: c.series.author, genre: c.genre, ratingCount: 60000 - i })),
      ...c.spoilers.map(s => book({ genre: c.genre, ...s })),
      ...c.targets.map(([t, a], i) => book({ title: t, author: a, genre: c.genre, ratingCount: 30000 - i * 100 })),
    ];
    const out = top(pool, c.word);
    const first = out.slice(0, 6);
    const targetsIn = c.targets.filter(([t]) => first.includes(t)).length;
    assert.ok(targetsIn >= 3, `only ${targetsIn} of the well-known books in the first 6: ${out.join(' | ')}`);
    for (const s of c.spoilers) assert.ok(!first.includes(s.title), `"${s.title}" should not be in the first 6: ${out.join(' | ')}`);
    assert.ok(first.filter(t => c.series.titles.includes(t)).length <= 2, `one author fills the page: ${out.join(' | ')}`);
  });
}
