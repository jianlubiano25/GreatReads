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
import { DeviceTab } from '../components/tabs/DeviceTab';

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

  const lib = renderToStaticMarkup(h(LibraryTab, { active: false, myBooks: books, state, handleOpenCover: noop, handleOpenHighlights: noop, setBookStatus: noop, confirmRemoveFromLibrary: noop, newShelfRequest: 0, collections: [], onCollectionsChange: noop, onOpenSheet: noop }));
  assert.match(lib, /Master list/); // books with no status sit on the Master list shelf
  assert.match(lib, /Alpha Book/);
  assert.match(lib, /aria-label="Add tag"/);
  assert.ok(!/Your reading list\. Finished books/.test(lib)); // the old title + description are gone
  assert.match(lib, / hidden=""/); // not the active tab: kept in the page, not shown

  const words = renderToStaticMarkup(h(WordsTab, { active: true, state, updateWord: noop, editWord: noop, lookupAgain: noop, toggleWordLearned: noop, confirmDeleteWord: noop, onLookupNew: noop, onPractice: noop, onPasteWords: noop }));
  assert.match(words, /Word Garden/);
  assert.match(words, /petrichor/);
  assert.match(words, /All \(1\)/);

  const dev = renderToStaticMarkup(h(DeviceTab, { active: true, onDeviceBooks: [books[0]], finishedBooks: [books[1]], state, handleOpenCover: noop, handleOpenHighlights: noop, moveToReadingList: noop, readAgain: noop, confirmRemoveFromDevice: noop, confirmRemoveFinished: noop, onAddToDevice: noop, onPasteList: noop }));
  assert.match(dev, /On my device/);
  assert.match(dev, /<b>2<\/b> books on device \(1 finished\)/);
  assert.match(dev, /Finished \(1\)/);

  const emptyDev = renderToStaticMarkup(h(DeviceTab, { active: true, onDeviceBooks: [], finishedBooks: [], state, handleOpenCover: noop, handleOpenHighlights: noop, moveToReadingList: noop, readAgain: noop, confirmRemoveFromDevice: noop, confirmRemoveFinished: noop, onAddToDevice: noop, onPasteList: noop }));
  assert.match(emptyDev, /Nothing on your device yet/);

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
  const html = renderToStaticMarkup(h(LibraryTab, { active: true, myBooks: books, state: s as any, handleOpenCover: noop, handleOpenHighlights: noop, setBookStatus: noop, confirmRemoveFromLibrary: noop, newShelfRequest: 0, collections: [], onCollectionsChange: noop, onOpenSheet: noop }));
  assert.ok(html.indexOf('Beta Book') < html.indexOf('Alpha Book'), 'latest read comes first');
  assert.match(html, /Page 120 of 300/);
  assert.match(html, /aria-label="Search your library"/);
  assert.match(html, /Reading now/);
});


test('My Library: status tabs with counts, a few cards sideways, View all for the rest, Master list and shelves below', () => {
  const books = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map(t => book(t.toLowerCase(), `${t} Title`));
  const s = {
    ...state,
    status: { a1: 'now', a2: 'done', a3: 'done', a4: 'done', a5: 'done', a6: 'done' },
    history: {},
  };
  const html = renderToStaticMarkup(h(LibraryTab, {
    active: true, myBooks: books, state: s as any, handleOpenCover: noop, handleOpenHighlights: noop, setBookStatus: noop,
    confirmRemoveFromLibrary: noop, newShelfRequest: 0, onCollectionsChange: noop, onOpenSheet: noop,
    collections: [{ id: 'sh1', name: 'Cozy reads', kind: 'shelf', bookIds: ['a1', 'a2'] }],
  }));
  assert.match(html, /role="tablist"/);
  assert.match(html, /Reading now <span[^>]*>1</);
  assert.match(html, /Finished <span[^>]*>5</);
  assert.match(html, /Up next <span[^>]*>0</);
  assert.match(html, /Did not finish/);
  assert.match(html, /Not for me/);
  assert.match(html, /Master list <span[^>]*>6</);
  assert.match(html, /Cozy reads <span[^>]*>2</);
  assert.match(html, /aria-label="Add shelf"/);
  assert.ok(!/View all/.test(html), 'Reading now is the open tab and has one book');
  // every book is in the Master list at once (a1 is also the one Reading now card, so it shows twice)
  for (const b of books) assert.match(html, new RegExp(b.title));
});

test('My Library: View all shows when a status tab holds more than four books', () => {
  const books = ['B1', 'B2', 'B3', 'B4', 'B5'].map(t => book(t.toLowerCase(), `${t} Title`));
  const s = { ...state, status: { b1: 'now', b2: 'now', b3: 'now', b4: 'now', b5: 'now' } };
  const html = renderToStaticMarkup(h(LibraryTab, {
    active: true, myBooks: books, state: s as any, handleOpenCover: noop, handleOpenHighlights: noop, setBookStatus: noop,
    confirmRemoveFromLibrary: noop, newShelfRequest: 0, collections: [], onCollectionsChange: noop, onOpenSheet: noop,
  }));
  assert.match(html, /View all 5/);
});
