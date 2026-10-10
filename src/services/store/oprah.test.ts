import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS module with no type declarations
import { onRequestGet as oprahFn, parseOprahList } from '../../../functions/api/oprah.js';
import { DYNAMIC_SPECS, oprahNewest, refreshShelf } from './dynamic';
import { splitPairedTitle } from './wikiLists';
import { routeFetch } from './testkit';
import { CURATED_SHELVES } from '../../data/storeCatalog';

/* NOTE: the page itself could not be read when this was written (it blocks automated readers). These fixtures follow the entry
   format outlets quote from it ("112. “Title,” Author", newest first) and were written for the tests. `npm run check:oprah`
   shows what the real page gives. */

const entries = (n: number, from = 120) => Array.from({ length: n }, (_, i) => `<h2 class="slide">${from - i}. “Title ${from - i},” Author ${from - i}</h2>`).join('<p>blurb</p>');

test('parseOprahList reads numbered "“Title,” Author" entries, newest first, whatever tags wrap them', () => {
  const html = `<div>${entries(3)}</div><h2><span>117.</span> <em>“Hidden Valley Road: Inside the Mind of an American Family,”</em> Robert Kolker</h2><h2>116. "A New Earth: Awakening to Your Life&#8217;s Purpose," Eckhart Tolle</h2><script>var x = "5. “Not a pick,” Nobody";</script>`;
  const out = parseOprahList(html);
  assert.deepEqual(out.map((p: any) => p.n), [120, 119, 118, 117, 116]);
  assert.deepEqual([out[0].title, out[0].author], ['Title 120', 'Author 120']);
  assert.deepEqual([out[3].title, out[3].author], ['Hidden Valley Road: Inside the Mind of an American Family', 'Robert Kolker']);
  assert.equal(out[4].title, 'A New Earth: Awakening to Your Life’s Purpose');
  assert.deepEqual(parseOprahList('<p>No list here</p>'), []);
});

test('/api/oprah: answers the picks, and an unreadable page is an error that is never cached', async () => {
  (globalThis as any).fetch = async () => new Response(`<html>${entries(12)}</html>`, { status: 200 });
  const ok = await oprahFn();
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.picks.length, 12);
  assert.equal(body.picks[0].n, 120);

  (globalThis as any).fetch = async () => new Response('<html>a redesigned page</html>', { status: 200 });
  const changed = await oprahFn();
  assert.equal(changed.status, 502);
  assert.equal(changed.headers.get('cache-control'), 'no-store');

  (globalThis as any).fetch = async () => new Response('blocked', { status: 403 });
  assert.equal((await oprahFn()).status, 502);
  (globalThis as any).fetch = async () => { throw new Error('down'); };
  assert.equal((await oprahFn()).status, 502);
});

test('oprahNewest: the newest picks from Oprah Daily, labelled, a double pick as two books', () => {
  const official = [{ title: 'Brand New', author: 'N A' }, { title: 'Great Expectations, A Tale of Two Cities', author: 'Charles Dickens' }, { title: 'Older', author: 'O A' }];
  assert.deepEqual(oprahNewest(official), [['Brand New', 'N A', "Oprah's Book Club"], ['Great Expectations', 'Charles Dickens', "Oprah's Book Club"], ['A Tale of Two Cities', 'Charles Dickens', "Oprah's Book Club"], ['Older', 'O A', "Oprah's Book Club"]]);
  assert.equal(oprahNewest(official, 1).length, 1);
});

test('a subtitle with commas is one book (Love, Loss, and Liberation is not a second book)', () => {
  const t = 'All the Way to the River: Love, Loss, and Liberation';
  assert.deepEqual(splitPairedTitle(t), [t]);
  assert.deepEqual(oprahNewest([{ title: t, author: 'Elizabeth Gilbert' }]), [[t, 'Elizabeth Gilbert', "Oprah's Book Club"]]);
  assert.deepEqual(splitPairedTitle('Love, Loss, and Liberation'), ['Love, Loss, and Liberation']);
});

test('Oprah shelf: ONE refresh adds Oprah Daily\'s new picks in front; the default list stays where it is; Wikipedia is never asked', async () => {
  const base = CURATED_SHELVES.find(s => s.id === 'oprah')!;
  const official = [
    ...Array.from({ length: 3 }, (_, i) => ({ n: 130 - i, title: `Fresh ${i}`, author: `Fresh Author ${i}` })),
    { n: 127, title: 'Beloved', author: 'Toni Morrison' }, // already a default: keeps its own place and label
    ...Array.from({ length: 10 }, (_, i) => ({ n: 126 - i, title: `Older ${i}`, author: `Older Author ${i}` })),
  ];
  const calls = routeFetch([u => (u.pathname === '/api/oprah' ? { body: { picks: official } } : undefined)]);
  const got = await refreshShelf({ ...base, id: 't-oprah' }, DYNAMIC_SPECS.oprah);
  assert.deepEqual(got?.seeds.slice(0, 3).map(s => s[0]), ['Fresh 0', 'Fresh 1', 'Fresh 2']);
  assert.equal(got?.official, true);
  const titles = got!.seeds.map(s => s[0]);
  for (const b of base.seeds) assert.ok(titles.includes(b[0]), `${b[0]} (default) is kept`);
  assert.equal(got!.seeds.find(s => s[0] === 'Beloved')![2], base.seeds[0][2], 'a default keeps its own label');
  const order = base.seeds.map(b => titles.indexOf(b[0]));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'the default list keeps its order');
  assert.equal(new Set(titles.map(t => t.toLowerCase())).size, titles.length, 'no book twice');
  assert.ok(!calls.some(c => /wikipedia/i.test(c)), 'Wikipedia is not a source for Oprah');

  // a second refresh with nothing new changes nothing
  const again = await refreshShelf({ ...base, id: 't-oprah' }, DYNAMIC_SPECS.oprah);
  assert.deepEqual(again?.seeds, got?.seeds);

  // Oprah Daily down: the refresh fails and the saved list stays
  routeFetch([u => (u.pathname === '/api/oprah' ? { status: 502, body: { error: 'layout_changed' } } : undefined)]);
  assert.equal(await refreshShelf({ ...base, id: 't-oprah-down' }, DYNAMIC_SPECS.oprah), null);
});
