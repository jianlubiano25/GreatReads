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
import { chipLabel, compactCount, RatingLine } from '../components/BookMeta';
import { StoreShelf } from '../components/StoreShelf';
import type { ShelfSource } from './store/shelves';

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

test('Store tab: Customize Shelves replaces the search and shelves', () => {
  const store = renderToStaticMarkup(h(StoreTab, { active: true, allBooks: [], customizing: true, setCustomizing: noop, handleOpenCover: noop }));
  assert.match(store, /Customize Shelves/);
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
  assert.match(html, /Reading now\s*<span[^>]*>1</);
  assert.match(html, /Finished\s*<span[^>]*>5</);
  assert.match(html, /Up next\s*<span[^>]*>0</);
  assert.match(html, /Did not finish/);
  assert.match(html, /Not for me/);
  assert.match(html, /Master list\s*<span[^>]*>6</);
  assert.match(html, /Cozy reads\s*<span[^>]*>2</);
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

test('Search tab: every genre is a button, and each one has a search word of its own', () => {
  const html = renderToStaticMarkup(h(SearchTab, { active: true, allBooks: [], handleOpenCover: noop }));
  for (const g of SEARCH_GENRES) assert.ok(html.includes(g.label.replace(/&/g, '&amp;').replace(/'/g, '&#x27;')), `${g.label} is listed`);
  assert.equal((html.match(/<button type="button" class="min-h-\[56px\]/g) || []).length, SEARCH_GENRES.length);
  assert.equal(new Set(SEARCH_GENRES.map(g => g.query)).size, SEARCH_GENRES.length);
  assert.ok(SEARCH_GENRES.every(g => g.label && g.query && g.query === g.query.toLowerCase()));
});

test('Rate this book: quarter stars fill each star by exactly its share', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(i => starFill(3.75, i)), [1, 1, 1, 0.75, 0]);
  assert.deepEqual([0, 1, 2, 3, 4].map(i => starFill(0.25, i)), [0.25, 0, 0, 0, 0]);
  assert.deepEqual([0, 1, 2, 3, 4].map(i => starFill(5, i)), [1, 1, 1, 1, 1]);
  assert.deepEqual([0, 1, 2, 3, 4].map(i => starFill(0, i)), [0, 0, 0, 0, 0]);

  const html = renderToStaticMarkup(h(RateThisBook, { title: 'Alpha Book', value: 3.75, onRate: noop }));
  assert.match(html, /aria-valuenow="3.75"/);
  assert.match(html, /Your rating: 3\.75 of 5/);
  assert.equal((html.match(/width:100%/g) || []).length, 3);
  assert.equal((html.match(/width:75%/g) || []).length, 1);
  assert.match(html, /aria-label="Clear your rating"/); // a saved rating can be taken back with the X

  const empty = renderToStaticMarkup(h(RateThisBook, { title: 'Alpha Book', onRate: noop }));
  assert.match(empty, /aria-valuenow="0"/);
  assert.ok(!/width:\d+%/.test(empty));
  assert.ok(!/Clear your rating/.test(empty));
  assert.match(empty, /Rate this book/);
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

test('Book info: one control (Add to My Library, or your status once it is yours), no Add to Device, and More like this and Rate this book are below About this book (More like this first)', () => {
  const awarded = DEFAULT_BOOKS.find(b => typeof b.id === 'number' && b.id === 4)!;
  const html = renderToStaticMarkup(h(AppleBookDetailModal, {
    book: awarded, inLibrary: false, onRate: noop, onClose: noop, onOpenLibrarySheet: noop,
  }));
  assert.ok(!/Add to Device|On Device|Add to a list/.test(html));
  assert.match(html, /Add to My Library/);
  assert.equal((html.match(/aria-haspopup="dialog"/g) || []).length, 1, 'a single button');
  const owned = renderToStaticMarkup(h(AppleBookDetailModal, {
    book: awarded, inLibrary: true, readingStatus: 'now', onRate: noop, onClose: noop, onOpenLibrarySheet: noop,
  }));
  assert.match(owned, /Reading now/);
  assert.ok(!/Add to My Library/.test(owned));
  assert.equal((owned.match(/aria-haspopup="dialog"/g) || []).length, 1, 'still a single button');
  const rate = html.indexOf('Rate this book');
  const honors = html.indexOf('Honors &amp; Awards');
  const about = html.indexOf('About this book');
  assert.ok(rate > 0 && honors > 0 && about > 0, 'all three sections are drawn');
  assert.ok(about < rate, 'Rate this book comes right below About this book');
  assert.ok(html.indexOf('Add to My Library') < about, 'and the Add to My Library button stays above it');
  const withMore = renderToStaticMarkup(h(AppleBookDetailModal, { book: awarded, inLibrary: false, onRate: noop, onMoreLikeThis: noop, onClose: noop, onOpenLibrarySheet: noop }));
  assert.ok(withMore.indexOf('About this book') < withMore.indexOf('More like this') && withMore.indexOf('More like this') < withMore.indexOf('Rate this book'), 'About, then More like this, then Rate this book');
  // the same title size: both headings use the same size, weight and letter-spacing classes (Honors also lays its trophy icon out with flex)
  const heading = (name: string) => html.slice(html.lastIndexOf('<h4', html.indexOf(name)), html.indexOf(name)).match(/class="([^"]*)"/)![1];
  const SIZE = 'text-xs font-bold uppercase tracking-wider';
  assert.ok(heading('Rate this book').startsWith(SIZE));
  assert.ok(heading('Honors &amp; Awards').startsWith(SIZE));
});

test('Book info: the Add to My Library button is always the same width (the info column takes the full width on a phone)', () => {
  const b = DEFAULT_BOOKS.find(x => typeof x.id === 'number' && x.id === 4)!;
  for (const inLibrary of [false, true]) {
    const html = renderToStaticMarkup(h(AppleBookDetailModal, { book: b, inLibrary, onRate: noop, onClose: noop, onOpenLibrarySheet: noop }));
    assert.match(html, /class="w-full sm:w-auto flex-1 flex flex-col items-center sm:items-start min-w-0"/);
    assert.match(html, /class="flex items-center gap-3 w-full max-w-md mt-2"/);
  }
});

test('Rating counts are short: 16.0k is 16k, 1.0M is 1M, and a real decimal is kept', () => {
  assert.equal(compactCount(16000), '16k');
  assert.equal(compactCount(16040), '16k');
  assert.equal(compactCount(16050), '16.1k');
  assert.equal(compactCount(1000), '1k');
  assert.equal(compactCount(163204), '163.2k');
  assert.equal(compactCount(999), '999');
  assert.equal(compactCount(1_250_000), '1.3M');
  assert.equal(compactCount(2_000_000), '2M');
  assert.equal(compactCount(999_999), '1M');
  assert.equal(compactCount(undefined), '');
  assert.equal(compactCount(0), '');
  // and the line that shows it
  const rated = makeBook({ id: 'r', title: 'Rated', author: 'A B', ratingAverage: 4.5, ratingCount: 16000, ratingSource: 'apple' });
  assert.match(renderToStaticMarkup(h(RatingLine, { book: rated })), /4\.5 · 16k</);
  assert.ok(!/16\.0k/.test(renderToStaticMarkup(h(RatingLine, { book: rated, compact: true }))));
});

test('Shelf rating line: the stars on a shelf card keep the normal size (they are not shrunk to fit)', () => {
  const rated = makeBook({ id: 'r', title: 'Rated', author: 'A B', ratingAverage: 4.5, ratingCount: 16000, ratingSource: 'apple' });
  const html = renderToStaticMarkup(h(RatingLine, { book: rated, compact: true }));
  assert.ok(!/text-\[(8|9|10)px\]/.test(html.slice(0, html.indexOf('4.5'))), 'no tiny star size');
  const shelf = renderToStaticMarkup(h(StoreShelf, { id: 'x', title: 'X', books: [rated], onOpen: noop }));
  assert.match(shelf, /w-\[150px\] sm:w-\[165px\]/); // the card is wide enough for them
  assert.match(shelf, /min-h-\[26px\]/); // and every card holds at least one honor line
});

test('Shelf cards: a long NYT honor fits one line, so every shelf has the same height and spacing whatever its books wear', () => {
  const nyt = makeBook({ id: 'n', title: 'Listed', author: 'A B', awardLabel: 'NYT bestseller · 12 weeks' });
  const plain = makeBook({ id: 'p', title: 'Plain', author: 'A B' });
  const draw = (b: Book, mine?: (x: Book) => string | undefined) => renderToStaticMarkup(h(StoreShelf, { id: 'x', title: 'X', books: [b], mine, onOpen: noop }));
  const onNyt = draw(nyt);
  assert.match(onNyt, /NYT · 12 weeks/); // the chip reads short ...
  assert.ok(!/NYT bestseller · 12 weeks/.test(onNyt));
  assert.equal(chipLabel('NYT bestseller · new this week'), 'NYT · new');
  assert.equal(chipLabel('NYT bestseller · 104 weeks'), 'NYT · 104 weeks');
  assert.equal(chipLabel('NYT bestseller'), 'NYT bestseller'); // a short one stays as it is
  assert.equal(chipLabel("Women's Prize 2021"), "Women's Prize 2021"); // and no other honor is touched
  assert.equal((onNyt.match(/class="rl-bdg[ "]/g) || []).length, 1); // still shown in full, never cut to a fraction
  const slots = (html: string) => (html.match(/class="min-h-\[26px\]"/g) || []).length;
  assert.equal(slots(onNyt), 1);
  assert.equal(slots(draw(plain)), 1); // a book with no honor still holds the slot
  // the status row is on every Discover shelf (the Store passes `mine`), owned book or not
  const withMine = (html: string) => (html.match(/class="h-5"/g) || []).length;
  assert.equal(withMine(draw(plain, () => undefined)), 1);
  assert.equal(withMine(draw(plain, () => 'Reading now')), 1);
  assert.equal(withMine(draw(plain)), 0); // a shelf outside Discover has none
});

test('A row that may turn out empty draws nothing while it loads (no title or placeholder that then disappears)', () => {
  const never: ShelfSource = { id: 'never', cached: () => null, load: () => new Promise(() => {}) };
  const plain = renderToStaticMarkup(h(StoreShelf, { id: 'row', title: 'New releases', source: never, hideIfUnavailable: true, onOpen: noop }));
  assert.match(plain, /New releases/); // an ordinary shelf shows its title and a placeholder while it loads
  assert.match(plain, /aria-busy/);
  const quiet = renderToStaticMarkup(h(StoreShelf, { id: 'row', title: 'New releases', source: never, hideIfUnavailable: true, hideWhileLoading: true, onOpen: noop }));
  assert.equal(quiet, '');
  const ready: ShelfSource = { id: 'ready', cached: () => [book('a', 'Alpha Book')], load: async () => [book('a', 'Alpha Book')] };
  const shown = renderToStaticMarkup(h(StoreShelf, { id: 'row', title: 'New releases', source: ready, hideIfUnavailable: true, hideWhileLoading: true, onOpen: noop }));
  assert.match(shown, /New releases/); // books already saved: the row is there from the first draw
  assert.match(shown, /Alpha Book/);
});

test('Word Garden search has the same clear (x) button as the other search boxes, shown only while there is text', () => {
  const html = renderToStaticMarkup(h(WordsTab, { active: true, state, updateWord: noop, editWord: noop, lookupAgain: noop, toggleWordLearned: noop, confirmDeleteWord: noop, onLookupNew: noop, onPractice: noop, onPasteWords: noop }));
  assert.match(html, /aria-label="Search your words"/);
  assert.match(html, /rl-search/); // hides the browser's own x so there is only one
  assert.ok(!/aria-label="Clear search"/.test(html)); // nothing typed: no x
});
