// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { titleKey, titlesMatch, authorsCompatible } from './identity';
import { findApple } from './sources/appleBooks';
import { routeFetch } from '../store/testkit';

test('a title in another script keeps a key, so its own listing matches (変な絵 used to reduce to "" and match nothing)', () => {
  assert.notEqual(titleKey('変な絵'), '');
  assert.ok(titlesMatch('変な絵', '変な絵'));
  assert.ok(!titlesMatch('変な家', '変な絵'), 'a different Japanese title is a different book');
  assert.ok(!titlesMatch('The Housemaid', '変な絵'));
  assert.equal(titleKey('The Fruit Fly: A Novel'), 'fruit fly'); // Latin titles key exactly as before
});

test('Nettle & Bone: "&" = "and", and the pen name is the same writer as the real name', () => {
  assert.ok(titlesMatch('Nettle and Bone', 'Nettle & Bone'));
  assert.ok(authorsCompatible('T. Kingfisher', 'Ursula Vernon'));
  assert.ok(authorsCompatible('T. Kingfisher (Ursula Vernon)', 'T. Kingfisher'));
  assert.ok(!authorsCompatible('T. Kingfisher', 'Stephen King'));
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
