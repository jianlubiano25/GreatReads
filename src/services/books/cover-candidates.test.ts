// Run with: npm test
// The cover viewer's covers: every source answers on its own and hands its covers over as they arrive, a book is asked once however many
// callers want it, a finished lookup is remembered, and a lookup hurt by a network failure is not.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { imageKey, loadCoverCandidates, type CoverCandidate } from './covers';
import { routeFetch } from '../store/testkit';

const isOl = (u: URL) => u.hostname === 'openlibrary.org';
const isGoogle = (u: URL) => u.hostname === 'www.googleapis.com';
const isApple = (u: URL) => u.hostname === 'itunes.apple.com';
const olSearch = (key: string, title: string, author: string, cover: number) => (u: URL) =>
  isOl(u) && u.pathname === '/search.json' ? { body: { docs: [{ key, title, author_name: [author], cover_i: cover }] } } : undefined;
const olEditions = (workId: string, entries: any[]) => (u: URL) => (isOl(u) && u.pathname === `/works/${workId}/editions.json` ? { body: { entries } } : undefined);
const google = (id: string, title: string, author: string, thumb: string) => (u: URL) =>
  isGoogle(u) ? { body: { items: [{ id, volumeInfo: { title, authors: [author], imageLinks: { thumbnail: thumb } } }] } } : undefined;
const apple = (title: string, author: string, art = 'https://is1-ssl.mzstatic.com/image/thumb/Pub/a/b/100x100bb.jpg') => (u: URL) =>
  isApple(u) ? { body: { results: [{ trackId: 9, trackName: title, artistName: author, artworkUrl100: art }] } } : undefined;
const hosts = (calls: string[], pred: (u: URL) => boolean) => calls.filter(c => pred(new URL(c, 'https://x.test'))).length;
const mk = (title: string, author: string, extra: any = {}) => ({ id: `saved-${title}`, title, author, ...extra }) as any;
const urls = (l: CoverCandidate[]) => l.map(c => c.url);
const EDITIONS = [
  { covers: [222], languages: [{ key: '/languages/eng' }] },
  { covers: [333], languages: [{ key: '/languages/fre' }] }, // a translation: skipped
  { covers: [-1] }, // no real cover
  { covers: [444] }, // no language recorded: kept
  { covers: [222] }, // the same picture again
];

test('every source adds its covers: Open Library editions, Google Books and Apple Books, each with its source', async () => {
  routeFetch([
    olSearch('/works/OL9W', 'Many Covers', 'Ann Author', 111), olEditions('OL9W', EDITIONS),
    google('g1', 'Many Covers', 'Ann Author', 'http://books.google.com/books/content?id=g1&zoom=1&edge=curl'),
    apple('Many Covers', 'Ann Author'),
  ]);
  const updates: CoverCandidate[][] = [];
  const final = await loadCoverCandidates(mk('Many Covers', 'Ann Author'), l => updates.push(l));
  const bySource = (s: string) => urls(final.filter(c => c.source === s));
  assert.deepEqual(bySource('openlibrary'), ['https://covers.openlibrary.org/b/id/111-L.jpg', 'https://covers.openlibrary.org/b/id/222-L.jpg', 'https://covers.openlibrary.org/b/id/444-L.jpg']);
  assert.deepEqual(bySource('google'), ['https://books.google.com/books/content?id=g1&zoom=1']);
  assert.deepEqual(bySource('apple'), ['https://is1-ssl.mzstatic.com/image/thumb/Pub/a/b/600x900bb.jpg']);
  assert.equal(final.length, 5);
  // covers arrive as each source answers, and the list only ever grows (nothing jumps while the viewer is open)
  assert.ok(updates.length >= 1);
  updates.forEach((l, i) => i && assert.deepEqual(urls(l).slice(0, updates[i - 1].length), urls(updates[i - 1])));
  assert.deepEqual(urls(updates.at(-1)!), urls(final));
});

