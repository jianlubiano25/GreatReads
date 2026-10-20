// Run with: npm test
// Phase 0 baseline for book identity: each test is one situation that went wrong in the app (or could), with the answer we want. The sources are scripted
// (routeFetch), shaped like the real Apple / Google / Open Library answers. To check against the REAL services: npm run trace:books.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { resolveBook } from './resolve';
import { forgetEditionsForTests } from './sources/openLibrary';
import { looksEnglish } from './language';
import { routeFetch, type Route } from '../store/testkit';

const isOl = (u: URL) => u.hostname === 'openlibrary.org';
const isGoogle = (u: URL) => u.hostname === 'www.googleapis.com';
const isApple = (u: URL) => u.hostname === 'itunes.apple.com';
const noApple: Route = u => (isApple(u) ? { body: { results: [] } } : undefined);
const noOl: Route = u => (isOl(u) ? { body: { docs: [], entries: [] } } : undefined);
const EN = 'A former coal miner is dragged into a deadly dungeon after the world ends, and with his cat he must fight to survive while an alien audience watches and bets on every move he makes.';
const ES = 'Un antiguo minero de carbón es arrastrado a una mazmorra mortal después del fin del mundo, y junto con su gata debe luchar por sobrevivir mientras una audiencia alienígena apuesta por cada uno de sus movimientos.';
const SV = 'Antligen på svenska! En före detta kolgruvearbetare dras in i ett dödligt fängelse när världen går under, och tillsammans med sin katt måste han kämpa för att överleva medan en utomjordisk publik tittar på.';
const THUMB = (id: string) => `https://books.google.com/books/content?id=${id}&printsec=frontcover&img=1&zoom=1`;
const vol = (id: string, title: string, author: string, language: string, description: string, isbn?: string) => ({ id, volumeInfo: { title, authors: [author], language, description, publishedDate: '2022', pageCount: 400, imageLinks: { thumbnail: THUMB(id) }, industryIdentifiers: isbn ? [{ type: 'ISBN_13', identifier: isbn }] : [] } });
/** Google: the `isbn:` lookup answers `byIsbn`, every other (English-restricted) search answers `english`. */
const google = (byIsbn: any[], english: any[]): Route => u => (isGoogle(u) ? { body: { items: (u.searchParams.get('q') || '').startsWith('isbn:') ? byIsbn : english } } : undefined);

test('the ISBN is the Spanish edition, but an English edition of the book exists: English title, About and cover', async () => {
  forgetEditionsForTests(); store.clear();
  routeFetch([noApple, noOl, google([vol('es1', 'Carl’s Doomsday Scenario', 'Matt Dinniman', 'es', ES, '9788419999999')], [vol('en1', 'Carl’s Doomsday Scenario', 'Matt Dinniman', 'en', EN, '9781736000000')])]);
  const r = await resolveBook({ title: 'Carl’s Doomsday Scenario', author: 'Matt Dinniman', isbn: '9788419999999' });
  assert.ok(r);
  assert.equal(r!.book.summary, EN);
  assert.equal(r!.book.coverUrl, THUMB('en1'));
  assert.equal(r!.book.identity?.isbn13, '9781736000000', 'the English edition is what the book is pinned to, not the Spanish ISBN it was asked with');
  assert.equal(r!.book.identity?.gbVolume, 'en1');
});

test('only a Swedish/Spanish Google volume exists: its blurb is never the About (and the word-list check is not what decides)', async () => {
  for (const [lang, text] of [['sv', SV], ['es', ES]] as const) {
    forgetEditionsForTests(); store.clear();
    routeFetch([noApple, noOl, google([], [vol('x1', 'Carl’s Doomsday Scenario', 'Matt Dinniman', lang, text)])]);
    const r = await resolveBook({ title: 'Carl’s Doomsday Scenario', author: 'Matt Dinniman' });
    assert.ok(r, lang);
    assert.ok(!/(Antligen|Un antiguo)/.test(r!.book.summary), `${lang}: ${r!.book.summary}`);
  }
});

