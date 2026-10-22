import type { Book, BookStatus, ReadingState } from '../types';
import { DEFAULT_BOOKS } from '../data/defaultBooks';
import { bookKey, isUnknownAuthor, mergeBooks, sameWork } from './books';
import { stampStatus } from './bookHistory';
import { dateKey } from './dates';

export type AddDestination = 'device' | 'library' | 'now' | 'next';
/** Where in your reading a book sits when you add it: Reading Now, Up Next, or just on your list */
export type AddStatus = 'now' | 'next' | 'list';

/** `book` with the rating fields of `from` (the rest untouched). */
const withRatingFrom = (from: Book, book: Book): Book => ({ ...book, ratingAverage: from.ratingAverage, ratingCount: from.ratingCount, ratingSource: from.ratingSource });

/** The record id a book is (or would be) kept under: the copy you already have of the same book, else its own id. */
export function resolveLibraryId(prev: Pick<ReadingState, 'customBooks' | 'hiddenBookIds'>, incoming: Book): string {
  const dupe = [...DEFAULT_BOOKS, ...prev.customBooks].find(b =>
    String(b.id) !== String(incoming.id) && !prev.hiddenBookIds[String(b.id)] && sameWork(b, incoming, true));
  return String(dupe ? dupe.id : incoming.id);
}

/**
 * Adds a book to the library (pure, so it can be tested without React).
 * The same book arriving under a different record id (search vs Store vs NYT) is the book you already have, not a second copy.
 */
export function applyAddBook(prev: ReadingState, incoming: Book, destination: AddDestination = 'library', chosen?: AddStatus): ReadingState {
  const dupe = [...DEFAULT_BOOKS, ...prev.customBooks].find(b =>
    String(b.id) !== String(incoming.id) && !prev.hiddenBookIds[String(b.id)] && sameWork(b, incoming, true));
  const idKey = String(dupe ? dupe.id : incoming.id);
  const isDevice = destination === 'device';
  const existingCustom = prev.customBooks.find(b => String(b.id) === idKey);
  const isCatalogDupe = !!dupe && !existingCustom; // a built-in book: nothing to store, only its status changes

  let updatedCustom: Book[] = prev.customBooks;
  if (existingCustom) {
    // Re-adding a book refreshes it, but only the rating fields are decided by the ladder (mergeBooks(incoming, saved)): a card with no rating
    // (or a lower-ranked site's) must not wipe or replace the saved pair of a better-ranked site; the same site's newer pair still wins.
    const merged = dupe ? mergeBooks(existingCustom, incoming) : withRatingFrom(mergeBooks(incoming, existingCustom), { ...existingCustom, ...incoming });
    // The author you have stays: a provider's spelling of it (a pen name's legal name) never silently renames a saved book
    const author = existingCustom.author && !isUnknownAuthor(existingCustom.author) ? existingCustom.author : merged.author;
    updatedCustom = prev.customBooks.map(b => (String(b.id) === idKey ? { ...merged, author, id: existingCustom.id, isOnDevice: isDevice || existingCustom.isOnDevice } : b));
  } else if (!isCatalogDupe) {
    updatedCustom = [{ ...incoming, isOnDevice: isDevice }, ...prev.customBooks];
  }

  // A star rating given before the book was on your list (kept under the book's identity) moves onto your copy
  let ratings = prev.ratings;
  for (const pending of [`w:${bookKey(incoming)}`, String(incoming.id)]) {
    if (ratings?.[pending] && pending !== idKey && !ratings[idKey]) {
      const { [pending]: stars, ...rest } = ratings;
      ratings = { ...rest, [idKey]: stars };
    }
  }

  const newStatus: BookStatus = chosen ?? (destination === 'now' || destination === 'next' ? destination : (prev.status[idKey] || 'list'));

  return {
    ...prev,
    // The day it joined your list (and the day you started it, if it goes straight to Reading now)
    history: { ...prev.history, [idKey]: stampStatus(prev.history?.[idKey], prev.status[idKey], newStatus, dateKey(), Date.now()) },
    ratings,
    customBooks: updatedCustom,
    // Only write an on-device setting when the person chose "device": adding to the library must never turn a built-in book's device copy off
    onDeviceOverrides: isDevice ? { ...prev.onDeviceOverrides, [idKey]: true } : prev.onDeviceOverrides,
    // Adding to the library or device never promotes a book to "Up next" on its own; that is your choice.
    status: {
      ...prev.status,
      // `chosen` is the status picked in the Add dialog (an explicit choice); without one, only 'now' / 'next' destinations set it
      [idKey]: newStatus,
    },
  };
}
