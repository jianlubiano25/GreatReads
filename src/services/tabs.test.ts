import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Book } from '../types';
import { makeBook } from './books/model';
import { seedGarden } from './garden';
import { TodayTab } from '../components/tabs/TodayTab';
import { StoreTab } from '../components/tabs/StoreTab';
import { LibraryTab } from '../components/tabs/LibraryTab';
import { WordsTab } from '../components/tabs/WordsTab';
import { SearchTab } from '../components/tabs/SearchTab';
import { RateThisBook, ratingAt, starFill } from '../components/BookJourney';
import { AppleBookDetailModal } from '../components/AppleBookDetailModal';
import { DEFAULT_BOOKS } from '../data/defaultBooks';
import { SEARCH_GENRES } from '../data/searchGenres';

/* The tabs were split out of App.tsx. These render each one with plain data so a tab that stops drawing (a wrong prop, a missing
   import, a hook used the wrong way) fails here instead of on a phone. */

const noop = () => {};
const book = (id: string, title: string): Book => makeBook({ id, title, author: 'Some Author', pageCount: 200 });
const state = {
  status: {}, currentPage: {}, totalPages: {}, highlights: {}, notes: {}, dailyLog: {}, goal: 10, readingIntention: '',
  garden: seedGarden({ dailyLog: {}, goal: 10, status: {}, todayKey: '2026-10-09' }),
  history: {},
  ratings: {},
  words: [{ id: 'w1', word: 'petrichor', definition: 'The smell of rain', isLearned: false }],
} as any;

test('every tab draws, and an inactive tab is mounted but hidden', () => {
  const books = [book('a', 'Alpha Book'), book('b', 'Beta Book')];
  const today = renderToStaticMarkup(h(TodayTab, { active: true, state, todayKey: '2026-10-09', todayPages: 3, currentStreak: 2, sceneBooks: books, nowReadingBooks: [books[0]], upNextBooks: [books[1]], finishedCount: 4, handleOpenCover: noop, handleOpenHighlights: noop, startReading: noop, setDayPages: noop, updateIntention: noop, updateBookProgress: noop, setBookStatus: noop, updateBookNote: noop }));
  assert.match(today, /pages today/);
  assert.match(today, /Alpha Book/);
  assert.match(today, /Books finished so far: <b>4<\/b>/);
  assert.ok(!/ hidden=""/.test(today));

  const lib = renderToStaticMarkup(h(LibraryTab, { active: false, libraryBooks: books, state, handleOpenCover: noop, handleOpenHighlights: noop, setBookStatus: noop, confirmRemoveFromLibrary: noop, newShelfRequest: 0 }));
  assert.match(lib, /Master list/); // books with no status sit on the Master list shelf
  assert.match(lib, /Alpha Book/);
  assert.match(lib, /aria-label="Add tag"/);
  assert.ok(!/Your reading list\. Finished books/.test(lib)); // the old title + description are gone
  assert.match(lib, / hidden=""/); // not the active tab: kept in the page, not shown

  const words = renderToStaticMarkup(h(WordsTab, { active: true, state, updateWord: noop, editWord: noop, lookupAgain: noop, toggleWordLearned: noop, confirmDeleteWord: noop, onLookupNew: noop, onPractice: noop, onPasteWords: noop }));
  assert.match(words, /Word Garden/);
  assert.match(words, /petrichor/);
  assert.match(words, /All \(1\)/);

  const search = renderToStaticMarkup(h(SearchTab, { active: true, allBooks: books, handleOpenCover: noop }));
  assert.match(search, /Title, Author, ISBN, or Keywords/); // the same search box as Discover
  assert.match(search, /Browse by genre/);
  assert.match(search, /Fantasy/);
  assert.match(search, /Science Fiction/);

  const store = renderToStaticMarkup(h(StoreTab, { active: true, allBooks: books, customizing: false, setCustomizing: noop, handleOpenCover: noop }));
  assert.ok(!/Book Store/.test(store)); // the page title (Discover) lives in the App header, not a second heading here
  assert.match(store, /Title, Author, ISBN, or Keywords/);
  assert.match(store, /Top 15 this week/); // the shelves are drawn in the saved/default order
});

test('Store tab: Customize Store replaces the search and shelves', () => {
  const store = renderToStaticMarkup(h(StoreTab, { active: true, allBooks: [], customizing: true, setCustomizing: noop, handleOpenCover: noop }));
  assert.match(store, /Customize Store/);
  assert.ok(!/Title, Author, ISBN, or Keywords/.test(store));
});

test('Library: Reading now shows the book you read last first, with its page progress, and has a search box', () => {
  const books = [book('a', 'Alpha Book'), book('b', 'Beta Book')];
  const s = {
    ...state,
    status: { a: 'now', b: 'now' },
    currentPage: { a: 10, b: 120 },
    totalPages: { a: 100, b: 300 },
    history: { a: { lastRead: 1 }, b: { lastRead: 2 } },
  };
  const html = renderToStaticMarkup(h(LibraryTab, { active: true, libraryBooks: books, state: s as any, handleOpenCover: noop, handleOpenHighlights: noop, setBookStatus: noop, confirmRemoveFromLibrary: noop, newShelfRequest: 0 }));
  assert.ok(html.indexOf('Beta Book') < html.indexOf('Alpha Book'), 'latest read comes first');
  assert.match(html, /Page 120 of 300/);
  assert.match(html, /aria-label="Search your library"/);
  assert.match(html, /Reading now/);
});

