// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { identityOf, sameEdition, sameWork, isbnPair, titleKey, authorKey, titlesMatch, authorListMatches, bookKey, mergeIdentity } from './identity';
import { searchBooks, searchRelevance } from './search';
import { shrunkRating } from './model';
import { dedupeBooks } from './merge';
import { explicitScore, EXPLICIT_FILTER_AT, EXPLICIT_PENALTY_AT } from './quality';
import { parseNytList, nytTitleCase } from './sources/nyt';
import { sanitizeCustomBooks } from '../stateSanitizer';

const book = (o: any) => ({ id: o.title, title: 'T', author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2020', genre: 'Fiction', summary: 'x'.repeat(80), authorBio: '', pageCount: 300, ...o }) as any;

function mockFetch(handler: (url: URL) => unknown) {
  (globalThis as any).fetch = async (input: string) => {
    const body = handler(new URL(String(input), 'https://example.test'));
    return { ok: body !== null, status: body === null ? 404 : 200, json: async () => body };
  };
}

/* ---------- identity ---------- */

test('identity: work vs edition, never touching Book.id', () => {
  const a = book({ id: 'ol__works_OL1W', title: 'Writers & Lovers', author: 'Lily King' });
  assert.equal(identityOf(a).olWork, 'OL1W'); // derived from the legacy record id
  assert.equal(identityOf(book({ id: 'gb_abc123', title: 'x' })).gbVolume, 'abc123');
  const b = book({ id: 'gb_zzz', title: 'Writers & Lovers: A Novel', author: 'King, Lily', identity: { isbn13: '9780802148537' } });
  const c = book({ id: 'nyt_9780802148537', title: 'Other title', author: 'Someone', identity: { isbn13: '9780802148537' } });
  assert.ok(sameWork(a, b)); // same title/author, different record ids
  assert.ok(sameEdition(b, c) && sameWork(b, c)); // same ISBN
  assert.ok(!sameWork(a, book({ title: 'Writers & Lovers', author: 'Stephen King' })));
  assert.ok(!sameWork(book({ title: 'Untitled', author: 'Unknown Author' }), book({ id: 'z', title: 'Untitled', author: 'Unknown Author' }), true));
  assert.equal(bookKey(b), 'isbn:9780802148537');
  assert.deepEqual(mergeIdentity({ olWork: 'OL1W' }, { isbn13: '9780802148537' }), { olWork: 'OL1W', isbn13: '9780802148537' });
});

test('identity: normalisation and ISBN conversion', () => {
  assert.deepEqual(isbnPair('0802148530'), { isbn10: '0802148530', isbn13: '9780802148537' });
  assert.deepEqual(isbnPair('978-0-8021-4853-7'), { isbn13: '9780802148537', isbn10: '0802148530' });
  assert.equal(titleKey('The Fruit Fly: A Novel'), 'fruit fly');
  assert.equal(authorKey('King, Lily'), 'lily king');
  assert.equal(authorKey('Neil Gaiman & Terry Pratchett'), 'neil gaiman');
  assert.ok(titlesMatch('Writers and Lovers', 'Writers & Lovers: A Novel'));
  assert.ok(authorListMatches(['Lily King'], 'L. King'));
  assert.ok(!authorListMatches(['Stephen King'], 'Lily King'));
});

test('saved identity survives save/restore, and the earlier `canon` field is migrated', () => {
  const [kept, migrated, junk] = sanitizeCustomBooks([
    { id: 'a', title: 'A', identity: { olWork: 'OL9W', isbn13: '9780802148537', bogus: 'x' } },
    { id: 'b', title: 'B', canon: { olWork: 'OL7W', gbId: 'vol123', titleKey: 'b', authorKey: 'x' } },
    { id: 'c', title: 'C', identity: { olWork: '<script>', isbn13: '12' } },
  ]);
  assert.deepEqual(kept.identity, { olWork: 'OL9W', isbn13: '9780802148537' });
  assert.deepEqual(migrated.identity, { olWork: 'OL7W', gbVolume: 'vol123' });
  assert.equal(junk.identity, undefined);
  assert.equal(kept.id, 'a'); // ids are untouched
});

/* ---------- search ---------- */

test('a few 5-star ratings cannot beat an established book; a strong title match still wins', () => {
  assert.ok(shrunkRating(5, 3) < shrunkRating(4.2, 50000));
  const tiny = book({ title: 'Fruit Fly', ratingAverage: 5, ratingCount: 3 });
  const established = book({ title: 'Fruit Fly', ratingAverage: 4.2, ratingCount: 50000 });
  assert.ok(searchRelevance(established, 'fruit fly') > searchRelevance(tiny, 'fruit fly'));
  const exact = book({ title: 'Piranesi', ratingCount: 20 });
  const loose = book({ title: 'Piranesi and Other Stories of Rome', ratingAverage: 4.5, ratingCount: 90000 });
  assert.ok(searchRelevance(exact, 'piranesi') > searchRelevance(loose, 'piranesi'));
});

const science = Array.from({ length: 10 }, (_, i) => ({ key: `/works/OL${i}W`, title: i % 2 ? `Fruit Fly Genetics ${i}` : `The Fruit Fly: a Biology`, author_name: ['A. Scientist'], first_publish_year: 1990 + i }));
const novel = { id: 'abc123', volumeInfo: { title: 'Fruit Fly', authors: ['Josh Silver'], publishedDate: '2026-02-03', pageCount: 384, imageLinks: { thumbnail: 'http://books.google.com/x.jpg' }, industryIdentifiers: [{ type: 'ISBN_13', identifier: '9781234567897' }] } };

test('title-only search merges both sources into one result carrying both identities', async () => {
  const ol = { docs: [{ key: '/works/OL9W', title: 'Fruit Fly', author_name: ['Josh Silver'], cover_i: 555, first_publish_year: 2026 }] };
  mockFetch(url => (url.hostname === 'openlibrary.org' ? ol : { items: [novel] }));
  const results = await searchBooks('fruit fly');
  const mine = results.filter(r => r.author === 'Josh Silver');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].coverId, 555);
  assert.equal(mine[0].pageCount, 384);
  assert.equal(mine[0].id, 'ol__works_OL9W'); // the Open Library record id is kept
  assert.deepEqual(identityOf(mine[0]), { olWork: 'OL9W', gbVolume: 'abc123', isbn13: '9781234567897', isbn10: '123456789X' });
});

