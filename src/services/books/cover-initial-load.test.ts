// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { titleKey, titlesMatch, authorsCompatible } from './identity';
import { mergeBooks } from './merge';
import { applyAddBook } from '../library';
import { findApple } from './sources/appleBooks';
import { routeFetch } from '../store/testkit';

test('a title in another script keeps a key, so its own listing matches (変な絵 used to reduce to "" and match nothing)', () => {
  assert.notEqual(titleKey('変な絵'), '');
  assert.ok(titlesMatch('変な絵', '変な絵'));
  assert.ok(!titlesMatch('変な家', '変な絵'), 'a different Japanese title is a different book');
  assert.ok(!titlesMatch('The Housemaid', '変な絵'));
  assert.equal(titleKey('The Fruit Fly: A Novel'), 'fruit fly'); // Latin titles key exactly as before
});

test('Nettle & Bone: a shared work ID does not override conflicting author metadata', () => {
  assert.ok(titlesMatch('Nettle and Bone', 'Nettle & Bone'));
  assert.ok(!authorsCompatible('T. Kingfisher', 'Ursula Vernon'), 'nothing is known yet: no hard-coded pen names');
  const apple: any = { id: 'a1', title: 'Nettle & Bone', author: 'T. Kingfisher', source: 'apple', identity: { olWork: 'OL1W' } };
  const ol: any = { id: 'o1', title: 'Nettle & Bone', author: 'Ursula Vernon', source: 'openlibrary', identity: { olWork: 'OL1W' } };
  assert.equal(mergeBooks(ol, apple).author, 'Ursula Vernon');
  assert.equal(mergeBooks(apple, ol).author, 'T. Kingfisher');
  // The ID conflict cannot teach a new author alias. Open Library alternate-name evidence is tested below.
  assert.equal(authorsCompatible('T. Kingfisher', 'Ursula Vernon'), false);
  assert.equal(displayBook({ ...ol, id: 'saved' }).author, 'Ursula Vernon');
  assert.equal(displayBook({ ...apple }).author, 'T. Kingfisher');
  assert.ok(!authorsCompatible('Stephen King', 'Ursula Vernon'));
  // Conflicting author metadata is not silently folded into an existing personal record.
  const state: any = { customBooks: [{ ...apple }], hiddenBookIds: {}, status: {}, ratings: {}, onDeviceOverrides: {}, history: {}, highlights: {}, notes: {}, currentPage: {}, totalPages: {} };
  const next = applyAddBook(state, { ...ol, id: 'o2' }, 'library');
  assert.equal(next.customBooks.filter((b: any) => /nettle/i.test(b.title)).length, 2);
});

test('Open Library listing an author\'s other names teaches the group (a saved Ursula Vernon book then shows the jacket name once Apple prints it)', async () => {
  routeFetch([u => (u.hostname === 'openlibrary.org' && u.pathname === '/search.json' ? { body: { numFound: 1, docs: [{ key: '/works/OL9W', title: 'Swordheart', author_name: ['Ursula Vernon'], author_alternative_name: ['T. Kingfisher', 'Ursula K. Vernon'] }] } } : undefined)]);
  await findOpenLibrary({ title: 'Swordheart', author: 'T. Kingfisher' });
  assert.ok(authorsCompatible('T. Kingfisher', 'Ursula Vernon'));
  assert.ok(authorsCompatible('Ursula K. Vernon', 'T. Kingfisher'));
});

test('Apple: a Japanese listing is accepted for a Japanese title (not dropped as "foreign"), an unrelated book is not', async () => {
  routeFetch([u => (u.hostname.includes('itunes.apple.com') ? { body: { results: [
    { trackId: 9, trackName: '変な家', artistName: '雨穴', languageCodesISO2A: ['JA'], artworkUrl100: 'https://is1-ssl.mzstatic.com/a/100x100bb.jpg' },
    { trackId: 1, trackName: '変な絵', artistName: '雨穴', languageCodesISO2A: ['JA'], artworkUrl100: 'https://is1-ssl.mzstatic.com/b/100x100bb.jpg' },
  ] } } : undefined)]);
  const hit = await findApple({ title: '変な絵', author: 'Uketsu' });
  assert.equal(hit?.book.id, 'apple_1');
});

import { resolveCover } from './covers';

test('a visible cover is looked up before the queued background ones, and background ones never fill every slot', async () => {
  store.clear();
  const order: string[] = [];
  routeFetch([u => {
    if (u.hostname.includes('itunes.apple.com')) order.push(decodeURIComponent(u.searchParams.get('term') || '').split(' ')[0]);
    return u.hostname.includes('itunes.apple.com') ? { body: { results: [] } } : u.hostname === 'openlibrary.org' ? { body: { docs: [] } } : { body: { items: [] } };
  }]);
  const mk = (n: number) => ({ id: `q${n}`, title: `Queue${n}`, author: 'Some Writer' } as any);
  const background = Array.from({ length: 10 }, (_, i) => resolveCover(mk(i), { background: true }));
  const visible = resolveCover(mk(99));
  await Promise.all([...background, visible]);
  assert.ok(order.indexOf('Queue99') >= 0 && order.indexOf('Queue99') <= 2, `visible book started early: ${order.slice(0, 5).join(', ')}`);
});

import { englishTitleOf, displayBook } from './englishTitle';
import { findOpenLibrary } from './sources/openLibrary';
import { sanitizeCustomBooks } from '../stateSanitizer';

test('a saved book titled in Japanese gets its English title; an English title is left alone', async () => {
  assert.equal(await englishTitleOf({ id: 'j', title: '変な絵', author: 'Uketsu' } as any), 'Strange Pictures');
  assert.equal(await englishTitleOf({ id: 'e', title: 'The Housemaid', author: 'Freida McFadden' } as any), '');
});

test('the original title survives a save / restore (it is how the Japanese title still finds the book)', () => {
  const [b] = sanitizeCustomBooks([{ id: 1, title: 'Strange Pictures', author: 'Uketsu', originalTitle: '変な絵' }]);
  assert.equal(b.originalTitle, '変な絵');
});

test('a Japanese title is shown in English at once (no wait, no saved-record change), the original kept for search, English titles untouched', () => {
  const b: any = { id: 'j', title: '変な絵', author: 'Uketsu' };
  const shown = displayBook(b);
  assert.equal(shown.title, 'Strange Pictures');
  assert.equal(shown.originalTitle, '変な絵');
  assert.equal(b.title, '変な絵');
  const eng: any = { id: 'e', title: 'The Housemaid', author: 'Freida McFadden' };
  assert.equal(displayBook(eng), eng);
});
