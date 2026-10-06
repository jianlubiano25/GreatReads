// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { explicitScore, pickDiverse, trendScore, EXPLICIT_FILTER_AT, EXPLICIT_PENALTY_AT } from './trending';
import { searchRelevance, shrunkRating } from './bookSearch';
import { sameCanon, makeCanon, isbnPair, titleKey, authorKey, titlesMatch, authorListMatches } from './bookIdentity';

const book = (o: any) => ({ id: o.title, title: 'T', author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2020', genre: 'Fiction', summary: 'x'.repeat(80), authorBio: '', pageCount: 300, ...o }) as any;

test('explicit books are filtered, normal romance is not', () => {
  assert.ok(explicitScore({ title: 'Dark Desires: An Erotica Collection' }) >= EXPLICIT_FILTER_AT);
  assert.ok(explicitScore({ title: 'Book Lovers', subjects: ['Romance', 'Love stories', 'Fiction'], description: 'A witty love story about two rival editors.' }) < EXPLICIT_PENALTY_AT);
  assert.ok(explicitScore({ title: 'Beach Read', subjects: ['Romance fiction'] }) === 0);
  const dark = explicitScore({ title: 'Some Book', description: 'A steamy dark romance with sex scenes.' });
  assert.ok(dark >= EXPLICIT_PENALTY_AT);
  assert.ok(explicitScore({ title: 'X', googleMaturity: 'MATURE', description: 'steamy and kinky' }) >= EXPLICIT_FILTER_AT);
});

test('a small number of 5-star ratings cannot beat an established book', () => {
  assert.ok(shrunkRating(5, 3) < shrunkRating(4.2, 50000));
  const tiny = book({ title: 'Fruit Fly', ratingAverage: 5, ratingCount: 3 });
  const established = book({ title: 'Fruit Fly', ratingAverage: 4.2, ratingCount: 50000 });
  assert.ok(searchRelevance(established, 'fruit fly') > searchRelevance(tiny, 'fruit fly'));
});

test('a strong title match still beats a more popular loose match', () => {
  const exact = book({ title: 'Piranesi', ratingCount: 20 });
  const loose = book({ title: 'Piranesi and Other Stories of Rome', ratingAverage: 4.5, ratingCount: 90000 });
  assert.ok(searchRelevance(exact, 'piranesi') > searchRelevance(loose, 'piranesi'));
});

test('title-only search needs no author, and cover/metadata break ties', () => {
  const a = book({ title: 'Same Title', pageCount: 0, year: '', summary: '', genre: 'Book' });
  const b = book({ title: 'Same Title', coverUrl: 'https://x/y.jpg' });
  assert.ok(searchRelevance(b, 'same title') > searchRelevance(a, 'same title'));
});

test('the Top 15 keeps a mix of genres', () => {
  const items = [
    ...Array.from({ length: 8 }, (_, i) => ({ book: book({ title: `R${i}`, genre: 'Romance' }), score: 100 - i })),
    ...Array.from({ length: 4 }, (_, i) => ({ book: book({ title: `M${i}`, genre: 'Mystery' }), score: 80 - i })),
    ...Array.from({ length: 4 }, (_, i) => ({ book: book({ title: `S${i}`, genre: 'Science fiction' }), score: 78 - i })),
  ];
  const top = pickDiverse(items, 10);
  assert.equal(top.length, 10);
  assert.ok(top.filter(t => t.book.genre === 'Romance').length < 8);
  assert.ok(top.some(t => t.book.genre === 'Mystery') && top.some(t => t.book.genre === 'Science fiction'));
});

test('better metadata and reader signals lift a trending book', () => {
  const bare = book({ title: 'A', coverId: 1, pageCount: 0, year: '', summary: '', genre: 'Book' });
  const rich = book({ title: 'B', coverId: 2, ratingAverage: 4.3, ratingCount: 20000 });
  assert.ok(trendScore(rich, 5, 30) > trendScore(bare, 4, 30));
});

test('identity: same book across sources, never across different authors', () => {
  const ol = makeCanon({ title: 'Writers & Lovers', author: 'Lily King', olWork: 'OL1W' });
  const gb = makeCanon({ title: 'Writers & Lovers: A Novel', author: 'King, Lily', gbId: 'abc' });
  assert.ok(sameCanon(ol, gb));
  assert.ok(!sameCanon(ol, makeCanon({ title: 'Writers & Lovers', author: 'Someone Else' })));
  assert.ok(sameCanon(makeCanon({ title: 'x', author: 'y', isbn13: '9780802148537' }), makeCanon({ title: 'z', author: 'w', isbn13: '9780802148537' })));
  assert.deepEqual(isbnPair('0802148530'), { isbn10: '0802148530', isbn13: '9780802148537' });
  assert.equal(titleKey('The Fruit Fly: A Novel'), 'fruit fly');
  assert.equal(authorKey('King, Lily'), 'lily king');
  assert.ok(titlesMatch('Writers and Lovers', 'Writers & Lovers: A Novel'));
  assert.ok(authorListMatches(['Lily King'], 'L. King'));
  assert.ok(!authorListMatches(['Stephen King'], 'Lily King'));
});
