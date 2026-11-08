import test from 'node:test';
import assert from 'node:assert/strict';
import { hardcoverRating, resetHardcoverForTests } from './sources/hardcover';
import { withFallbackRatings } from '../store/genreRows';

const deps = (status: number, body: any, log: string[] = []) => ({ now: () => Date.now(), fetchJson: async (u: string) => { log.push(u); return { status, body }; } });

test('hardcoverRating: takes the same title (and author) with a rating and a count', async () => {
  resetHardcoverForTests();
  const body = { books: [{ title: 'Dune Messiah', authors: ['Frank Herbert'], rating: 3.9, ratingsCount: 100 }, { title: 'Dune', authors: ['Frank Herbert'], rating: 4.27, ratingsCount: 5000 }] };
  assert.deepEqual(await hardcoverRating('Dune', 'Frank Herbert', deps(200, body)), { average: 4.27, count: 5000 });
  assert.equal(await hardcoverRating('Dune', 'Someone Else', deps(200, body)), null, 'another author');
});

test('hardcoverRating: a missing key (503) switches it off for a while, so nothing is asked again', async () => {
  resetHardcoverForTests();
  const log: string[] = [];
  assert.equal(await hardcoverRating('Dune', 'F', deps(503, { error: 'not_configured' }, log)), null);
  assert.equal(await hardcoverRating('Emma', 'J', deps(200, { books: [] }, log)), null);
  assert.equal(log.length, 1);
  resetHardcoverForTests();
});

test('withFallbackRatings: Hardcover fills a gap first and is labelled hardcover; Open Library is the next try', async () => {
  const mk = (id: string, olWork?: string) => ({ id, title: id, author: 'A B', ...(olWork ? { identity: { olWork } } : {}) }) as any;
  const out = await withFallbackRatings([mk('x'), mk('y', 'OL1W'), mk('z', 'OL2W')], async w => (w === 'OL2W' ? { average: 4.1, count: 50 } : null), 10, async t => (t === 'x' || t === 'y' ? { average: 4.4, count: 300 } : null));
  assert.deepEqual(out.map(b => b.ratingSource), ['hardcover', 'hardcover', 'openlibrary']);
});

test('a Hardcover rating is shown as Hardcover (like Open Library / Apple / Google) when nothing else rated the book', async () => {
  const { mainRating, RATING_SOURCE_LABEL } = await import('./ratings');
  const main = mainRating({ id: 'h1', source: 'openlibrary', ratingAverage: 4.3, ratingCount: 120, ratingSource: 'hardcover' } as any, []);
  assert.equal(main?.source, 'hardcover');
  assert.equal(RATING_SOURCE_LABEL[main!.source as 'hardcover'], 'Hardcover');
});

test('a Hardcover match is remembered as a fourth provider record (id, link, readers, year, cover URL, rating) and found again by title + author', async () => {
  const { hardcoverMatch } = await import('./sources/hardcover');
  const { providerFactsFor, forgetProviderFactsForTests } = await import('./providerFacts');
  const { receiptRow, receiptKind } = await import('../catalogReceipts');
  resetHardcoverForTests(); forgetProviderFactsForTests();
  const body = { books: [{ id: 312460, slug: 'dune', title: 'Dune', authors: ['Frank Herbert'], rating: 4.27, ratingsCount: 5000, readers: 90000, year: 1965, cover: 'https://assets.hardcover.app/x.jpg', description: 'long text that must not be kept' }] };
  const hit = await hardcoverMatch('Dune', 'Frank Herbert', deps(200, body));
  assert.equal(hit?.id, '312460');
  const facts = providerFactsFor({ title: 'Dune', author: 'Frank Herbert' });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].provider, 'hardcover');
  assert.deepEqual(facts[0].rating, { average: 4.27, count: 5000 });
  assert.equal(facts[0].sourceUrl, 'https://hardcover.app/books/dune');
  assert.equal(receiptKind('hardcover'), 'work');
  const row: any = receiptRow(facts[0], 'work-1');
  assert.equal(row.provider, 'hardcover');
  assert.equal(row.payload.extra.readers, 90000);
  assert.equal(row.payload.extra.cover, 'https://assets.hardcover.app/x.jpg');
  assert.ok(!JSON.stringify(row.payload).includes('long text'), 'the description text is never stored');
  assert.deepEqual(providerFactsFor({ title: 'Dune', author: 'Someone Else' }), []);
  forgetProviderFactsForTests();
});
