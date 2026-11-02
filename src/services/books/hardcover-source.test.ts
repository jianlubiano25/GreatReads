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
