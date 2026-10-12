import type { Book, ReadingState } from '../types';
import { DEFAULT_BOOKS } from '../data/defaultBooks';
import { mergeBooks, sameWork } from './books';

export type AddDestination = 'device' | 'library' | 'now' | 'next';

/**
 * Adds a book to the library (pure, so it can be tested without React).
 * The same book arriving under a different record id (search vs Store vs NYT) is the book you already have, not a second copy.
 */
export function applyAddBook(prev: ReadingState, incoming: Book, destination: AddDestination = 'library'): ReadingState {
  const dupe = [...DEFAULT_BOOKS, ...prev.customBooks].find(b =>
    String(b.id) !== String(incoming.id) && !prev.hiddenBookIds[String(b.id)] && sameWork(b, incoming, true));
  const idKey = String(dupe ? dupe.id : incoming.id);
  const isDevice = destination === 'device';
  const existingCustom = prev.customBooks.find(b => String(b.id) === idKey);
  const isCatalogDupe = !!dupe && !existingCustom; // a built-in book: nothing to store, only its status changes

  let updatedCustom: Book[] = prev.customBooks;
  if (existingCustom) {
    const merged = dupe ? mergeBooks(existingCustom, incoming) : { ...existingCustom, ...incoming };
    updatedCustom = prev.customBooks.map(b => (String(b.id) === idKey ? { ...merged, id: existingCustom.id, isOnDevice: isDevice || existingCustom.isOnDevice } : b));
  } else if (!isCatalogDupe) {
    updatedCustom = [{ ...incoming, isOnDevice: isDevice }, ...prev.customBooks];
  }

  return {
    ...prev,
    customBooks: updatedCustom,
    // Only write an on-device setting when the person chose "device": adding to the library must never turn a built-in book's device copy off
    onDeviceOverrides: isDevice ? { ...prev.onDeviceOverrides, [idKey]: true } : prev.onDeviceOverrides,
    // Adding to the library or device never promotes a book to "Up next"; that is your choice.
    status: {
      ...prev.status,
      [idKey]: destination === 'now' || destination === 'next' ? destination : (prev.status[idKey] || 'list'),
    },
  };
}
