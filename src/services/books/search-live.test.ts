// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { searchBooks, searchBooksLive, searchLocal, searchRelevance, forgetRecentSearchesForTests } from './search';
import { parseQuery } from './query';
import { isBlocked, assessContent } from './quality';
import { forgetSeenForTests } from './localIndex';
import { forgetExcludedForTests, isRememberedExcluded } from './eligibility';

const book = (o: any) => ({ id: o.title, title: 'T', author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2020', genre: 'Fiction', summary: 'x'.repeat(80), authorBio: '', pageCount: 300, ...o }) as any;
const gb = (id: string, v: any) => ({ id, volumeInfo: { pageCount: 300, publishedDate: '2015', ...v } });
const ol = (key: string, title: string, author: string, extra: any = {}) => ({ key: `/works/${key}`, title, author_name: [author], first_publish_year: 2001, ...extra });

interface Seen { url: URL; at: number }
/** Replace fetch: `handler` answers per request; `delays` (ms) lets one source answer later than the other. */
function mockFetch(handler: (url: URL) => unknown, delay: (url: URL) => number = () => 0) {
  const seen: Seen[] = [];
  (globalThis as any).fetch = async (input: string, init?: { signal?: AbortSignal }) => {
    const url = new URL(String(input), 'https://example.test');
    seen.push({ url, at: Date.now() });
    const wait = delay(url);
    if (wait) await new Promise(r => setTimeout(r, wait));
    if (init?.signal?.aborted) throw new Error('aborted');
    const body = handler(url);
    return { ok: body !== null, status: body === null ? 404 : 200, json: async () => body };
  };
  return seen;
}
const reset = () => { store.clear(); forgetRecentSearchesForTests(); forgetSeenForTests(); };

/* ---------- the content filter ---------- */

test('satanic, demonic and sexual books are blocked; the Bible, classics and ordinary novels are not', () => {
  // blocked
  assert.ok(isBlocked('The Satanic Bible'));
  assert.ok(isBlocked('Summoning Demons: A Demonology Handbook'));
  assert.ok(isBlocked('Grimoire of the Dark', { subjects: ['Occultism', 'Demonology'] }));
  assert.ok(isBlocked('Worship the Devil', { subjects: ['Satanism'] }));
  assert.ok(isBlocked('The Sex Bible: The Complete Guide to Sexual Love'));
  assert.ok(isBlocked('The Ultimate Sex Guide'));
  assert.ok(isBlocked('Dark Desires: An Erotica Collection'));
  assert.ok(isBlocked('Some Book', { description: 'A practical guide to satanic rituals and devil worship, with spells to invoke demons.' }), 'instructional: two different practice terms in the description');
  // not blocked
  assert.ok(!isBlocked('The Holy Bible'));
  assert.ok(!isBlocked('The Bible', { subjects: ['Bibles', 'Religion'], description: 'The complete text of the Old and New Testaments.' }));
  assert.ok(!isBlocked('Paradise Lost', { subjects: ['Epic poetry'], description: 'Milton\'s epic of the fall of man, with Satan, the rebel angel, as its most compelling figure.' }));
  assert.ok(!isBlocked('The Screwtape Letters', { subjects: ['Christian life'], description: 'Letters from a senior demon to his nephew, a junior tempter. C. S. Lewis on Satan\'s methods and the demons\' failures.' }));
  assert.ok(!isBlocked('Some Novel', { subjects: ['Fiction'], description: 'A satanic cult leader rules a town through devil worship and demonic rites.' }), 'a novel that merely has a cult in it is not instructional');
  assert.ok(!isBlocked('Demon Copperhead', { subjects: ['Fiction'], description: 'A boy born to a teenage single mother in a single-wide trailer in Appalachia.' }));
  assert.ok(!isBlocked('Beach Read', { subjects: ['Romance fiction'], description: 'A witty love story about two rival writers.' }));
  assert.ok(!isBlocked('Our Bodies, Ourselves', { subjects: ['Sex instruction', 'Women'], description: 'Sexual health, contraception and reproductive medicine.' }));
});

test('a title or category decides; a description alone can never reach the filter line', () => {
  const weakOnly = assessContent('Some Book', { description: 'Demons, demonic rites, the occult, satanic rituals, exorcism and Satan.' });
  assert.ok(weakOnly.reasons.includes('satanic / demonic wording'));
  // many mentions in a description are only ever a penalty unless two different strong terms appear
  const oneStrong = assessContent('Some Book', { description: 'Satan, demons, occult, exorcism.' });
  assert.ok(oneStrong.score < 40);
});

/* ---------- reading the box ---------- */

test('the search box understands titles, authors, keywords, ISBNs and unfinished words', () => {
  assert.deepEqual([parseQuery('Harry Pot').text, parseQuery('Harry Pot').partial], ['harry pot', true]);
  assert.equal(parseQuery('Harry Pot ').partial, false, 'a trailing space means the last word is finished');
  const by = parseQuery('Dune by Frank Herbert');
  assert.deepEqual([by.text, by.author, by.full], ['dune', 'frank herbert', 'dune by frank herbert']);
  const writer = parseQuery('books by stephen king');
  assert.deepEqual([writer.text, writer.author], ['', 'stephen king']);
  const about = parseQuery('books about dragons');
  assert.deepEqual([about.text, about.keywords], ['dragons', true]);
  assert.equal(parseQuery('inauthor: toni morrison').author, 'toni morrison');
  assert.equal(parseQuery('intitle:beloved').text, 'beloved');
  assert.equal(parseQuery('978-0-8021-4853-7').isbn, '9780802148537');
  assert.deepEqual([parseQuery('Death by Water', '', false).text, parseQuery('Death by Water', '', false).author], ['death by water', ''], 'bulk import keeps the title whole');
});

/* ---------- relevance ---------- */

test('relevance: unfinished words, authors, articles, study guides', () => {
  const potter = book({ title: 'Harry Potter and the Sorcerer\'s Stone', author: 'J. K. Rowling', ratingAverage: 4.5, ratingCount: 90000 });
  const other = book({ title: 'Potter\'s Field', author: 'Someone Else', ratingAverage: 4.5, ratingCount: 90000 });
  assert.ok(searchRelevance(potter, 'harry pot', '', true) > searchRelevance(other, 'harry pot', '', true));
  assert.ok(searchRelevance(potter, 'harry pot', '', true) > 60, 'a beginning of the next word counts as a strong title match');
  assert.ok(searchRelevance(potter, 'harry pot', '', false) < searchRelevance(potter, 'harry pot', '', true), 'whole-word reading does not give the beginning-of-word credit');
  // an author typed in part
  const king = book({ title: 'It', author: 'Stephen King' });
  const notKing = book({ title: 'The Shining Path', author: 'Someone' });
  assert.ok(searchRelevance(king, 'stephen kin', '', true) > searchRelevance(notKing, 'stephen kin', '', true) + 40);
  // a leading article never blocks an exact match
  assert.ok(searchRelevance(book({ title: 'The Hobbit' }), 'hobbit') >= 95);
  // a book about the book ranks far below the book
  const guide = book({ title: 'Dune Study Guide', ratingAverage: 4.5, ratingCount: 900 });
  const dune = book({ title: 'Dune', ratingAverage: 4.5, ratingCount: 900 });
  assert.ok(searchRelevance(dune, 'dune') > searchRelevance(guide, 'dune') + 40);
  assert.ok(searchRelevance(guide, 'dune study guide') > 60, 'unless that is what was typed');
  // keywords in the genre / description lift a book a little, never above a title match
  const about = book({ title: 'Wings of Fire', genre: 'Fantasy, Dragons', summary: 'A young dragon learns to fly across the dragons\' island home, and so on and on.' });
  assert.ok(searchRelevance(about, 'dragons') > searchRelevance(book({ title: 'Wings of Fire', genre: 'Fantasy' }), 'dragons'));
  assert.ok(searchRelevance(book({ title: 'Dragons' }), 'dragons') > searchRelevance(about, 'dragons'));
});

/* ---------- searching ---------- */

test('Google is asked with a plain query, not a quoted phrase, so a half-typed title still finds the book', async () => {
  reset();
  const seen = mockFetch(() => ({ docs: [], items: [] }));
  await searchBooksLive('harry pot', { local: false });
  const google = seen.map(s => s.url).filter(u => u.hostname.includes('googleapis'));
  assert.ok(google.length >= 1);
  for (const u of google) assert.equal(u.searchParams.get('q'), 'harry pot', 'no intitle:"..." phrase');
  const olq = seen.map(s => s.url).filter(u => u.hostname === 'openlibrary.org').map(u => u.searchParams.get('q'));
  assert.ok(olq.includes('harry pot*'), 'Open Library also gets the unfinished last word as a wildcard');
  assert.equal(seen.length, 2, 'two requests while typing');
});

test('a submitted search also asks Open Library for titles only; an author query asks for that author', async () => {
  reset();
  let seen = mockFetch(() => ({ docs: [], items: [] }));
  await searchBooksLive('harry potter', { final: true, local: false });
  assert.equal(seen.length, 3);
  assert.ok(seen.some(s => s.url.searchParams.get('title') === 'harry potter*'));
  seen = mockFetch(() => ({ docs: [], items: [] }));
  await searchBooksLive('books by stephen king', { local: false });
  assert.ok(seen.some(s => s.url.searchParams.get('author') === 'stephen king'));
  assert.ok(seen.some(s => s.url.searchParams.get('q') === 'inauthor:stephen king'));
});

test('results arrive as each source answers: the fast one first, the list improves when the slow one lands', async () => {
  reset();
  mockFetch(
    url => (url.hostname === 'openlibrary.org' ? { docs: [ol('OL1W', 'Fastbook', 'Frank Herbert', { cover_i: 7, ratings_count: 4000, ratings_average: 4.3 })] } : { items: [gb('g1', { title: 'Fastbook Stories', authors: ['Frank Herbert'] })] }),
    url => (url.hostname === 'openlibrary.org' ? 60 : 0),
  );
  const steps: { from: string; titles: string[]; done: boolean }[] = [];
  const final = await searchBooksLive('fastbook', { onUpdate: (b, p) => steps.push({ from: p.from, titles: b.map(x => x.title), done: p.done }) });
  assert.equal(steps[0].from, 'google', 'the fast source is shown without waiting for the slow one');
  assert.deepEqual(steps[0].titles, ['Fastbook Stories']);
  assert.ok(steps.some(s => s.from === 'ol' && s.titles[0] === 'Fastbook'), 'then Open Library lands and the exact title moves to the top');
  assert.equal(steps[steps.length - 1].done, true);
  assert.equal(final[0].title, 'Fastbook');
});

test('books already seen on this device appear at once, with no network, and a repeated search costs no requests', async () => {
  reset();
  let seen = mockFetch(url => (url.hostname === 'openlibrary.org' ? { docs: [ol('OL5W', 'Harry Potter and the Goblet of Fire', 'J. K. Rowling', { cover_i: 9, ratings_count: 50000, ratings_average: 4.5 })] } : { items: [] }));
  await searchBooksLive('harry potter');
  // typing a beginning of the same title finds it synchronously
  assert.ok(searchLocal('harry pot').some(b => b.title === 'Harry Potter and the Goblet of Fire'));
  assert.ok(searchLocal('rowling').some(b => b.title === 'Harry Potter and the Goblet of Fire'), 'by author too');
  assert.deepEqual(searchLocal('hermione'), []);
  // the very same search again: answered from memory
  seen = mockFetch(() => ({ docs: [], items: [] }));
  const steps: string[] = [];
  const again = await searchBooksLive('harry potter', { onUpdate: (_b, p) => steps.push(p.from) });
  assert.equal(seen.length, 0);
  assert.ok(again.some(b => b.title === 'Harry Potter and the Goblet of Fire'));
  assert.ok(steps.includes('local') && steps.includes('cache'));
});

test('a search every source failed is never remembered as the answer', async () => {
  reset();
  mockFetch(() => null);
  const query = 'zzqxidentity';
  assert.deepEqual(await searchBooksLive(query), []);
  const seen = mockFetch(url => (url.hostname === 'openlibrary.org' ? { docs: [ol('OL1W', query, 'Frank Herbert')] } : { items: [] }));
  assert.equal((await searchBooksLive(query)).length, 1);
  assert.ok(seen.length >= 2, 'it asked again');
});

test('a newer keystroke cancels the older search: an aborted search reports nothing', async () => {
  reset();
  mockFetch(() => ({ docs: [ol('OL1W', 'zzqxidentity', 'Frank Herbert')], items: [] }), () => 30);
  const c = new AbortController();
  const updates: unknown[] = [];
  const p = searchBooksLive('zzqxidentity', { signal: c.signal, onUpdate: b => updates.push(b) });
  c.abort();
  assert.deepEqual(await p, []);
  assert.deepEqual(updates, []);
});

test('blocked books never reach the results, whichever source flagged them, and the Store shelves are told', async () => {
  reset();
  forgetExcludedForTests([book({ id: 'gb_sat', title: 'The Satanic Bible', author: 'Anton LaVey' })]);
  mockFetch(url => (url.hostname === 'openlibrary.org'
    ? { docs: [ol('OL1W', 'The Bible', 'Various', { ratings_count: 900, ratings_average: 4.4 }), ol('OL2W', 'The Satanic Bible', 'Anton LaVey', { ratings_count: 5000, ratings_average: 4 })] } // Open Library's copy carries no categories at all
    : { items: [
      gb('g1', { title: 'The Satanic Bible', authors: ['Anton LaVey'], categories: ['Religion / Satanism'] }),
      gb('g2', { title: 'The Sex Bible', authors: ['Some Author'] }),
      gb('g3', { title: 'Bible Stories for Kids', authors: ['A. Teacher'], categories: ['Juvenile Nonfiction'] }),
      gb('g4', { title: 'The Holy Bible', authors: ['Various'], categories: ['Bibles'] }),
    ] }));
  const found = await searchBooks('bible');
  const titles = found.map(b => b.title);
  assert.ok(!titles.some(t => /satanic|sex bible/i.test(t)), `blocked titles are gone: ${titles.join(' | ')}`);
  assert.ok(titles.includes('The Bible') && titles.includes('The Holy Bible') && titles.includes('Bible Stories for Kids'));
  assert.ok(isRememberedExcluded(book({ id: 'gb_g1', title: 'The Satanic Bible', author: 'Anton LaVey' })), 'remembered, so no shelf can bring it back');
});

test('bulk import keeps a title that contains "by"; searchBooks never reads the on-device list', async () => {
  reset();
  const seen = mockFetch(url => (url.hostname === 'openlibrary.org' ? { docs: [ol('OL9W', 'Death by Water', 'Kenzaburo Oe')] } : { items: [] }));
  const found = await searchBooks('Death by Water', '', 1);
  assert.equal(found[0].title, 'Death by Water');
  assert.ok(seen.every(s => s.url.searchParams.get('author') === null), 'not split into a title and an author');
  assert.deepEqual(searchLocal('death by'), [], 'and nothing was remembered by the plain search');
});

/* ---------- the reader's own books seed the search ---------- */

test('books you already own are matched on the first keystroke, even before anything was ever searched', () => {
  reset();
  const mine = [book({ id: 'a1', title: 'Piranesi', author: 'Susanna Clarke' }), book({ id: 'a2', title: 'Dune', author: 'Frank Herbert' })];
  assert.deepEqual(searchLocal('pira', '', 10, mine).map(b => b.id), ['a1']);
  assert.deepEqual(searchLocal('herbert', '', 10, mine).map(b => b.id), ['a2']);
  assert.ok(!searchLocal('pira', '', 10).some(b => b.id === 'a1'), 'the reader’s record does not enter Search without the library list');
});

test('your own books are never stored in the on-device search cache', async () => {
  reset();
  const mine = [book({ id: 'a1', title: 'Piranesi', author: 'Susanna Clarke' })];
  mockFetch(() => ({ docs: [], items: [] }));
  await searchBooksLive('piranesi', { known: mine, final: true });
  const remembered = JSON.parse(store.get('readlife.seen1') || '{}');
  assert.ok(!Object.values(remembered).some((entry: any) => entry.v?.id === 'a1'), 'the reader’s own record was not saved in the downloaded-search cache');
});
