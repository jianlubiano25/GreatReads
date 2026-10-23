// Run with: npm test
// The published catalog: its cover comes after your own pick and before the old shared set; its description, bio, facts and main rating
// are shown by Book Info before any live lookup, and never overwritten by one.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

const covers = await import('./covers');
const { applyCatalog, getCatalogWork } = await import('./catalogCovers');
const { getInfo } = await import('./infoStore');

const CAT = 'https://covers.openlibrary.org/b/id/111-L.jpg';
const MINE = 'https://covers.openlibrary.org/b/id/222-L.jpg';
const work = {
  id: 'w1', key: 'strange pictures|uketsu', title: 'Strange Pictures', author: 'Uketsu', aliases: ['変な絵'], authorAliases: ['雨穴'], updatedAt: '2026-10-22T00:00:00Z', cover: CAT,
  content: [{ type: 'book_description', language: 'en', content: 'A mystery told through unsettling drawings that hide a second, darker story for the reader to uncover.' }],
  metadata: [{ field: 'year', value: '2022' }, { field: 'pageCount', value: 240 as unknown as string }],
  ratings: [{ source: 'google_books', average: 4.2, count: 350 }],
  editions: [{ isbn13: '9781234567897' }],
};

test('the catalog cover is used, and your own pick still wins', () => {
  const book = { title: 'Strange Pictures', author: 'Uketsu' };
  assert.equal(covers.getCoverPick(book), '');
  applyCatalog([work as any], work.updatedAt);
  assert.equal(covers.getCoverPickInfo(book)?.url, CAT);
  covers.setCoverPick(book, { url: MINE, source: 'openlibrary' });
  assert.equal(covers.getCoverPickInfo(book)?.url, MINE);
  covers.clearCoverPick(book);
  assert.equal(covers.getCoverPickInfo(book)?.url, CAT);
});

test('a book is found by title, by an alias and by ISBN', () => {
  assert.equal(getCatalogWork({ title: 'Strange Pictures', author: 'Uketsu' })?.id, 'w1');
  assert.equal(getCatalogWork({ title: '変な絵', author: '雨穴' })?.id, 'w1');
  assert.equal(getCatalogWork({ title: 'Something else', author: 'Nobody', isbn13: '978-1-234-56789-7' }), undefined); // an ISBN cannot override contradictory metadata
  assert.equal(getCatalogWork({ title: 'Unlisted', author: 'Nobody' }), undefined);
});

test('Book Info shows the published description, facts and rating at once', () => {
  const e = getInfo({ id: 'x', title: 'Strange Pictures', author: 'Uketsu' } as any);
  assert.match(e.facts.summary || '', /unsettling drawings/);
  assert.equal(e.facts.year, '2022');
  assert.equal(e.facts.pageCount, 240);
  assert.equal(e.ratings.google?.average, 4.2);
  assert.equal(getInfo({ id: 'y', title: 'Unlisted', author: 'Nobody' } as any).facts.summary, undefined);
});
