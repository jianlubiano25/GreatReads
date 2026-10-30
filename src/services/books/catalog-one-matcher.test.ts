// Run with: npm test
// S1 of the "one path" plan: the cover chain, Book Info and rejected covers find the published catalog work with the SAME matcher
// (ISBN from the book's identity, title/author with aliases and author aliases, spelling normalised; duplicates never decided by storage order).
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

const covers = await import('./covers');
const { applyCatalog, getCatalogCoverFor, getCatalogWork } = await import('./catalogCovers');
const { getInfo } = await import('./infoStore');
const { isCoverRejected } = await import('./rejectedCovers');

const CAT = 'https://covers.openlibrary.org/b/id/111-L.jpg';
const OTHER = 'https://covers.openlibrary.org/b/id/333-L.jpg';
const work = {
  id: 'w1', key: 'strange pictures|uketsu', title: 'Strange Pictures', author: 'Uketsu', aliases: ['Henna E'], authorAliases: ['Uketsu Ame'], updatedAt: '2026-10-30T00:00:00Z', cover: CAT,
  rejectedCovers: ['https://covers.openlibrary.org/b/id/999-L.jpg'],
  ratings: [{ source: 'apple_books', average: 4.4, count: 120 }],
  editions: [{ isbn13: '9781234567897' }],
};
applyCatalog([work as any], work.updatedAt);

test('the cover chain finds the catalog cover by author alias (it used to need the main author spelling)', () => {
  assert.equal(covers.getCoverPickInfo({ title: 'Strange Pictures', author: 'Uketsu Ame' })?.url, CAT);
  assert.equal(covers.getCoverPickInfo({ title: 'Henna E', author: 'Uketsu Ame' })?.url, CAT, 'title alias + author alias');
});

test('the cover chain and Book Info find the work by the ISBN in the book identity, whatever the title says', () => {
  const b = { id: 'z', title: 'A Totally Different Title', author: 'Someone Else', identity: { isbn13: '978-1-234-56789-7' } };
  assert.equal(covers.getCoverPickInfo(b)?.url, CAT);
  assert.equal(getInfo(b as any).ratings.apple?.average, 4.4, 'the published rating reaches a book found only by ISBN');
  assert.equal(getCatalogWork(b)?.id, 'w1');
});

test('spelling differences in case and punctuation still match', () => {
  assert.equal(covers.getCoverPickInfo({ title: 'STRANGE   pictures', author: 'uketsu' })?.url, CAT);
});

test('rejected covers are found by the same match (identity ISBN included)', () => {
  const b = { title: 'Another Name', author: 'Nobody', identity: { isbn13: '9781234567897' } };
  assert.equal(isCoverRejected(b, 'https://covers.openlibrary.org/b/id/999-S.jpg'), true);
  assert.equal(isCoverRejected(b, CAT), false);
});

test('a book that is not in the catalog gets nothing (no guessing)', () => {
  assert.equal(getCatalogCoverFor({ title: 'Unlisted', author: 'Nobody' }), undefined);
  assert.equal(getCatalogWork({ title: 'Unlisted', author: 'Nobody', identity: { isbn13: '9780000000002' } }), undefined);
});

test('duplicates: the same cover is used, different covers are not (storage order never decides)', () => {
  applyCatalog([{ ...work, id: 'w2', key: null, cover: CAT } as any]);
  assert.equal(getCatalogCoverFor({ title: 'Strange Pictures', author: 'Uketsu' }), CAT, 'both works agree');
  assert.equal(getCatalogWork({ title: 'Strange Pictures', author: 'Uketsu' }), undefined, 'metadata still needs one clear work');
  applyCatalog([{ ...work, id: 'w3', key: null, cover: OTHER } as any]);
  assert.equal(getCatalogCoverFor({ title: 'Strange Pictures', author: 'Uketsu' }), undefined, 'they disagree');
});
