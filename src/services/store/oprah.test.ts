import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS module with no type declarations
import { onRequestGet as oprahFn, parseOprahList } from '../../../functions/api/oprah.js';
import { DYNAMIC_SPECS, dynamicInfo, oprahNewest, refreshShelf } from './dynamic';
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

const table2 = (rows: string[][]) => `{| class="wikitable"\n! Month !! Author !! Title !! Ref\n|-\n${rows.map(r => `| ${r[0]} || [[${r[1]}]] || \'\'[[${r[2]}]]\'\' ||`).join('\n|-\n')}\n|}`;
const wiki2 = [['January 2026', 'W A', 'Wiki One'], ['February 2026', 'Tayari Jones', 'Kin'], ['March 2026', 'W B', 'Wiki Two'], ['April 2026', 'Maria Semple', 'Go Gentle'], ['May 2026', 'W C', 'Wiki Three'], ['June 2026', 'Sophie Chen Keller', 'Little Wonder']];
const wikiRoute = (u: URL) => (u.hostname === 'en.wikipedia.org' ? (u.searchParams.get('page') === "Oprah's Book Club 2.0" ? { body: { parse: { wikitext: table2(wiki2) } } } : { status: 404 }) : undefined);

test('Oprah shelf: ONE refresh reads Oprah Daily and Wikipedia 2.0; the default list stays where it is', async () => {
  const base = CURATED_SHELVES.find(s => s.id === 'oprah')!;
  const official = [
    { n: 130, title: 'Fresh Pick', author: 'Fresh Author' }, // Oprah Daily has it, Wikipedia does not yet
    { n: 129, title: 'Little Wonder', author: 'Sophie Chen Keller' }, // both: the dated one is used
    { n: 128, title: 'Beloved', author: 'Toni Morrison' }, // already a default: keeps its own place and label
  ];
  routeFetch([u => (u.pathname === '/api/oprah' ? { body: { picks: official } } : undefined), wikiRoute]);
  const got = await refreshShelf({ ...base, id: 't-oprah' }, DYNAMIC_SPECS.oprah);
  assert.deepEqual(got?.seeds.slice(0, 4).map(s => [s[0], s[2]]), [
    ['Fresh Pick', "Oprah's Book Club"], ['Little Wonder', "Oprah's Book Club · Jun 2026"], ['Wiki Three', "Oprah's Book Club · May 2026"], ['Go Gentle', "Oprah's Book Club · Apr 2026"],
  ]);
  assert.equal(got?.official, true);
  const titles = got!.seeds.map(s => s[0]);
  for (const b of base.seeds) assert.ok(titles.includes(b[0]), `${b[0]} (default) is kept`);
  assert.equal(got!.seeds.find(s => s[0] === 'Beloved')![2], base.seeds[0][2], 'a default keeps its own label');
  const order = base.seeds.map(b => titles.indexOf(b[0]));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'the default list keeps its order');
  assert.equal(new Set(titles.map(t => t.toLowerCase())).size, titles.length, 'no book twice');
  assert.deepEqual((await refreshShelf({ ...base, id: 't-oprah' }, DYNAMIC_SPECS.oprah))?.seeds, got?.seeds, 'a second refresh with nothing new changes nothing');
});

