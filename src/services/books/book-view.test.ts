// Run with: npm test
// S2: every screen asks ONE function (knownCover) which cover a book already has: your pick, then the published catalog (same matcher as Book Info),
// then the book's own link; nothing known = '' (the only case that shows a placeholder).
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

const covers = await import('./covers');
const { applyCatalog } = await import('./catalogCovers');

const CAT = 'https://covers.openlibrary.org/b/id/111-L.jpg';
const MINE = 'https://covers.openlibrary.org/b/id/222-L.jpg';
const OWN = 'https://covers.openlibrary.org/b/id/333-L.jpg';

test('nothing known gives an empty answer (placeholder only then); the book\'s own link is used when it is all there is', () => {
  const b: any = { id: 'a', title: 'Plain Book', author: 'Ann Author' };
  assert.deepEqual(covers.knownCover(b), { url: '', from: '' });
  const k = covers.knownCover({ ...b, coverUrl: OWN });
  assert.equal(k.from, 'own');
  assert.ok(k.url.includes('333'));
});

test('the published catalog cover beats the book\'s own link, found by title, alias, author alias or ISBN identity; your pick beats the catalog', () => {
  applyCatalog([{ id: 'w1', key: 'strange pictures|uketsu', title: 'Strange Pictures', author: 'Uketsu', aliases: ['Henna E'], authorAliases: ['Uketsu Ame'], updatedAt: '2026-10-30T00:00:00Z', cover: CAT, editions: [{ isbn13: '9781234567897' }] } as any]);
  const variants: any[] = [
    { id: '1', title: 'Strange Pictures', author: 'Uketsu', coverUrl: OWN },
    { id: '2', title: 'Henna E', author: 'Uketsu Ame', coverUrl: OWN },
    { id: '3', title: 'Whatever', author: 'Nobody', identity: { isbn13: '9781234567897' }, coverUrl: OWN },
  ];
  for (const v of variants) { const k = covers.knownCover(v); assert.equal(k.from, 'pick', v.title); assert.ok(k.url.includes('111'), v.title); }
  covers.setCoverPick(variants[0], { url: MINE, source: 'openlibrary' });
  assert.ok(covers.knownCover(variants[0]).url.includes('222'));
  covers.clearCoverPick(variants[0]);
  assert.ok(covers.knownCover(variants[0]).url.includes('111'));
});

test('the size is applied the same way as before (an Apple link is drawn at the card size, never bigger than needed)', () => {
  const apple = 'https://is1-ssl.mzstatic.com/image/thumb/P/v4/ab/art/600x900bb.jpg';
  const small = covers.knownCover({ id: '9', title: 'Sized', author: 'Ann Author', coverUrl: apple } as any, 'S');
  assert.equal(small.from, 'own');
  assert.equal(small.url, covers.ownCoverUrl({ title: 'Sized', author: 'Ann Author', coverUrl: apple }, 'S'), 'exactly what the cards drew before');
  assert.notEqual(small.url, apple);
});
