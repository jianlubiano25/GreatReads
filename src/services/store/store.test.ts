import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreTrending, pickDiverse, TREND_WEIGHTS } from './trending';
import { nytEntryToBook, combineWithNyt } from './bestsellers';
import { identityOf } from '../books/identity';

const book = (o: any) => ({ id: o.title, title: 'T', author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2020', genre: 'Fiction', summary: 'x'.repeat(80), authorBio: '', pageCount: 300, coverId: 1, ...o }) as any;

test('trending: more signals and better data score higher, and every signal is explained', () => {
  const bare = scoreTrending({ book: book({ title: 'A', year: '', summary: '', genre: 'Book', pageCount: 0 }), dailyRank: 3, dailyTotal: 30 });
  const rich = scoreTrending({ book: book({ title: 'B', year: String(new Date().getFullYear()), ratingAverage: 4.3, ratingCount: 20000 }), dailyRank: 3, dailyTotal: 30, weeklyRank: 2, weeklyTotal: 30, nytRank: 4 });
  assert.ok(rich.score > bare.score);
  assert.ok(rich.parts.crossSource === TREND_WEIGHTS.crossSource && rich.parts.nyt > 0 && rich.parts.recency > 0);
  assert.ok(scoreTrending({ book: book({ title: 'C' }), dailyRank: 3, dailyTotal: 30, explicit: 25 }).score < scoreTrending({ book: book({ title: 'C' }), dailyRank: 3, dailyTotal: 30 }).score);
});

test('trending: a mix of genres', () => {
  const items = [
    ...Array.from({ length: 8 }, (_, i) => ({ book: book({ title: `R${i}`, genre: 'Romance' }), score: 100 - i })),
    ...Array.from({ length: 4 }, (_, i) => ({ book: book({ title: `M${i}`, genre: 'Mystery' }), score: 80 - i })),
    ...Array.from({ length: 4 }, (_, i) => ({ book: book({ title: `S${i}`, genre: 'Science fiction' }), score: 78 - i })),
  ];
  const top = pickDiverse(items, 10);
  assert.equal(top.length, 10);
  assert.ok(top.filter(t => t.book.genre === 'Romance').length < 8);
});

test('NYT shelf: resolved data fills in details but never changes the NYT title, author, label or edition', () => {
  const entry = { rank: 1, rankLastWeek: 0, weeksOnList: 1, title: 'It Ends With Us', author: 'Colleen Hoover', description: 'A novel.', publisher: 'Atria', cover: 'https://img/1.jpg', isbn13: '9781501110368', isbn10: '1501110365', list: 'x', publishedDate: '' };
  const prov = nytEntryToBook(entry, 'Fiction');
  assert.equal(prov.id, 'nyt_9781501110368');
  assert.equal(prov.awardLabel, 'NYT bestseller · new this week');
  const resolved = book({ id: 'ol__works_OL1W', title: 'It ends with us (Special Ed.)', author: 'C. Hoover', pageCount: 376, ratingAverage: 4.2, ratingCount: 9000, coverId: 77, identity: { olWork: 'OL1W' } });
  const out = combineWithNyt(prov, resolved);
  assert.equal(out.title, 'It Ends With Us');
  assert.equal(out.author, 'Colleen Hoover');
  assert.equal(out.coverUrl, 'https://img/1.jpg'); // the NYT jacket of the exact edition
  assert.equal(out.pageCount, 376);
  assert.equal(out.id, 'ol__works_OL1W');
  assert.deepEqual(identityOf(out), { olWork: 'OL1W', isbn13: '9781501110368', isbn10: '1501110365' });
  assert.equal(combineWithNyt(prov, null), prov);
});
