// Run with: npm test
// Regression tests for "Google ratings never reach the Store data". Of the 242 records in src/data/storeResolved.json, none lists Google among the
// sites that were asked and answered, and none holds a Google rating: Google could not be reached for every book of the run that wrote them (a refused
// key, a quota, a network that blocks it). That is not "Google has no rating" (the answer would then be saved as checked), yet each record was saved as
// FINAL, because a failed Google lookup only counted as worth repeating when the book had no rating at all, and Apple had rated these. And a record
// "saved by the current rules" is never fetched again, so fixing the key or the network later changed nothing.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { resolveBook } from './resolve';
import { isCurrentRecord, toPrefetchedRecord } from './prefetchRecord';
import { resetGoogleKeyForTests } from './sources/googleBooks';
import { routeFetch, type Route } from '../store/testkit';

const isGoogle = (u: URL) => u.hostname === 'www.googleapis.com';
const apple = (title: string, author: string): Route => u => (u.hostname === 'itunes.apple.com' ? { body: { results: [{ trackId: 7, trackName: title, artistName: author, artworkUrl100: 'https://a/100x100bb.jpg', averageUserRating: 4.5, userRatingCount: 8272 }] } } : undefined);
const olEmpty: Route = u => (u.hostname === 'openlibrary.org' ? { body: { docs: [], summary: {} } } : undefined);
const gbVolume = (title: string, author: string, rating?: [number, number]) => ({ id: 'v1', volumeInfo: { title, authors: [author], publishedDate: '1965', pageCount: 600, description: 'x'.repeat(80), ...(rating ? { averageRating: rating[0], ratingsCount: rating[1] } : {}) } });

test('prefetch: Google unreachable while Apple has rated the book is NOT final: it is asked again on the next run', async () => {
  resetGoogleKeyForTests();
  routeFetch([apple('Dune One', 'Frank Herbert'), olEmpty, u => (isGoogle(u) ? { status: 503, body: {} } : undefined)]);
  const r = await resolveBook({ title: 'Dune One', author: 'Frank Herbert', apple: true, allSources: true });
  assert.equal(r?.book.ratingSource, 'apple');
  assert.ok(!r?.checked?.includes('google'), 'Google was not reached, so it is not recorded as asked and answered');
  assert.ok(r?.retry, 'the result waits for Google');
  const rec = toPrefetchedRecord('Dune One', r!);
  assert.equal(rec.rv, undefined, 'a record that waits for a site is not stamped final');
  assert.equal(isCurrentRecord(rec, 'Dune One'), false);
});

test('prefetch: Google answered with no rating for the book: final, recorded as checked, nothing to repeat', async () => {
  resetGoogleKeyForTests();
  routeFetch([apple('Dune Two', 'Frank Herbert'), olEmpty, u => (isGoogle(u) ? { body: { items: [gbVolume('Dune Two', 'Frank Herbert')] } } : undefined)]);
  const r = await resolveBook({ title: 'Dune Two', author: 'Frank Herbert', apple: true, allSources: true });
  assert.ok(r?.checked?.includes('google'));
  assert.equal(r?.retry, undefined);
  assert.equal(isCurrentRecord(toPrefetchedRecord('Dune Two', r!), 'Dune Two'), true);
});

test('prefetch: a Google rating is kept beside the one the ladder chose', async () => {
  resetGoogleKeyForTests();
  routeFetch([apple('Dune Three', 'Frank Herbert'), olEmpty, u => (isGoogle(u) ? { body: { items: [gbVolume('Dune Three', 'Frank Herbert', [4, 120])] } } : undefined)]);
  const r = await resolveBook({ title: 'Dune Three', author: 'Frank Herbert', apple: true, allSources: true });
  const rec = toPrefetchedRecord('Dune Three', r!);
  assert.deepEqual(rec.sources?.google, [4, 120]);
  assert.ok(rec.checked?.includes('google'));
  assert.equal(isCurrentRecord(rec, 'Dune Three'), true);
});

test('a saved record that never recorded Google as asked and answered (every record saved so far) is fetched again', () => {
  const saved = { title: 'Dune', coverUrl: 'https://c/1.jpg', ratingAverage: 4.5, ratingCount: 8272, ratingSource: 'apple' as const, sources: { openlibrary: [4.3, 448] as [number, number], apple: [4.5, 8272] as [number, number] }, checked: ['openlibrary' as const, 'apple' as const], rv: 3 };
  assert.equal(isCurrentRecord(saved, 'Dune'), false);
  assert.equal(isCurrentRecord({ ...saved, checked: [...saved.checked, 'google' as const] }, 'Dune'), true);
});

test('in the app (no allSources) a Google failure behind an Apple rating is still left to the book info, as before', async () => {
  resetGoogleKeyForTests();
  routeFetch([apple('Dune Four', 'Frank Herbert'), olEmpty, u => (isGoogle(u) ? { status: 503, body: {} } : undefined)]);
  const r = await resolveBook({ title: 'Dune Four', author: 'Frank Herbert', apple: true });
  assert.equal(r?.retry, undefined);
  assert.equal(r?.book.ratingSource, 'apple');
});