test('a work Open Library files under the original title shows the English title another source gives', async () => {
  forgetEditionsForTests(); store.clear();
  routeFetch([noApple, google([], [vol('en2', 'The Stranger', 'Albert Camus', 'en', 'A young clerk in Algiers attends his mother’s funeral without crying, and what follows after a killing on a beach is a trial that judges the man as much as the deed.')]),
    u => (isOl(u) && u.pathname === '/search.json' ? { body: { docs: [{ key: '/works/OL1230613W', title: 'L’étranger', author_name: ['Albert Camus'], cover_i: 77, language: ['fre', 'eng'], ratings_count: 900, ratings_average: 4 }] } } : undefined),
    u => (isOl(u) ? { body: { entries: [] } } : undefined)]);
  const r = await resolveBook({ title: 'The Stranger', author: 'Albert Camus' });
  assert.equal(r?.book.title, 'The Stranger');
  assert.ok(looksEnglish(r!.book.summary));
});

test('an English Google match pins the edition: its ISBN-13 and volume are kept in the identity for the next lookup', async () => {
  forgetEditionsForTests(); store.clear();
  routeFetch([noApple, noOl, google([], [vol('en3', 'Dear Debbie', 'Freida McFadden', 'en', EN, '9781234567897')])]);
  const r = await resolveBook({ title: 'Dear Debbie', author: 'Freida McFadden' });
  assert.equal(r?.book.identity?.isbn13, '9781234567897');
  assert.equal(r?.book.identity?.gbVolume, 'en3');
});

test('a foreign hit never overwrites an English title or About from another source', async () => {
  forgetEditionsForTests(); store.clear();
  routeFetch([
    u => (isApple(u) ? { body: { results: [{ trackId: 1, trackName: 'Dear Debbie', artistName: 'Freida McFadden', artworkUrl100: 'https://is1.mzstatic.com/x/100x100bb.jpg', description: EN, languageCodesISO2A: ['EN'] }] } } : undefined),
    google([], [vol('es4', 'Dear Debbie', 'Freida McFadden', 'es', ES)]), noOl]);
  const r = await resolveBook({ title: 'Dear Debbie', author: 'Freida McFadden', apple: true });
  assert.equal(r?.book.summary, EN);
  assert.match(r!.book.coverUrl || '', /mzstatic/);
});

test('Open Library has no language tag on a work description: a Swedish one is not the About, the English Google blurb is', async () => {
  const { lookupSummary } = await import('./details');
  forgetEditionsForTests(); store.clear();
  routeFetch([noApple, google([], [vol('en5', 'Carl’s Doomsday Scenario', 'Matt Dinniman', 'en', EN)]),
    u => (isOl(u) && u.pathname === '/search.json' ? { body: { docs: [{ key: '/works/OL9W', title: 'Carl’s Doomsday Scenario', author_name: ['Matt Dinniman'], language: ['eng'] }] } } : undefined),
    u => (isOl(u) && u.pathname === '/works/OL9W.json' ? { body: { description: SV } } : undefined)]);
  const text = await lookupSummary({ id: 'x', title: 'Carl’s Doomsday Scenario', author: 'Matt Dinniman', identity: { olWork: 'OL9W' } } as any);
  assert.equal(text, EN);
});

test('short non-English blurbs are not English either (a book with no English text keeps its placeholder, never a Swedish or Spanish line)', () => {
  for (const t of ['Antligen på svenska! En före detta kolgruvearbetare dras in i ett dödligt fängelse.', 'Un antiguo minero es arrastrado a una mazmorra mortal después del fin del mundo.', 'Een voormalige mijnwerker wordt in een dodelijke kerker getrokken nadat de wereld vergaat.']) assert.equal(looksEnglish(t), false, t);
  for (const t of ['A former miner is dragged into a deadly dungeon after the world ends.', 'The sequel to the bestselling novel, now with a new ending.']) assert.equal(looksEnglish(t), true, t);
});
