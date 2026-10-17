import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeBook } from './books/model';
import { LibrarySheet } from '../components/LibrarySheet';
import { RateThisBook } from '../components/BookJourney';

const noop = () => {};

test('Add to My Library sheet has the three parts: reading status, shelves and tags, with New shelf / New tag', () => {
  const html = renderToStaticMarkup(h(LibrarySheet, {
    book: makeBook({ id: 'x', title: 'Piranesi', author: 'Susanna Clarke' }),
    inLibrary: false, status: 'list',
    shelves: [{ id: 's1', name: 'Cozy reads', kind: 'shelf', bookIds: [] }],
    tags: [{ id: 't1', name: 'Book club', kind: 'tag', bookIds: [] }],
    checked: ['s1'], onCreate: () => null, onApply: noop, onClose: noop,
  }));
  for (const label of ['Reading now', 'Up next', 'Finished', 'Did not finish', 'Not for me', 'No status']) assert.match(html, new RegExp(label));
  assert.match(html, /Cozy reads/);
  assert.match(html, /Book club/);
  assert.match(html, /New shelf…/);
  assert.match(html, /New tag…/);
  assert.match(html, /Add to My Library/);
  const owned = renderToStaticMarkup(h(LibrarySheet, {
    book: makeBook({ id: 'x', title: 'Piranesi', author: 'Susanna Clarke' }),
    inLibrary: true, status: 'now', shelves: [], tags: [], checked: [], onCreate: () => null, onApply: noop, onClose: noop,
  }));
  assert.match(owned, /In My Library/);
  assert.match(owned, />Save</);
});

test('Rating: "Rate this book" until rated, then "Your rating: 4.25 of 5" with a clear button', () => {
  const none = renderToStaticMarkup(h(RateThisBook, { title: 'T', onRate: noop }));
  assert.match(none, /Rate this book/);
  assert.ok(!/Clear your rating/.test(none));
  const rated = renderToStaticMarkup(h(RateThisBook, { title: 'T', value: 4.25, onRate: noop }));
  assert.match(rated, /Your rating: 4\.25 of 5/);
  assert.match(rated, /aria-label="Clear your rating"/);
  assert.match(rated, /aria-valuenow="4.25"/);
});

test('the sheet and the shelf editor keep a visible, scrollable body (a flex-basis of 0 once collapsed it to nothing)', () => {
  const sheet = renderToStaticMarkup(h(LibrarySheet, {
    book: makeBook({ id: 'x', title: 'Piranesi', author: 'Susanna Clarke' }),
    inLibrary: false, status: 'list', shelves: [], tags: [], checked: [], onCreate: () => null, onApply: noop, onClose: noop,
  }));
  assert.ok(!/basis-0/.test(sheet));
  assert.match(sheet, /overflow-y-auto/);
});

test('the sheet offers Remove only for a book that is in My Library', () => {
  const book = makeBook({ id: 'x', title: 'Piranesi', author: 'Susanna Clarke' });
  const base = { book, status: 'list' as const, shelves: [], tags: [], checked: [], onCreate: () => null, onApply: noop, onRemove: noop, onClose: noop };
  assert.match(renderToStaticMarkup(h(LibrarySheet, { ...base, inLibrary: true })), /Remove Piranesi from My Library/);
  assert.ok(!/Remove Piranesi/.test(renderToStaticMarkup(h(LibrarySheet, { ...base, inLibrary: false }))));
  assert.ok(!/Remove Piranesi/.test(renderToStaticMarkup(h(LibrarySheet, { ...base, inLibrary: true, onRemove: undefined }))));
});
