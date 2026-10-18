// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { didYouMean, editDistance, suggestionVocab } from './suggest';
import { clearRecentSearches, forgetSearch, getRecentSearches, rememberSearch, RECENT_SEARCH_MAX } from './recentSearches';
import { genreForQuery, moreLikeThis } from './genreRank';
import { applySearchView, activeFilterCount, DEFAULT_SEARCH_VIEW } from './searchView';
import { newReleases, hiddenGems, MIN_ROW } from '../store/genreRows';

const book = (o: any) => ({ id: o.title, title: 'T', author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2015', genre: 'Fantasy', summary: '', authorBio: '', pageCount: 300, ratingCount: 500, ratingAverage: 4.2, coverUrl: 'x', ...o }) as any;

test('did you mean: a typo one letter off a known word is put right, an unknown word is left alone', () => {
  const v = suggestionVocab([]);
  assert.equal(didYouMean('fanatsy', v), 'fantasy');
  assert.equal(didYouMean('histroy', v), 'history');
  assert.equal(didYouMean('cozy mistery', v), 'cozy mystery');
  assert.equal(didYouMean('fantasy', v), null, 'a correct word needs nothing');
  assert.equal(didYouMean('zxqvbn', v), null, 'nothing close: no guess');
  assert.equal(didYouMean('abc', v), null, 'very short words are never "corrected"');
  assert.equal(didYouMean('9780141439518', v), null);
});

test('did you mean: knows the titles and authors of your own books', () => {
  const mine = [book({ title: 'Writers & Lovers', author: 'Lily King' })];
  assert.equal(didYouMean('writers & lovrs', suggestionVocab(mine)), 'writers and lovers');
  assert.equal(suggestionVocab(mine), suggestionVocab(mine), 'built once per list');
  assert.equal(editDistance('ab', 'ba'), 1, 'a swap of neighbours is one edit');
});

test('recent searches: newest first, no duplicates, capped, removable, clearable', () => {
  store.clear();
  assert.deepEqual(getRecentSearches(), []);
  rememberSearch('harry potter'); rememberSearch('verity'); rememberSearch('Harry  Potter');
  assert.deepEqual(getRecentSearches(), ['Harry Potter', 'verity']);
  rememberSearch('a'); // too short
  assert.equal(getRecentSearches().length, 2);
  for (let i = 0; i < 20; i++) rememberSearch(`query ${i}`);
  assert.equal(getRecentSearches().length, RECENT_SEARCH_MAX);
  assert.equal(getRecentSearches()[0], 'query 19');
  forgetSearch('QUERY 19');
  assert.ok(!getRecentSearches().includes('query 19'));
  assert.deepEqual(clearRecentSearches(), []);
  store.set('readlife.recentSearches', '{not json');
  assert.deepEqual(getRecentSearches(), [], 'a damaged list is just empty');
});

test('typed genre words find their genre page, sub-genres included; other words do not', () => {
  assert.equal(genreForQuery('Fantasy')?.genre.label, 'Fantasy');
  assert.equal(genreForQuery('science  fiction')?.query, 'science fiction');
  assert.equal(genreForQuery('cozy mystery')?.genre.label, 'Mystery');
  assert.equal(genreForQuery('cozy mystery')?.query, 'cozy mystery');
  assert.equal(genreForQuery('Self-Help')?.genre.label, 'Self-Help');
  assert.equal(genreForQuery('harry potter'), undefined);
});

test('more like this: the genre page when the genre is one we browse, else the author, else nothing', () => {
  const g = moreLikeThis({ genre: 'Fantasy', author: 'Ursula K. Le Guin' });
  assert.ok(g && g.kind === 'genre' && g.genre.label === 'Fantasy');
  assert.deepEqual(moreLikeThis({ genre: 'General', author: 'Jane Austen' }), { kind: 'author', query: 'Jane Austen' });
  assert.equal(moreLikeThis({ genre: 'General', author: 'Unknown Author' }), null);
});

test('type and length filters narrow a result list; books with an unknown genre are kept by the type filter', () => {
  const all = [
    book({ title: 'a', genre: 'Fantasy', pageCount: 200 }),
    book({ title: 'b', genre: 'Psychology', pageCount: 300 }),
    book({ title: 'c', genre: 'General', pageCount: 600 }),
    book({ title: 'd', genre: 'Fantasy', pageCount: 0 }),
  ];
  const ids = (v: any) => applySearchView(all, { ...DEFAULT_SEARCH_VIEW, ...v }).map(b => b.id);
  assert.deepEqual(ids({}), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids({ kind: 'fiction' }), ['a', 'c', 'd']);
  assert.deepEqual(ids({ kind: 'nonfiction' }), ['b', 'c']);
  assert.deepEqual(ids({ length: 'short' }), ['a']);
  assert.deepEqual(ids({ length: 'medium' }), ['b']);
  assert.deepEqual(ids({ length: 'long' }), ['c']);
  assert.equal(activeFilterCount({ ...DEFAULT_SEARCH_VIEW, kind: 'fiction', length: 'long' }), 2);
});

test('new releases: this year and last, with a cover, newest first; hidden gems: well liked, read by some, not by everyone', () => {
  const pool = [
    book({ title: 'old', year: '2001' }),
    book({ title: 'new-a', year: '2026', ratingCount: 10 }),
    book({ title: 'new-b', year: '2025', ratingCount: 900 }),
    book({ title: 'new-nocover', year: '2026', coverUrl: undefined }),
    book({ title: 'future', year: '2031' }),
    book({ title: 'new-wrongkind', year: '2026', genre: 'Psychology' }),
  ];
  assert.deepEqual(newReleases(pool, 'fiction', 2026).map(b => b.id), ['new-a', 'new-b']);
  const gems = hiddenGems([
    book({ title: 'bestseller', ratingCount: 90000, ratingAverage: 4.5 }),
    book({ title: 'gem1', ratingCount: 300, ratingAverage: 4.6 }),
    book({ title: 'gem2', ratingCount: 120, ratingAverage: 4.3 }),
    book({ title: 'obscure', ratingCount: 3, ratingAverage: 5 }),
    book({ title: 'meh', ratingCount: 800, ratingAverage: 3.4 }),
  ], 'fiction');
  assert.deepEqual(gems.map(b => b.id), ['gem1', 'gem2']);
  assert.ok(MIN_ROW >= 3);
});

test('a book filed under Sports, Computers or Games is non-fiction, so a Fantasy search pushes it down', async () => {
  const { bookKind } = await import('../bookKind');
  for (const g of ['Sports', 'Sports & Recreation', 'Computers', 'Games & Activities', 'Mathematics']) assert.equal(bookKind({ genre: g }), 'nonfiction', g);
  for (const g of ['Fantasy', 'Mystery', 'Fiction']) assert.equal(bookKind({ genre: g }), 'fiction', g);
});