test('Search tab: every genre is a button, and each one has a search word of its own', () => {
  const html = renderToStaticMarkup(h(SearchTab, { active: true, allBooks: [], handleOpenCover: noop }));
  for (const g of SEARCH_GENRES) assert.ok(html.includes(g.label), `${g.label} is listed`);
  assert.equal((html.match(/<button type="button" class="min-h-\[56px\]/g) || []).length, SEARCH_GENRES.length);
  assert.equal(new Set(SEARCH_GENRES.map(g => g.query)).size, SEARCH_GENRES.length);
  assert.ok(SEARCH_GENRES.every(g => g.label && g.query && g.query === g.query.toLowerCase()));
});

test('Library: finished books have a Finished shelf of their own (they used to live on the Device tab)', () => {
  const books = [book('a', 'Alpha Book'), book('b', 'Beta Book')];
  const s = { ...state, status: { b: 'done' } };
  const html = renderToStaticMarkup(h(LibraryTab, { active: true, libraryBooks: [books[0]], finishedBooks: [books[1]], state: s as any, handleOpenCover: noop, handleOpenHighlights: noop, setBookStatus: noop, confirmRemoveFromLibrary: noop, newShelfRequest: 0 }));
  assert.match(html, /Finished/);
  assert.match(html, /Beta Book/);
  assert.match(html, /Master list/);
  assert.ok(html.indexOf('Master list') < html.indexOf('Finished'));
  const none = renderToStaticMarkup(h(LibraryTab, { active: true, libraryBooks: [books[0]], state: state as any, handleOpenCover: noop, handleOpenHighlights: noop, setBookStatus: noop, confirmRemoveFromLibrary: noop, newShelfRequest: 0 }));
  assert.ok(!/aria-label="Finished"/.test(none), 'no finished books: no Finished shelf');
});

test('Rate this book: quarter stars fill each star by exactly its share', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(i => starFill(3.75, i)), [1, 1, 1, 0.75, 0]);
  assert.deepEqual([0, 1, 2, 3, 4].map(i => starFill(0.25, i)), [0.25, 0, 0, 0, 0]);
  assert.deepEqual([0, 1, 2, 3, 4].map(i => starFill(5, i)), [1, 1, 1, 1, 1]);
  assert.deepEqual([0, 1, 2, 3, 4].map(i => starFill(0, i)), [0, 0, 0, 0, 0]);

  const html = renderToStaticMarkup(h(RateThisBook, { title: 'Alpha Book', value: 3.75, onRate: noop }));
  assert.match(html, /aria-valuenow="3.75"/);
  assert.match(html, /Your rating: 3.75 of 5/);
  assert.equal((html.match(/width:100%/g) || []).length, 3);
  assert.equal((html.match(/width:75%/g) || []).length, 1);
  assert.match(html, />Clear</); // a saved rating can be taken back

  const empty = renderToStaticMarkup(h(RateThisBook, { title: 'Alpha Book', onRate: noop }));
  assert.match(empty, /aria-valuenow="0"/);
  assert.ok(!/width:\d+%/.test(empty));
  assert.ok(!/>Clear</.test(empty));
});

test('Rate this book: where the pointer is decides the quarter star (the left edge still counts as a quarter, the right edge as five)', () => {
  assert.equal(ratingAt(0, 180), 0.25);
  assert.equal(ratingAt(-20, 180), 0.25);
  assert.equal(ratingAt(180, 180), 5);
  assert.equal(ratingAt(999, 180), 5);
  assert.equal(ratingAt(90, 180), 2.5);
  assert.equal(ratingAt(117, 180), 3.25);
  assert.equal(ratingAt(100, 180), 3); // 2.78 rounds up to the next quarter
  assert.equal(ratingAt(10, 0), 0); // nothing measured yet
});

test('Book info: Add to Library and the reading-status button sit side by side, there is no Add to Device, and Rate this book is above Honors & Awards', () => {
  const awarded = DEFAULT_BOOKS.find(b => typeof b.id === 'number' && b.id === 4)!;
  const html = renderToStaticMarkup(h(AppleBookDetailModal, {
    book: awarded, inLibrary: false, onRate: noop, onClose: noop, onAddToLibrary: noop, onSetStatus: noop,
  }));
  assert.ok(!/Add to Device|On Device/.test(html));
  const lib = html.indexOf('Add to Library');
  const status = html.indexOf('Add to a list');
  assert.ok(lib > 0 && status > lib, 'the status button follows Add to Library');
  assert.ok(!html.slice(lib, status).includes('</div>'), 'both buttons are in the same row');
  const rate = html.indexOf('Rate this book');
  const honors = html.indexOf('Honors &amp; Awards');
  assert.ok(rate > 0 && honors > 0, 'both sections are drawn');
  assert.ok(rate < honors, 'Rate this book comes first');
  // the same title size: both headings use the same size, weight and letter-spacing classes (Honors also lays its trophy icon out with flex)
  const heading = (name: string) => html.slice(html.lastIndexOf('<h4', html.indexOf(name)), html.indexOf(name)).match(/class="([^"]*)"/)![1];
  const SIZE = 'text-xs font-bold uppercase tracking-wider';
  assert.ok(heading('Rate this book').startsWith(SIZE));
  assert.ok(heading('Honors &amp; Awards').startsWith(SIZE));
});
