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
  words: [{ id: 'w1', word: 'petrichor', definition: 'The smell of rain', isLearned: false }],
} as any;

test('every tab draws, and an inactive tab is mounted but hidden', () => {
  const books = [book('a', 'Alpha Book'), book('b', 'Beta Book')];
  const today = renderToStaticMarkup(h(TodayTab, { active: true, state, todayKey: '2026-10-09', todayPages: 3, currentStreak: 2, sceneBooks: books, nowReadingBooks: [books[0]], upNextBooks: [books[1]], finishedCount: 4, handleOpenCover: noop, handleOpenHighlights: noop, startReading: noop, setDayPages: noop, updateIntention: noop, updateBookProgress: noop, setBookStatus: noop, updateBookNote: noop }));
  assert.match(today, /pages today/);
  assert.match(today, /Alpha Book/);
  assert.match(today, /Books finished so far: <b>4<\/b>/);
  assert.ok(!/ hidden=""/.test(today));

  const lib = renderToStaticMarkup(h(LibraryTab, { active: false, libraryBooks: books, state, handleOpenCover: noop, handleOpenHighlights: noop, setBookStatus: noop, confirmRemoveFromLibrary: noop, onAddBook: noop }));
  assert.match(lib, /Library/);
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

  const store = renderToStaticMarkup(h(StoreTab, { active: true, allBooks: books, customizing: false, setCustomizing: noop, handleOpenCover: noop, onAddBook: noop }));
  assert.match(store, /Book Store/);
  assert.match(store, /Search by title, author, or keyword/);
  assert.match(store, /Top 15 this week/); // the shelves are drawn in the saved/default order
});

test('Store tab: Customize Store replaces the search and shelves, and the Add Book button stays', () => {
  const store = renderToStaticMarkup(h(StoreTab, { active: true, allBooks: [], customizing: true, setCustomizing: noop, handleOpenCover: noop, onAddBook: noop }));
  assert.match(store, /Customize Store/);
  assert.match(store, /Add Book/);
  assert.ok(!/Search by title, author, or keyword/.test(store));
});
