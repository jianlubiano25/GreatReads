// Run with: npm test
// The cover a RESOLVED book (Store shelves, NYT list, Pulitzer, Trending, book info) gets is English first: Apple's art, else an English Google front, else an English
// edition's Open Library cover. A Google volume in another language keeps its text but not its jacket, an Open Library cover_i that provably belongs to a translation
// is swapped for an English edition's, and one the editions say nothing about is left alone (a cover that is already right is never changed).
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { resolveBook, resolveKey } from './resolve';
import { forgetEditionsForTests } from './sources/openLibrary';
import { routeFetch } from '../store/testkit';

const isOl = (u: URL) => u.hostname === 'openlibrary.org';
const isGoogle = (u: URL) => u.hostname === 'www.googleapis.com';
const isApple = (u: URL) => u.hostname === 'itunes.apple.com';
const noApple = (u: URL) => (isApple(u) ? { body: { results: [] } } : undefined);
const GB_THUMB = 'https://books.google.com/books/content?id=gv1&printsec=frontcover&img=1&zoom=1';
const googleVolume = (title: string, author: string, language: string) => (u: URL) =>
  isGoogle(u) ? { body: { items: [{ id: 'gv1', volumeInfo: { title, authors: [author], language, publishedDate: '2020', pageCount: 300, imageLinks: { thumbnail: GB_THUMB } } }] } } : undefined;
const noGoogle = (u: URL) => (isGoogle(u) ? { body: { items: [] } } : undefined);
const olWork = (workId: string, title: string, author: string, cover: number) => (u: URL) =>
  isOl(u) && u.pathname === '/search.json' ? { body: { docs: [{ key: `/works/${workId}`, title, author_name: [author], cover_i: cover, language: ['eng', 'spa'], ratings_count: 5 }] } } : undefined;
const olEditions = (workId: string, entries: any[]) => (u: URL) => (isOl(u) && u.pathname === `/works/${workId}/editions.json` ? { body: { entries } } : undefined);
const eng = { languages: [{ key: '/languages/eng' }] };
const spa = { languages: [{ key: '/languages/spa' }] };

test('a Google volume in another language does not lend its jacket: the English Open Library edition\'s cover is shown', async () => {
  forgetEditionsForTests();
  routeFetch([noApple, googleVolume('La teoría de Let Them', 'Mel Robbins', 'es'), olWork('OL1W', 'The Let Them Theory', 'Mel Robbins', 111), olEditions('OL1W', [{ covers: [111], ...spa }, { covers: [222], ...eng }])]);
  const r = await resolveBook({ title: 'The Let Them Theory', author: 'Mel Robbins' });
  assert.equal(r?.book.coverUrl, undefined, 'the Spanish Google jacket is not used');
  assert.equal(r?.book.coverId, 222, 'cover_i 111 is the Spanish edition\'s: the English edition\'s cover replaces it');
});

test('an English Google front still beats an Open Library cover', async () => {
  forgetEditionsForTests();
  routeFetch([noApple, googleVolume('Less', 'Andrew Sean Greer', 'en'), olWork('OL2W', 'Less', 'Andrew Sean Greer', 333), olEditions('OL2W', [{ covers: [333], ...eng }])]);
  const r = await resolveBook({ title: 'Less', author: 'Andrew Sean Greer' });
  assert.equal(r?.book.coverUrl, GB_THUMB);
});

test('an Open Library cover_i that the editions do not mention is left alone, and one an English edition uses is kept', async () => {
  forgetEditionsForTests();
  routeFetch([noApple, noGoogle, olWork('OL3W', 'Unlisted Cover', 'Some Author', 444), olEditions('OL3W', [{ covers: [555], ...eng }, { covers: [666], ...spa }])]);
  assert.equal((await resolveBook({ title: 'Unlisted Cover', author: 'Some Author' }))?.book.coverId, 444);
  forgetEditionsForTests();
  routeFetch([noApple, noGoogle, olWork('OL4W', 'Shared Cover', 'Some Author', 777), olEditions('OL4W', [{ covers: [777], ...eng }, { covers: [777], ...spa }, { covers: [888], ...eng }])]);
  assert.equal((await resolveBook({ title: 'Shared Cover', author: 'Some Author' }))?.book.coverId, 777); // an English edition uses it too
});

