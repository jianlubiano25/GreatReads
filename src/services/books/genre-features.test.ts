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

const book = (o: any) => ({ id: o.title, title: 'T', author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2015', genre: 'Fantasy', summary: '', authorBio: '', pageCount: 300, ratingCount: 500, ratingAverage: 4.2, coverUrl: 'https://covers.example/cover.jpg', ...o }) as any;

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

test('hidden gems require a usable cover, the requested book kind, and ratings within the published bounds', () => {
  const valid = (title: string, overrides = {}) => book({ title, ratingAverage: 4.1, ratingCount: 40, ...overrides });
  assert.deepEqual(hiddenGems([
    valid('valid'),
    valid('no cover', { coverUrl: undefined, coverId: 0 }),
    valid('unsafe cover', { coverUrl: 'javascript:alert(1)' }),
    valid('low rating', { ratingAverage: 4.09 }),
    valid('invalid rating', { ratingAverage: Infinity }),
    valid('few ratings', { ratingCount: 39 }),
    valid('too many ratings', { ratingCount: 5001 }),
    valid('wrong kind', { genre: 'Psychology' }),
  ], 'fiction').map(b => b.title).slice(0, 1), ['valid'], 'the real rule comes first');
  // never a book without a usable cover, a bad rating or of the wrong kind, even when the row is being filled up
  const filled = hiddenGems([
    valid('valid'),
    valid('no cover', { coverUrl: undefined, coverId: 0 }),
    valid('unsafe cover', { coverUrl: 'javascript:alert(1)' }),
    valid('invalid rating', { ratingAverage: Infinity }),
    valid('wrong kind', { genre: 'Psychology' }),
    valid('low rating', { ratingAverage: 4.09 }),
    valid('too many ratings', { ratingCount: 5001 }),
    valid('terrible', { ratingAverage: 3.0 }),
  ], 'fiction').map(b => b.title);
  assert.deepEqual([...filled].sort(), ['low rating', 'too many ratings', 'valid']);
});

test('hidden gems fill a thin genre from the best rating down (three steps), strict ones first, no repeats', () => {
  const mk = (title: string, ratingAverage: number, ratingCount: number) => book({ title, ratingAverage, ratingCount });
  const out = hiddenGems([mk('c', 3.8, 20), mk('a', 4.5, 100), mk('b', 4.0, 30), mk('d', 3.5, 500), mk('e', 3.8, 3)], 'fiction').map(b => b.title);
  assert.deepEqual(out, ['a', 'b', 'c'], 'a (rule) then b (3.9+, 15+) then c (3.7+, 10+); d too low, e too few ratings');
});

test('a book filed under Sports, Computers or Games is non-fiction, so a Fantasy search pushes it down', async () => {
  const { bookKind } = await import('../bookKind');
  for (const g of ['Sports', 'Sports & Recreation', 'Computers', 'Games & Activities', 'Mathematics']) assert.equal(bookKind({ genre: g }), 'nonfiction', g);
  for (const g of ['Fantasy', 'Mystery', 'Fiction']) assert.equal(bookKind({ genre: g }), 'fiction', g);
});

test('typed audience phrases ("women in their thirties", "novels about women") open the Women in their 30s genre page', () => {
  for (const q of ['women in their thirties', 'Women in their 30s', 'novels about women', 'midlife women']) {
    const g = genreForQuery(q);
    assert.equal(g?.genre.label, 'Women in their 30s', q);
    assert.equal(g?.query, "women's fiction");
  }
});

test('hidden gems: a genre with too few gems is widened with its sub-genre searches, never with the same book twice', async () => {
  const { widenForGems } = await import('../store/genreRows');
  const gem = (id: string) => book({ id, title: id, ratingAverage: 4.4, ratingCount: 300, coverUrl: 'https://x.test/c.jpg', ratingSource: 'openlibrary' });
  const g = { label: 'Fantasy', emoji: '', query: 'fantasy', kind: 'fiction' as const, subgenres: [{ label: 'a', query: 'epic fantasy' }, { label: 'b', query: 'dark fantasy' }] };
  const asked: string[] = [];
  const out = await widenForGems(g as any, [gem('g0')], async q => { asked.push(q); return q === 'epic fantasy' ? [gem('g0'), ...Array.from({ length: 9 }, (_, i) => gem(`e${i}`))] : []; });
  assert.equal(out.length, 10);
  assert.deepEqual(asked, ['epic fantasy'], 'stops once enough gems');
});

test('genre search: a book with the genre word only in its title ranks below real books of the genre, unless it is popular or highly rated', async () => {
  const { rank } = await import('./search');
  const { parseQuery } = await import('./query');
  const q = parseQuery('manga', '', true, 'keywords');
  const real = (title: string) => book({ title, genre: 'Comics & Graphic Novels', summary: 'A long-running manga series about a boy and his friends. '.repeat(3), ratingAverage: 4.4, ratingCount: 900 });
  const titleOnly = book({ title: 'Manga University: A Guide', genre: 'Education', summary: 'Courses.', ratingAverage: 3.5, ratingCount: 10 });
  const famous = book({ title: 'Manga Classics: Pride and Prejudice', genre: 'Fiction', summary: 'Adaptation.', ratingAverage: 4.5, ratingCount: 2000 });
  const out = rank([titleOnly, famous, real('Naruto'), real('One Piece')], q, 10).map(b => b.title);
  assert.ok(out.indexOf('Manga University: A Guide') > out.indexOf('Naruto'));
  assert.ok(out.indexOf('Manga University: A Guide') > out.indexOf('Manga Classics: Pride and Prejudice'), 'a popular title match is still welcome');
});

test('"Chick Lit" is now "Women\'s Fiction"; the old words still open it', async () => {
  for (const q of ['chick lit', 'chicklit', 'chick-lit', 'rom com']) assert.equal(genreForQuery(q)?.genre.label, "Women's Fiction", q);
});

test('titleOnlyMatch: a summary that repeats the genre word does not make a book of the genre ("The Cultural Politics of Chick Lit")', async () => {
  const { titleOnlyMatch } = await import('./search');
  const { parseQuery } = await import('./query');
  const q = parseQuery('chick lit', '', true, 'keywords');
  assert.equal(titleOnlyMatch({ title: 'The Cultural Politics of Chick Lit' } as any, q), 1);
  assert.equal(titleOnlyMatch({ title: 'Big Little Lies' } as any, q), 0);
});

test('a genre word runs the subject searches only (no plain title/description searches); a topic word still runs them', async () => {
  const { tasksFor } = await import('./search');
  const { parseQuery } = await import('./query');
  const io = { page: 1, onTotal: () => {} };
  const names = (text: string) => tasksFor(parseQuery(text, '', true, 'keywords'), true, io as any).map(t => t.name);
  for (const g of ['sports', 'manga', 'humor', 'cozy', 'chick lit']) assert.ok(!names(g).some(n => n.endsWith('-keyword')), g);
  assert.ok(names('dragons').includes('ol-keyword') && names('dragons').includes('google-keyword'));
});

test('notebooks, planners and how-to-draw books never appear in a genre search; study aids and edition-about-a-book words share one list', async () => {
  const { rank } = await import('./search');
  const { parseQuery } = await import('./query');
  const { isAccessory, NOT_THE_BOOK, SHELF_JUNK } = await import('./notTheBook');
  const q = parseQuery('manga', '', true, 'keywords');
  const out = rank([book({ title: 'How to Draw Manga' }), book({ title: 'Air Sports Notebook' }), book({ title: 'Naruto' })], q, 10).map(b => b.title);
  assert.deepEqual(out, ['Naruto']);
  assert.ok(isAccessory('Daily Planner 2026') && !isAccessory('Diary of a Wimpy Kid') && !isAccessory('The Notebook'));
  for (const t of ['Study Guide for Dune', 'Summary of Atomic Habits', 'Boxed Set']) assert.ok(NOT_THE_BOOK.test(t) && SHELF_JUNK.test(t), t);
  assert.ok(SHELF_JUNK.test('Educart CBSE Class 10 Science') && NOT_THE_BOOK.test('Trivia for fans'));
});

test('a sub-genre chip is a genre of its own for its Hidden gems row (own search word, one object per chip)', async () => {
  const { subGenreOf } = await import('../../components/GenrePicks');
  const { SEARCH_GENRES } = await import('../../data/searchGenres');
  const fantasy = SEARCH_GENRES.find(g => g.label === 'Fantasy')!;
  const a = subGenreOf(fantasy, 'epic fantasy')!;
  assert.equal(a.query, 'epic fantasy');
  assert.equal(a.kind, 'fiction');
  assert.equal(subGenreOf(fantasy, 'epic fantasy'), a);
  assert.equal(subGenreOf(fantasy, 'fantasy'), null);
});
