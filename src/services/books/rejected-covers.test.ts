// Run with: npm test
// A cover the owner rejected is not shown or used for anyone: the catalog carries the rejected addresses and every cover path skips them.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

const { applyCatalog } = await import('./catalogCovers');
const { isCoverRejected } = await import('./rejectedCovers');
const { getCoverPickInfo } = await import('./coverPicks');
const { ownCoverUrl, getCoverFix } = await import('./coverLookup');

const bad = 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/aa/bb/cc/9780.d.jpg/600x900bb.jpg';
const good = 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/dd/ee/ff/9781.d.jpg/600x900bb.jpg';
applyCatalog([
  { id: 'w1', key: 'kin|tayari jones', title: 'Kin', author: 'Tayari Jones', updatedAt: '2026-10-22T00:00:00Z', cover: good, rejectedCovers: [bad] },
  { id: 'w2', key: 'hidden|someone', title: 'Hidden Book', author: 'Someone', updatedAt: '2026-10-22T00:00:01Z', cover: null, rejectedCovers: [bad] }, // not published: only the rejection travels
]);

test('the same picture is rejected at any size, other pictures are not', () => {
  const kin = { title: 'Kin', author: 'Tayari Jones' };
  assert.equal(isCoverRejected(kin, bad), true);
  assert.equal(isCoverRejected(kin, bad.replace('600x900bb', '200x300bb')), true);
  assert.equal(isCoverRejected(kin, good), false);
  assert.equal(isCoverRejected({ title: 'Other', author: 'Else' }, bad), false); // another book is unaffected
  assert.equal(isCoverRejected(kin, undefined), false);
});

test('a rejected cover is not used as the book\u2019s own link, and a rejected catalog cover is not picked', () => {
  assert.equal(ownCoverUrl({ title: 'Kin', author: 'Tayari Jones', coverUrl: bad }, 'M'), '');
  assert.notEqual(ownCoverUrl({ title: 'Kin', author: 'Tayari Jones', coverUrl: good }, 'M'), '');
  assert.equal(getCoverPickInfo({ title: 'Kin', author: 'Tayari Jones' })?.url, good);
  applyCatalog([{ id: 'w1', key: 'kin|tayari jones', title: 'Kin', author: 'Tayari Jones', updatedAt: '2026-10-22T00:00:02Z', cover: bad, rejectedCovers: [bad] }]);
  assert.equal(getCoverPickInfo({ title: 'Kin', author: 'Tayari Jones' }), undefined);
  assert.equal(getCoverFix({ title: 'Kin', author: 'Tayari Jones' }), '');
});

test('a book that is not published but has a rejection still blocks that cover', () => {
  assert.equal(isCoverRejected({ title: 'Hidden Book', author: 'Someone' }, bad), true);
});
