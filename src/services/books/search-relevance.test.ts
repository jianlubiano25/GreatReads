// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { rank, searchBooksLive, forgetRecentSearchesForTests } from './search';
import { parseQuery } from './query';
import { dominantAuthor } from './searchIntent';
import { applyCatalog, flushCatalogCopyForTests } from './catalogCovers';
import { forgetSeenForTests } from './localIndex';

const book = (o: any) => ({ id: `${o.title}|${o.author}`, title: 'T', author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2015', genre: 'Fiction', summary: 'x'.repeat(80), authorBio: '', pageCount: 300, ...o }) as any;
const top = (books: any[], text: string, n = 3, scope: any = 'all', author = '') => rank(books, parseQuery(text, author, true, scope), 20).slice(0, n).map(b => b.title);

const HP = [
  book({ title: "Harry Potter and the Philosopher's Stone", author: 'J.K. Rowling', ratingAverage: 4.5, ratingCount: 9000 }),
  book({ title: 'Harry Potter and the Chamber of Secrets', author: 'J.K. Rowling', ratingAverage: 4.4, ratingCount: 7000 }),
  book({ title: 'Harry Potter and the Prisoner of Azkaban', author: 'J.K. Rowling', ratingAverage: 4.6, ratingCount: 6000 }),
  book({ title: 'Harry Potter and Philosophy', author: 'William Irwin', ratingAverage: 3.9, ratingCount: 40 }),
  book({ title: 'The Unofficial Harry Potter Cookbook', author: 'Dinah Bucholz', ratingAverage: 4, ratingCount: 400 }),
  book({ title: 'Harry Potter: Proceedings of the Symposium', author: 'Some Press', ratingCount: 2 }),
  book({ title: 'Jane Austen: A Life', author: 'Claire Tomalin', ratingAverage: 4, ratingCount: 800 }),
  book({ title: 'Emma', author: 'Jane Austen', ratingAverage: 4, ratingCount: 5000 }),
  book({ title: 'Persuasion', author: 'Jane Austen', ratingAverage: 4.1, ratingCount: 4000 }),
  book({ title: 'Pride and Prejudice', author: 'Jane Austen', ratingAverage: 4.3, ratingCount: 9000 }),
  book({ title: 'Why Rowling Matters', author: 'Someone Else', ratingCount: 3 }),
  book({ title: 'The Casual Vacancy', author: 'J. K. Rowling', ratingAverage: 3.3, ratingCount: 3000 }),
  book({ title: 'The Cuckoo\'s Calling', author: 'Robert Galbraith', ratingAverage: 4, ratingCount: 2000 }),
];

test('"harry potter" puts Rowling\'s Harry Potter books ahead of guides, cookbooks and academic records', () => {
  const t = top(HP, 'harry potter', 3);
  assert.ok(t.every(x => /^Harry Potter and the/.test(x)), t.join(' | '));
  const all = rank(HP, parseQuery('harry potter'), 20).map(b => b.title);
  assert.ok(all.indexOf('Harry Potter and Philosophy') > all.indexOf('Harry Potter and the Prisoner of Azkaban'));
  assert.ok(all.indexOf('Harry Potter: Proceedings of the Symposium') > all.indexOf('Harry Potter and Philosophy'));
});

test('an author name (with or without initials) returns the author\'s books first, not books about her', () => {
  for (const typed of ['j.k. rowling', 'jk rowling', 'j k rowling']) {
    const t = top(HP, typed, 4);
    assert.ok(t.slice(0, 3).every(x => /^Harry Potter and the|Casual Vacancy/.test(x)), `${typed}: ${t.join(' | ')}`);
  }
  assert.deepEqual(top(HP, 'jane austen', 3).sort(), ['Emma', 'Persuasion', 'Pride and Prejudice']);
});

test('a specific title beats academic and research records with the same words (Dark Matter)', () => {
  const dm = [
    book({ title: 'Dark Matter and Dark Energy: Proceedings of the Workshop', author: 'Univ Press', ratingCount: 1, genre: 'Physics' }),
    book({ title: 'Searches for Dark Matter in Astrophysical Observations', author: 'A Researcher', ratingCount: 0 }),
    book({ title: 'Dark Matter', author: 'Blake Crouch', ratingAverage: 4.1, ratingCount: 120000 }),
    book({ title: 'Dark Matter', author: 'Michelle Paver', ratingAverage: 3.8, ratingCount: 7000 }),
  ];
  const t = top(dm, 'dark matter', 4);
  assert.equal(t[0], 'Dark Matter');
  assert.deepEqual(t.slice(2).sort(), ['Dark Matter and Dark Energy: Proceedings of the Workshop', 'Searches for Dark Matter in Astrophysical Observations'].sort());
  // and the better-known author of that title is first
  assert.equal(rank(dm, parseQuery('dark matter'), 5)[0].author, 'Blake Crouch');
});

test('ambiguous searches: no author is promoted when two authors share the title evenly; explicit filters still narrow', () => {
  const a = book({ title: 'The Stranger', author: 'Albert Camus', ratingCount: 5000, ratingAverage: 4 });
  const b = book({ title: 'The Stranger', author: 'Harlan Coben', ratingCount: 4800, ratingAverage: 4 });
  assert.equal(dominantAuthor([a, b], parseQuery('the stranger')), '');
  assert.equal(rank([b, a], parseQuery('stranger', 'camus'), 5)[0].author, 'Albert Camus'); // Author box narrows
  assert.deepEqual(rank(HP, parseQuery('rowling', '', true, 'title'), 5).map(b => b.title), ['Why Rowling Matters']); // Title filter: titles only
  assert.deepEqual(rank(HP, parseQuery('rowling', '', true, 'author'), 20).every(b => /rowling/i.test(b.author)), true);
  // a topic search is not read as an author / title intent
  assert.equal(dominantAuthor(HP, parseQuery('harry potter', '', true, 'keywords')), '');
});

test('published catalog works are candidates for a normal search, before any network answer', async () => {
  store.clear(); forgetRecentSearchesForTests(); forgetSeenForTests();
  applyCatalog([{ id: 'w1', key: 'k', title: 'Persuasion', author: 'Jane Austen', updatedAt: '2026-02-01', cover: null, genres: ['Classics'] }] as any, '2026-02-01');
  (globalThis as any).fetch = async () => ({ ok: false, status: 500, json: async () => null });
  const first: string[][] = [];
  await searchBooksLive('persuasion', { limit: 10, onUpdate: b => first.push(b.map(x => x.title)) });
  assert.ok(first.some(l => l.includes('Persuasion')), 'the catalog work is shown even when every provider fails');
  applyCatalog([], '2026-02-01');
  flushCatalogCopyForTests;
});

test('a submitted "dark matter" search asks for the most-read exact-title books too, so the novel is on page 1', async () => {
  store.clear(); forgetRecentSearchesForTests(); forgetSeenForTests();
  const ol = (key: string, title: string, author: string, extra: any = {}) => ({ key: `/works/${key}`, title, author_name: [author], first_publish_year: 2016, ...extra });
  const research = Array.from({ length: 20 }, (_, i) => ol(`OL${i}W`, `Dark Matter and Dark Energy: Proceedings ${i}`, 'Univ Press'));
  const seen: URL[] = [];
  (globalThis as any).fetch = async (input: string) => {
    const url = new URL(String(input), 'https://example.test');
    seen.push(url);
    let body: any = { items: [] };
    if (url.hostname === 'openlibrary.org') body = { docs: url.searchParams.get('sort') === 'readinglog' ? [ol('OL99W', 'Dark Matter', 'Blake Crouch', { ratings_count: 5000, ratings_average: 4.1 })] : research };
    return { ok: true, status: 200, json: async () => body };
  };
  const found = await searchBooksLive('dark matter', { limit: 10, final: true, local: false });
  assert.ok(seen.some(u => u.searchParams.get('sort') === 'readinglog' && u.searchParams.get('title') === 'dark matter'));
  assert.equal(found[0].title, 'Dark Matter');
  assert.equal(found[0].author, 'Blake Crouch');
});
