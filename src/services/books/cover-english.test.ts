// Run with: npm test
// Covers prefer English: an English edition's jacket wins over another language's, a foreign jacket is a last resort for a book with no cover at all
// (never a replacement for a cover the book already has), and a repaired cover is drawn at the card's size so it is ONE URL for one picture.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { resolveCover, getCoverUrl, sizedCoverUrl } from './covers';
import { routeFetch } from '../store/testkit';

const isOl = (u: URL) => u.hostname === 'openlibrary.org';
const isGoogle = (u: URL) => u.hostname === 'www.googleapis.com';
const isApple = (u: URL) => u.hostname === 'itunes.apple.com';
const noApple = (u: URL) => (isApple(u) ? { body: { results: [] } } : undefined);
const googleVolume = (title: string, author: string, language: string, thumb: string) => (u: URL) =>
  isGoogle(u) ? { body: { items: [{ id: 'gv1', volumeInfo: { title, authors: [author], language, imageLinks: { thumbnail: thumb } } }] } } : undefined;
const olWork = (workId: string, title: string, author: string, cover: number, language: string[]) => (u: URL) =>
  isOl(u) && u.pathname === '/search.json' ? { body: { docs: [{ key: `/works/${workId}`, title, author_name: [author], cover_i: cover, language, ratings_count: 5 }] } } : undefined;
const olEditions = (workId: string, entries: any[]) => (u: URL) => (isOl(u) && u.pathname === `/works/${workId}/editions.json` ? { body: { entries } } : undefined);
const none = (u: URL) => (isOl(u) || isGoogle(u) ? { body: { docs: [], items: [] } } : undefined);
const FR_THUMB = 'https://books.google.com/books/content?id=gv1&printsec=frontcover&img=1&zoom=1';

test('an English edition\'s cover is chosen before the work\'s cover_i and before another language\'s Google jacket', async () => {
  routeFetch([
    noApple,
    googleVolume('Le Petit Prince', 'Antoine de Saint-Exupery', 'fr', FR_THUMB),
    olWork('OL1W', 'Le Petit Prince', 'Antoine de Saint-Exupery', 111, ['eng', 'fre']), // cover_i 111 could be any edition
    olEditions('OL1W', [{ covers: [333], languages: [{ key: '/languages/fre' }] }, { covers: [222], languages: [{ key: '/languages/eng' }] }]),
  ]);
  const url = await resolveCover({ id: 'a1', title: 'Le Petit Prince', author: 'Antoine de Saint-Exupery' } as any);
  assert.equal(url, 'https://covers.openlibrary.org/b/id/222-M.jpg');
});

test('a book with no cover and no English one anywhere still gets another language\'s jacket (better than a blank)', async () => {
  routeFetch([noApple, googleVolume('Samguk Yusa', 'Iryeon', 'ko', FR_THUMB), olWork('OL2W', 'Samguk Yusa', 'Iryeon', 444, ['kor']), olEditions('OL2W', [{ covers: [555], languages: [{ key: '/languages/kor' }] }])]);
  const url = await resolveCover({ id: 'a2', title: 'Samguk Yusa', author: 'Iryeon' } as any);
  assert.ok(url.startsWith('https://books.google.com/') || url === 'https://covers.openlibrary.org/b/id/444-M.jpg', url);
});

test('a book that already has a cover is never given another language\'s jacket in its place', async () => {
  routeFetch([noApple, googleVolume('Madame Bovary', 'Gustave Flaubert', 'fr', FR_THUMB), none]);
  const url = await resolveCover({ id: 'a3', title: 'Madame Bovary', author: 'Gustave Flaubert', coverUrl: 'https://own.example/bovary.jpg' } as any);
  assert.equal(url, '');
});

test('a repaired cover and the same picture arriving through the book\'s own link are ONE url at every card size', () => {
  const apple = 'https://is1-ssl.mzstatic.com/image/thumb/Pub/a/b/600x900bb.jpg';
  for (const size of ['S', 'M', 'L'] as const) assert.equal(sizedCoverUrl(apple, size), getCoverUrl(undefined, size, apple));
  assert.equal(sizedCoverUrl(apple, 'M'), 'https://is1-ssl.mzstatic.com/image/thumb/Pub/a/b/360x540bb.jpg');
  const ol = 'https://covers.openlibrary.org/b/id/222-M.jpg';
  assert.equal(sizedCoverUrl(ol, 'M'), ol); // other sources are not rewritten
});
