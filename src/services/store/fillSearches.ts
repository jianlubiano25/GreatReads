import type { Book } from '../../types';
import { parseQuery } from '../books/query';
import { searchBooksLive } from '../books/search';
import type { FillResult } from './genreRows';
import { readShared, writeShared } from './sharedDiscovery';

/**
 * C9 (d): shared `search` rows. A search written by an admin device only when EVERY source answered, and the Google key is often over quota, so the table had no
 * search rows at all. This fills busy searches on purpose (admin button, one at a time): live results only (never your own books or what this device saw before),
 * accepted when >= 8 books came back even if one source was down. `writeShared` still refuses a much thinner list over a fuller one.
 */
export const FILL_SEARCH_MIN = 8;
export const POPULAR_SEARCHES: readonly string[] = [
  'harry potter', 'stephen king', 'colleen hoover', 'agatha christie', 'james patterson', 'jane austen', 'george orwell', 'haruki murakami', 'brandon sanderson',
  'sarah j maas', 'rebecca yarros', 'freida mcfadden', 'atomic habits', 'lord of the rings', 'game of thrones', 'hunger games', 'the great gatsby',
  'pride and prejudice', 'sapiens', 'dune', 'fourth wing', 'it ends with us', 'the alchemist', 'romance', 'fantasy', 'mystery', 'cookbook',
];

/** The key the search box uses for this text (same call as searchBooksLive, so the saved row is the one a reader's search asks for). */
export const searchKey = (text: string): string => parseQuery(text, '', true, 'all').key;

export interface FillSearchDeps {
  read: (key: string) => Promise<Book[] | null>;
  search: (text: string) => Promise<Book[]>;
  write: (key: string, books: Book[]) => Promise<boolean>;
  wait: (ms: number) => Promise<void>;
}
const real: FillSearchDeps = {
  read: k => readShared('search', k),
  search: t => searchBooksLive(t, { limit: 20, local: false }),
  write: (k, b) => writeShared('search', k, b),
  wait: ms => new Promise(r => setTimeout(r, ms)),
};

export async function fillSharedSearch(text: string, deps: FillSearchDeps = real): Promise<FillResult> {
  const key = searchKey(text);
  if (!key) return 'failed';
  if ((await deps.read(key))?.length) return 'already';
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await deps.wait(4000);
    let books: Book[];
    try { books = await deps.search(text); } catch { continue; }
    if (books.length < FILL_SEARCH_MIN) continue;
    return (await deps.write(key, books)) ? 'filled' : 'not-admin';
  }
  return 'failed';
}
