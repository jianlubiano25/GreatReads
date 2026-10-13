// Run with: npm test
// The cover YOU pick (star in the cover viewer): one saved record per book, in its own key, never lost to a cache cleanup, in the backup,
// and always at the size a card draws.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

const load = async (q: string): Promise<typeof import('./coverPicks')> => import(`./coverPicks?${q}`); // fresh copy: re-reads storage
const { clearableCacheKeys } = await import('./cache');
const covers = await import('./covers');

const book = { title: 'Pick Me', author: 'Ann Author' };
const APPLE = 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/ab/cd/art/600x900bb.jpg';
const OL = 'https://covers.openlibrary.org/b/id/777-L.jpg';

test('a pick is saved per book and found however the title and author are written', async () => {
  const c = await load('basic');
  assert.equal(c.getCoverPick(book), '');
  assert.equal(c.setCoverPick(book, { url: APPLE, source: 'apple' }), true);
  assert.equal(c.getCoverPickInfo({ title: '  PICK me ', author: 'ann AUTHOR' })?.url, APPLE);
  assert.equal(c.getCoverPickInfo({ title: 'Other Book', author: 'Ann Author' }), undefined);
  assert.deepEqual(JSON.parse(store.get(c.PICKS_KEY)!)['pick me|ann author'].source, 'apple');
});

test('a card gets the picked cover at its own size (Apple art resized, an Open Library id at S / M / L)', async () => {
  const c = await load('size');
  c.setCoverPick(book, { url: APPLE, source: 'apple' });
  assert.match(c.getCoverPick(book, 'S'), /\/200x300bb\.jpg$/);
  assert.match(c.getCoverPick(book, 'M'), /\/360x540bb\.jpg$/);
  assert.match(c.getCoverPick(book, 'L'), /\/600x900bb\.jpg$/);
  c.setCoverPick(book, { url: OL, source: 'openlibrary' });
  assert.equal(c.getCoverPick(book, 'S'), 'https://covers.openlibrary.org/b/id/777-S.jpg');
  assert.equal(c.getCoverPick(book, 'M'), 'https://covers.openlibrary.org/b/id/777-M.jpg');
  c.setCoverPick(book, { url: 'https://books.google.com/books/content?id=g1&zoom=1', source: 'google' });
  assert.equal(c.getCoverPick(book, 'M'), 'https://books.google.com/books/content?id=g1&zoom=1'); // other links are returned as they are
});

test('unstarring goes back to the automatic cover, and a change tells every drawn cover to look again', async () => {
  const c = await load('clear');
  let ticks = 0;
  const off = covers.subscribeCovers(() => { ticks++; });
  c.setCoverPick(book, { url: APPLE, source: 'apple' });
  assert.equal(ticks, 1);
  c.clearCoverPick(book);
  assert.equal(ticks, 2);
  assert.equal(c.getCoverPick(book), '');
  assert.deepEqual(JSON.parse(store.get(c.PICKS_KEY)!), {});
  c.clearCoverPick(book); // nothing to clear: no needless redraw
  assert.equal(ticks, 2);
  off();
});

test('only https pictures are accepted, and malformed saved entries are dropped one by one', async () => {
  const c = await load('valid');
  assert.equal(c.setCoverPick(book, { url: 'http://insecure/x.jpg' }), false);
  assert.equal(c.setCoverPick(book, { url: 'javascript:alert(1)' }), false);
  assert.equal(c.setCoverPick({ title: '', author: '' }, { url: APPLE }), false);
  store.set(c.PICKS_KEY, JSON.stringify({ good: { url: APPLE, source: 'apple', t: 5 }, bad1: { url: 'http://x/y.jpg' }, bad2: 'text', bad3: { url: 7 }, odd: { url: OL, source: 'mystery' } }));
  const d = await load('valid2');
  assert.deepEqual(Object.keys(d.exportCoverPicks()).sort(), ['good', 'odd']);
  assert.equal(d.exportCoverPicks().odd.source, 'openlibrary'); // an unknown source name is worked out from the link
  store.set(d.PICKS_KEY, '{not json');
  assert.deepEqual((await load('valid3')).exportCoverPicks(), {});
});

test('a pick is the user\'s own data: Refresh Book Covers and the cache cleanup never remove it', async () => {
  const c = await load('keep');
  c.setCoverPick(book, { url: APPLE, source: 'apple' });
  assert.ok(!clearableCacheKeys().includes(c.PICKS_KEY));
  covers.refreshBookCovers();
  assert.ok(store.has(c.PICKS_KEY));
  assert.equal(c.getCoverPick(book, 'L'), APPLE);
});

test('a pick that fails to load is set aside for the session but kept; choosing it again brings it back', async () => {
  const c = await load('fail');
  c.setCoverPick(book, { url: APPLE, source: 'apple' });
  c.markCoverPickFailed(book);
  assert.equal(c.getCoverPick(book), '');
  assert.ok(JSON.parse(store.get(c.PICKS_KEY)!)['pick me|ann author']);
  c.setCoverPick(book, { url: APPLE, source: 'apple' });
  assert.ok(c.getCoverPick(book));
});

test('picks travel in a backup; a backup made before picks existed leaves the current picks alone', async () => {
  const c = await load('backup');
  c.setCoverPick(book, { url: APPLE, source: 'apple' });
  const mine = c.exportCoverPicks();
  const text = JSON.stringify({ status: {}, coverPicks: mine });

  c.clearCoverPick(book);
  assert.equal(c.restoreCoverPicksFromBackup(text), 1);
  assert.equal(c.getCoverPick(book, 'L'), APPLE);
  c.clearCoverPick(book);
  assert.equal(c.restoreCoverPicksFromBackup(`\u201C${text.replace(/"/g, '\u201D')}\u201D`), 1); // a paste with smart quotes works, as it does for the rest of the backup
  assert.equal(c.getCoverPick(book, 'L'), APPLE);

  assert.equal(c.restoreCoverPicksFromBackup(JSON.stringify({ status: {}, words: [] })), null); // an older backup
  assert.equal(c.getCoverPick(book, 'L'), APPLE);
  assert.equal(c.restoreCoverPicksFromBackup('not json'), null);

  assert.equal(c.restoreCoverPicksFromBackup(JSON.stringify({ coverPicks: { x: { url: 'http://bad' } } })), 0); // a backup that says "no picks" means none
  assert.equal(c.getCoverPick(book), '');
});

test('coverSourceOf names the site a link belongs to', async () => {
  const c = await load('source');
  assert.equal(c.coverSourceOf(APPLE), 'apple');
  assert.equal(c.coverSourceOf('https://books.google.com/books/content?id=1'), 'google');
  assert.equal(c.coverSourceOf(OL), 'openlibrary');
  assert.equal(c.coverSourceOf('https://nyt.example/cover.jpg'), 'link');
  assert.equal(c.coverSourceOf('not a url'), 'link');
});