test('with no English edition cover anywhere, the Open Library cover stays (a cover is better than none; the draw-time lookup decides about a foreign last resort)', async () => {
  forgetEditionsForTests();
  routeFetch([noApple, noGoogle, olWork('OL5W', 'Only Spanish', 'Some Author', 999), olEditions('OL5W', [{ covers: [999], ...spa }])]);
  assert.equal((await resolveBook({ title: 'Only Spanish', author: 'Some Author' }))?.book.coverId, 999);
});

test('Apple\'s art is untouched and no editions are asked for', async () => {
  forgetEditionsForTests();
  const APPLE = 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/aa/bb/cc/978.jpg/100x100bb.jpg';
  const calls = routeFetch([
    (u: URL) => (isApple(u) ? { body: { results: [{ trackId: 1, trackName: 'The Underground Railroad', artistName: 'Colson Whitehead', artworkUrl100: APPLE }] } } : undefined),
    googleVolume('El ferrocarril subterráneo', 'Colson Whitehead', 'es'),
    olWork('OL6W', 'The Underground Railroad', 'Colson Whitehead', 123),
  ]);
  const r = await resolveBook({ title: 'The Underground Railroad', author: 'Colson Whitehead', apple: true });
  assert.match(r?.book.coverUrl || '', /mzstatic\.com/);
  assert.equal(calls.filter(c => c.includes('editions.json')).length, 0);
});

// Saved by the version before the rule (no `cv`), written BEFORE the first lookup: the cache reads storage once, when it is first used
const oldBook = (title: string, coverUrl: string) => ({ book: { id: `ol_/works/${title}`, title, author: 'Some Author', coverUrl, summary: '', authorBio: '', genre: 'Book', year: '', pageCount: 0, difficulty: 0, isOnDevice: false, shelf: 'mine', spineColor: '#000' }, flags: {} });
const APPLE_SAVED = 'https://is1-ssl.mzstatic.com/image/thumb/P/a/b/600x900bb.jpg';
store.set('readlife.resolved3', JSON.stringify({
  [resolveKey({ title: 'Stale Cover', author: 'Some Author' })]: { t: Date.now(), v: oldBook('Stale Cover', GB_THUMB) },
  [resolveKey({ title: 'Apple Kept', author: 'Some Author' })]: { t: Date.now(), v: oldBook('Apple Kept', APPLE_SAVED) },
}));

test('a saved result whose non-Apple cover was chosen before the English rule is looked up again once', async () => {
  forgetEditionsForTests();
  const calls = routeFetch([noApple, noGoogle, olWork('OL7W', 'Stale Cover', 'Some Author', 31), olEditions('OL7W', [{ covers: [31], ...eng }])]);
  const first = await resolveBook({ title: 'Stale Cover', author: 'Some Author' });
  assert.ok(calls.length > 0, 'asked the sites again');
  assert.equal(first?.book.coverUrl, undefined, 'the old Google jacket is gone');
  assert.equal(first?.book.coverId, 31);
  const before = calls.length;
  await resolveBook({ title: 'Stale Cover', author: 'Some Author' });
  assert.equal(calls.length, before, 'the new result is reused');
});

test('a saved result with an Apple cover is reused as it is', async () => {
  const calls = routeFetch([() => ({ throws: true })]);
  assert.equal((await resolveBook({ title: 'Apple Kept', author: 'Some Author' }))?.book.coverUrl, APPLE_SAVED);
  assert.equal(calls.length, 0);
});
