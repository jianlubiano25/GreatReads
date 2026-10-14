// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};
const FIX = 'readlife.coverFix1';
const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const book = (coverUrl?: string, coverId?: number) => ({ title: 'How to Win Friends', author: 'Dale Carnegie', coverUrl, coverId });
const key = 'how to win friends|dale carnegie';

store.set(FIX, JSON.stringify({
  [key]: { url: 'https://fix/new.jpg', t: now - DAY, own: 'https://own/old.jpg' },
}));
const load = (q: string): Promise<typeof import('./covers')> => import(`./covers?${q}`); // fresh copy, so it re-reads storage
const covers = await load('base');

test('a repair is used while the book still has the link it replaced', () => {
  assert.equal(covers.getCoverFix(book('https://own/old.jpg')), 'https://fix/new.jpg');
});

test('a changed own link wins over the old repair', () => {
  assert.equal(covers.getCoverFix(book('https://own/NEW.jpg')), '');
});

test('a book with no own link keeps using its repair', () => {
  assert.equal(covers.getCoverFix(book()), 'https://fix/new.jpg');
});

test('a repair saved before this check (no own) is ignored when the book has its own cover', async () => {
  store.set(FIX, JSON.stringify({ [key]: { url: 'https://fix/legacy.jpg', t: now } }));
  const c = await load('legacy');
  assert.equal(c.getCoverFix(book('https://own/any.jpg')), '');
  assert.equal(c.getCoverFix(book(undefined, 123)), '');
  assert.equal(c.getCoverFix(book()), 'https://fix/legacy.jpg');
});

test('an expired repair is ignored when the book has its own link', async () => {
  store.set(FIX, JSON.stringify({ [key]: { url: 'https://fix/old.jpg', t: now - 31 * DAY, own: 'https://own/a.jpg' } }));
  const c = await load('expired');
  assert.equal(c.getCoverFix(book('https://own/a.jpg')), '');
});

test('refreshBookCovers forgets repairs and the not-found notes, and nothing else', async () => {
  store.set(FIX, JSON.stringify({ [key]: { url: 'https://fix/x.jpg', t: now, own: 'https://own/a.jpg' } }));
  store.set('readlife.coverNone3', JSON.stringify({ other: now }));
  store.set('readlife.v2', '{"library":1}');
  const c = await load('refresh');
  assert.equal(c.refreshBookCovers(), 1);
  assert.equal(c.getCoverFix(book('https://own/a.jpg')), '');
  assert.equal(store.has(FIX), false);
  assert.equal(store.has('readlife.coverNone3'), false);
  assert.equal(store.get('readlife.v2'), '{"library":1}');
  assert.equal(c.refreshBookCovers(), 0);
});