test('a brand-new book only Google has is found; either source being down never hides the other', async () => {
  mockFetch(url => (url.hostname === 'openlibrary.org' ? { docs: science } : { items: [novel] }));
  assert.equal((await searchBooks('Fruit Fly'))[0].author, 'Josh Silver');
  mockFetch(url => (url.hostname === 'openlibrary.org' ? null : { items: [novel] }));
  assert.equal((await searchBooks('Fruit Fly')).length, 1);
  mockFetch(url => (url.hostname === 'openlibrary.org' ? { docs: science } : null));
  assert.ok((await searchBooks('Fruit Fly')).length > 0);
  const c = new AbortController(); c.abort();
  assert.deepEqual(await searchBooks('Fruit Fly', '', 10, c.signal), []);
});

test('the same book listed twice is one result', () => {
  const list = dedupeBooks([book({ id: 'ol_1', title: 'Dune', author: 'Frank Herbert', identity: { olWork: 'OL1W' } }), book({ id: 'gb_2', title: 'Dune', author: 'Herbert, Frank', coverUrl: 'https://x/y.jpg' })]);
  assert.equal(list.length, 1);
  assert.equal(list[0].coverUrl, 'https://x/y.jpg');
  assert.equal(list[0].id, 'ol_1');
});

/* ---------- quality filter ---------- */

test('explicit books are filtered, normal romance is not', () => {
  assert.ok(explicitScore('Dark Desires: An Erotica Collection') >= EXPLICIT_FILTER_AT);
  assert.equal(explicitScore('Beach Read', { subjects: ['Romance fiction', 'Love stories'], description: 'A witty love story about two rival writers.' }), 0);
  assert.ok(explicitScore('Some Book', { description: 'A steamy dark romance with sex scenes.' }) >= EXPLICIT_PENALTY_AT);
  assert.ok(explicitScore('X', { googleMaturity: 'MATURE', description: 'steamy and kinky' }) >= EXPLICIT_FILTER_AT);
});

/* ---------- NYT ---------- */

test('NYT list keeps the NYT order and exact edition ids', () => {
  const entries = parseNytList({ results: { list_name_encoded: 'combined-print-and-e-book-fiction', published_date: '2026-10-04', books: [
    { rank: 2, rank_last_week: 1, weeks_on_list: 12, title: 'THE WOMEN', author: 'Kristin Hannah', primary_isbn13: '9781250178633', book_image: 'http://img/2.jpg' },
    { rank: 1, rank_last_week: 0, weeks_on_list: 1, title: 'IT ENDS WITH US', author: 'Colleen Hoover', primary_isbn13: '9781501110368', primary_isbn10: '1501110365', book_image: 'http://img/1.jpg' },
  ] } });
  assert.deepEqual(entries.map(e => e.rank), [1, 2]);
  assert.equal(entries[0].title, 'It Ends With Us');
  assert.equal(entries[0].isbn13, '9781501110368');
  assert.equal(entries[0].cover, 'https://img/1.jpg');
  assert.equal(nytTitleCase('Already Mixed'), 'Already Mixed');
});

test('titles: different subtitles are different books (series volumes)', () => {
  assert.equal(titlesMatch('Mistborn: The Final Empire', 'Mistborn: The Well of Ascension'), false);
  assert.equal(titlesMatch('The Lord of the Rings: The Fellowship of the Ring', 'The Lord of the Rings: The Two Towers'), false);
  assert.equal(titlesMatch('Star Wars - Thrawn', 'Star Wars - Heir to the Empire'), false);
});

test('titles: a missing, generic or shortened subtitle still matches', () => {
  assert.equal(titlesMatch('The Fruit Fly: A Novel', 'The Fruit Fly'), true);
  assert.equal(titlesMatch('Atomic Habits: An Easy & Proven Way to Build Good Habits', 'Atomic Habits'), true);
  assert.equal(titlesMatch('Atomic Habits: An Easy & Proven Way to Build Good Habits & Break Bad Ones', 'Atomic Habits: An Easy & Proven Way to Build Good Habits'), true);
  assert.equal(titlesMatch('Dune', 'Dune: Messiah'), true); // cannot be told apart safely (see Atomic Habits)
});

test('sameWork: Mistborn volumes by one author are not the same work', () => {
  const a = book({ id: 'a', title: 'Mistborn: The Final Empire', author: 'Brandon Sanderson' });
  const b = book({ id: 'b', title: 'Mistborn: The Well of Ascension', author: 'Brandon Sanderson' });
  assert.equal(sameWork(a, b), false);
  assert.equal(sameWork(a, { ...a, id: 'c' }), true);
});