test('a book is asked once: callers share a running lookup, and a reopen is answered from this device', async () => {
  const calls = routeFetch([olSearch('/works/OL10W', 'Once Only', 'Bo Writer', 5), olEditions('OL10W', [{ covers: [6] }]), google('g2', 'Once Only', 'Bo Writer', 'https://g/x?id=2'), apple('Once Only', 'Bo Writer')]);
  const [a, b] = await Promise.all([loadCoverCandidates(mk('Once Only', 'Bo Writer'), () => {}), loadCoverCandidates(mk('once only', 'Bo Writer'), () => {})]);
  assert.deepEqual(urls(a), urls(b));
  const used = calls.length;
  assert.equal(hosts(calls, isApple), 1);
  assert.equal(hosts(calls, isGoogle) >= 1, true);

  let seen: CoverCandidate[] = [];
  const again = await loadCoverCandidates(mk('Once Only', 'Bo Writer'), l => { seen = l; });
  assert.equal(calls.length, used, 'a second open must make no request');
  assert.deepEqual(urls(again), urls(a));
  assert.deepEqual(urls(seen), urls(a)); // and it is shown at once
});

test('a book whose Open Library work is known goes straight to its editions (no search)', async () => {
  const calls = routeFetch([olEditions('OL11W', [{ covers: [8] }, { covers: [9] }]), google('g3', 'Known Work', 'Cy Author', 'https://g/y?id=3'), apple('Known Work', 'Cy Author')]);
  const final = await loadCoverCandidates(mk('Known Work', 'Cy Author', { id: 'ol_/works/OL11W', coverId: 7 }), () => {});
  assert.equal(calls.filter(c => c.includes('/search.json')).length, 0);
  assert.deepEqual(urls(final.filter(c => c.source === 'openlibrary')), ['7', '8', '9'].map(n => `https://covers.openlibrary.org/b/id/${n}-L.jpg`));
});

test('a source that has nothing, or is down, only means fewer covers', async () => {
  routeFetch([olSearch('/works/OL12W', 'Partial', 'Di Author', 21), olEditions('OL12W', []), (u: URL) => (isGoogle(u) ? { status: 500, body: {} } : undefined), (u: URL) => (isApple(u) ? { throws: true } : undefined)]);
  const final = await loadCoverCandidates(mk('Partial', 'Di Author'), () => {});
  assert.deepEqual(urls(final), ['https://covers.openlibrary.org/b/id/21-L.jpg']);
});

test('a lookup hurt by a network failure is not remembered; the next open asks again', async () => {
  const calls = routeFetch([olSearch('/works/OL13W', 'Flaky', 'Ed Author', 31), olEditions('OL13W', []), google('g4', 'Flaky', 'Ed Author', 'https://g/z?id=4'), (u: URL) => (isApple(u) ? { status: 503, body: {} } : undefined)]);
  await loadCoverCandidates(mk('Flaky', 'Ed Author'), () => {});
  const first = hosts(calls, isApple);
  assert.ok(first >= 1);
  await loadCoverCandidates(mk('Flaky', 'Ed Author'), () => {});
  assert.ok(hosts(calls, isApple) > first, 'the failed lookup must be repeated');
});

test('an aborted caller stops hearing about covers but the lookup finishes and is remembered', async () => {
  const calls = routeFetch([olSearch('/works/OL14W', 'Abort Me', 'Fy Author', 41), olEditions('OL14W', []), google('g5', 'Abort Me', 'Fy Author', 'https://g/w?id=5'), apple('Abort Me', 'Fy Author')]);
  const ac = new AbortController();
  let heard = 0;
  const p = loadCoverCandidates(mk('Abort Me', 'Fy Author'), () => { heard++; }, ac.signal);
  ac.abort();
  const final = await p;
  assert.equal(heard, 0);
  const used = calls.length;
  assert.equal(final.length, 3);
  await loadCoverCandidates(mk('Abort Me', 'Fy Author'), () => {});
  assert.equal(calls.length, used);
});

test('the same picture at another size is the same cover', () => {
  assert.equal(imageKey('https://covers.openlibrary.org/b/id/5-S.jpg'), imageKey('https://covers.openlibrary.org/b/id/5-L.jpg'));
  assert.notEqual(imageKey('https://covers.openlibrary.org/b/id/5-L.jpg'), imageKey('https://covers.openlibrary.org/b/id/6-L.jpg'));
  assert.equal(imageKey('https://is1-ssl.mzstatic.com/image/thumb/P/a/200x300bb.jpg'), imageKey('https://is1-ssl.mzstatic.com/image/thumb/P/a/600x900bb.jpg'));
  assert.equal(imageKey('https://books.google.com/books/content?id=1&zoom=1'), imageKey('https://books.google.com/books/content?id=1&zoom=2'));
  assert.notEqual(imageKey('https://books.google.com/books/content?id=1&zoom=1'), imageKey('https://books.google.com/books/content?id=2&zoom=1'));
});