test('Oprah shelf: Oprah Daily unreadable -> Wikipedia 2.0 alone (labelled fallback); Wikipedia down -> Oprah Daily alone; both down -> failure with a reason', async () => {
  const base = CURATED_SHELVES.find(s => s.id === 'oprah')!;
  const daily = { n: 130, title: 'Fresh Pick', author: 'Fresh Author' };
  routeFetch([u => (u.pathname === '/api/oprah' ? { status: 502, body: { error: 'layout_changed' } } : undefined), wikiRoute]);
  const fb = await refreshShelf({ ...base, id: 't-oprah-fb' }, DYNAMIC_SPECS.oprah);
  assert.deepEqual(fb?.seeds.slice(0, 3).map(s => s[0]), ['Little Wonder', 'Wiki Three', 'Go Gentle']);
  assert.equal(fb?.official, false);

  const picks = [daily, ...Array.from({ length: 6 }, (_, i) => ({ n: 120 - i, title: `Older ${i}`, author: `Older Author ${i}` }))];
  routeFetch([u => (u.pathname === '/api/oprah' ? { body: { picks } } : undefined), u => (u.hostname === 'en.wikipedia.org' ? { status: 500 } : undefined)]);
  const only = await refreshShelf({ ...base, id: 't-oprah-nowiki' }, DYNAMIC_SPECS.oprah);
  assert.equal(only?.seeds[0][0], 'Fresh Pick');
  assert.equal(only?.official, true);

  routeFetch([u => (u.pathname === '/api/oprah' ? { status: 502, body: { error: 'upstream_error' } } : undefined), u => (u.hostname === 'en.wikipedia.org' ? { status: 500 } : undefined)]);
  assert.equal(await refreshShelf({ ...base, id: 't-oprah-down' }, DYNAMIC_SPECS.oprah), null);
  assert.match(dynamicInfo({ ...base, id: 't-oprah-down' }, DYNAMIC_SPECS.oprah).source, /Oprah Daily could not be read.*Wikipedia/);
});

test('parseOprahList: Oprah Daily\'s gallery today: a number, then the book as a "Title, by Author" link, then shop links and a blurb', () => {
  const entry = (n: number, title: string, author: string) => `<div class="gallery-slide"><span>${n}</span><h2><a href="https://www.amazon.com/dp/B0FMSVZWXP?tag=oprah-auto-20">${title}, by ${author}</a></h2><a href="https://amzn">$15AMAZON</a><p>ALSO CONSIDER</p><a href="https://bookshop.org">$27BOOKSHOP</a><p>Gorgeous and gut-wrenching, this debut novel takes us inside the head of 12-year-old Ruth.</p></div>`;
  const html = `<p>The club has spotlighted over the years. You’ll never forget these <a href="x">illuminating stories</a>—just ask Oprah.</p>${entry(125, 'Hungered', 'Amanda Rizkalla')}${entry(124, 'Wild Dark Shore: A Novel', 'Charlotte McConaghy')}${entry(123, 'Love, Loss, and Liberation', 'A. B. Writer')}${Array.from({ length: 6 }, (_, i) => entry(122 - i, `Pick ${i}`, `Author ${i}`)).join('')}`;
  const out = parseOprahList(html);
  assert.deepEqual(out.map((p: any) => p.n), [125, 124, 123, 122, 121, 120, 119, 118, 117]);
  assert.deepEqual([out[0].title, out[0].author], ['Hungered', 'Amanda Rizkalla']);
  assert.equal(out[1].title, 'Wild Dark Shore: A Novel');
  assert.equal(out[2].title, 'Love, Loss, and Liberation'); // a comma inside the title is not the byline
  assert.ok(out.every((p: any) => !/AMAZON|BOOKSHOP|CONSIDER/.test(p.title + p.author)));
  const split = parseOprahList(`<span>125</span><a>Hungered</a>, by <a>Amanda Rizkalla</a>${Array.from({ length: 8 }, (_, i) => `<span>${124 - i}</span><a>T${i}, by A${i} Bee</a>`).join('')}`);
  assert.deepEqual([split[0].n, split[0].title, split[0].author], [125, 'Hungered', 'Amanda Rizkalla']);
  assert.deepEqual(parseOprahList('<p>125</p><p>We read 12-year-old Ruth, by chance</p>'), []);
});

test('parseOprahList: the number in a tag of its own still reads as an entry', () => {
  const html = Array.from({ length: 9 }, (_, i) => `<div><span>${120 - i}</span><h2>“Title ${120 - i},” Author ${120 - i}</h2></div>`).join('');
  const out = parseOprahList(html);
  assert.equal(out.length, 9);
  assert.deepEqual([out[0].n, out[0].title, out[0].author], [120, 'Title 120', 'Author 120']);
});
