// Run with: npm test
// Book Info manual refresh: lifts the wait, keeps what is shown until the new answer replaces it.
import test from 'node:test';
import assert from 'node:assert/strict';
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
import { ensureBookInfo, getInfo, missingFields, resetInfoWaits, siteRatingsOf, setInfoClockForTests } from './infoStore';
import { routeFetch } from '../store/testkit';

let now = 1_900_000_000_000;
setInfoClockForTests(() => now);
const book = { id: 'r1', title: 'Refresh Alpha', author: 'Rae Author', shelf: 'mine', difficulty: 0, isOnDevice: false, year: '', genre: 'Fiction', summary: 'x'.repeat(200), authorBio: 'y'.repeat(200), pageCount: 0 } as any;
const gb = (avg: number, n: number) => (u: URL) => (u.hostname === 'www.googleapis.com' ? { body: { items: [{ id: 'g', volumeInfo: { title: 'Refresh Alpha', authors: ['Rae Author'], publishedDate: '2018', pageCount: 222, averageRating: avg, ratingsCount: n } }] } } : undefined);
const none = (u: URL) => (u.hostname === 'openlibrary.org' ? { body: { docs: [], works: [], summary: {} } } : u.hostname === 'itunes.apple.com' ? { body: { results: [] } } : undefined);

test('refresh keeps the old rating on screen, then replaces it with the new answer', async () => {
  routeFetch([none, gb(3.5, 40)]);
  await ensureBookInfo(book);
  assert.equal(siteRatingsOf(getInfo(book)).find(r => r.source === 'google')?.average, 3.5);
  assert.ok(!missingFields(book).includes('rating:google')); // fresh: nothing would be asked

  resetInfoWaits(book, ['rating:google']);
  assert.equal(siteRatingsOf(getInfo(book)).find(r => r.source === 'google')?.average, 3.5); // still shown while we ask
  assert.ok(missingFields(book).includes('rating:google')); // but now due

  routeFetch([none, gb(4.4, 90)]);
  await ensureBookInfo(book, ['lookup']);
  assert.equal(siteRatingsOf(getInfo(book)).find(r => r.source === 'google')?.average, 4.4);
});

test('refresh lifts a "not found" / failed wait so the empty fact is asked again at once', async () => {
  const b2 = { ...book, id: 'r2', title: 'Refresh Beta', author: 'Bo Author' };
  routeFetch([() => ({ throws: true })]);
  await ensureBookInfo(b2); // everything fails: waits are set
  assert.equal(missingFields(b2).includes('year'), false); // waiting out the failure
  resetInfoWaits(b2, ['year', 'pageCount', 'genre']);
  assert.equal(missingFields(b2).includes('year'), true);
});
