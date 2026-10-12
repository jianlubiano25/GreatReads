// Run with: npm test
// Regression tests for: one rating ladder everywhere (valid Apple -> Open Library -> Google -> none; a card's or saved copy's pair never outranks a
// better live provider), each provider's pair kept whole and separate, Google ratings with even one rating, safe edition matching, and Google Books as a
// genuine fallback (a sparse exact-ISBN edition is completed from safely matched alternate editions, field by field, without unrelated data).
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { chooseRating, externalRating, knownRating, mainRating, otherRatings, SUFFICIENT_RATINGS, withKnownRating } from './ratings';
import { mergeBooks } from './merge';
import { bookKey, sameEdition, sameWork } from './identity';
import { fetchRatingSources } from './details';
import { resolveBook } from './resolve';
import { lookupApple } from './sources/appleBooks';
import { fillGoogleGaps, findGoogle, findGoogleRating, isSparseGoogle, gbItemToHit } from './sources/googleBooks';
import { RatingLine } from '../../components/BookMeta';
import { applyAddBook } from '../library';
import { routeFetch } from '../store/testkit';

const book = (o: any) => ({ id: o.title ?? 'T', title: 'T', author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2020', genre: 'Fiction', summary: 'x'.repeat(80), authorBio: '', pageCount: 300, ...o }) as any;
const isOl = (u: URL) => u.hostname === 'openlibrary.org';
const isGoogle = (u: URL) => u.hostname === 'www.googleapis.com';
const isApple = (u: URL) => u.hostname === 'itunes.apple.com';
const olSearch = (key: string, title: string, author: string, extra: any = {}) => (u: URL) =>
  isOl(u) && u.pathname === '/search.json' ? { body: { docs: [{ key, title, author_name: [author], first_publish_year: 2020, cover_i: 4242, number_of_pages_median: 250, ...extra }] } } : undefined;
const olOther = (u: URL) => (isOl(u) ? { body: { docs: [], summary: {} } } : undefined);
const gbItem = (id: string, title: string, author: string, extra: any = {}) => ({ id, volumeInfo: { title, authors: [author], publishedDate: '2020', pageCount: 200, ...extra } });
const appleItem = (title: string, author: string, average?: number, count?: number) => ({ trackId: Math.round(Math.random() * 1e6), trackName: title, artistName: author, artworkUrl100: 'https://a/100x100bb.jpg', averageUserRating: average, userRatingCount: count });
const apple = (...results: any[]) => (u: URL) => (isApple(u) ? { body: { results } } : undefined);
const appleDown = (u: URL) => (isApple(u) ? { status: 503, body: {} } : undefined);
const googleCalls = (calls: string[]) => calls.filter(c => new URL(c, 'https://x.test').hostname === 'www.googleapis.com');
/** A Google route that answers an `isbn:` query and a title/author query separately. */
const googleBy = (byIsbn: any[], byTitle: any[]) => (u: URL) => (isGoogle(u) ? { body: { items: (u.searchParams.get('q') || '').startsWith('isbn:') ? byIsbn : byTitle } } : undefined);
const pairOf = (b: any) => [b?.ratingAverage, b?.ratingCount, b?.ratingSource];
const mainPair = (r: any) => [r?.average, r?.count, r?.source];

const ISBN = '9780306406157';
const isbnId = (isbn = ISBN) => [{ type: 'ISBN_13', identifier: isbn }];
const LONG = 'A long enough description of this particular book, written for readers who want to know what it is about.';

// ---------------------------------------------------------------- identity ----

test('identity: local Book.id stays separate; editions match by ISBN-10/13, never by title alone', () => {
  const a = book({ id: 'local-1', title: 'Hungered Gamma', author: 'Kay Writer', identity: { isbn13: ISBN } });
  const b = book({ id: 'gb_other', title: 'Hungered Gamma: A Novel', author: 'Kay Writer', identity: { isbn10: '0306406152', isbn13: ISBN } });
  assert.ok(sameEdition(a, b));
  assert.ok(sameWork(a, b, true));
  assert.equal(bookKey(a), `isbn:${ISBN}`); // the key is the edition, not the local id
  // same title, a different author: a different book (never combined, nothing lent)
  const stranger = book({ id: 'x', title: 'Hungered Gamma', author: 'Zed Other', ratingAverage: 2, ratingCount: 500, ratingSource: 'openlibrary' });
  assert.equal(sameWork(a, stranger, true), false);
  assert.equal(withKnownRating(a, [stranger]), a);
  // series volumes stay distinct
  assert.equal(sameWork(book({ title: 'Mistborn: The Final Empire', author: 'B S' }), book({ title: 'Mistborn: The Well of Ascension', author: 'B S' }), true), false);
});

test('resolveBook keeps the caller\'s record id and fills identity without replacing it', async () => {
  routeFetch([olOther, googleBy([gbItem('gv1', 'Identity Alpha', 'Ida Author', { industryIdentifiers: isbnId(), description: LONG })], []), apple()]);
  const r = await resolveBook({ title: 'Identity Alpha', author: 'Ida Author', isbn: ISBN, fallbackId: 'my-local-id' });
  assert.equal(r?.book.id, 'my-local-id');
  assert.equal(r?.book.identity?.gbVolume, 'gv1');
  assert.equal(r?.book.identity?.isbn13, ISBN);
});

// ----------------------------------------------------------- rating ladder ----

test('the ladder is Apple -> Open Library -> Google -> none, whatever a stale card or saved copy carries', () => {
  assert.equal(SUFFICIENT_RATINGS, 10); // display eligibility is separate: see the Google test below
  const live = [{ source: 'openlibrary' as const, average: 4.1, count: 300 }, { source: 'google' as const, average: 3.8, count: 60 }, { source: 'apple' as const, average: 4.5, count: 900 }];
  // the generic cause behind "Open Library is main although Apple has ratings": the card carries Open Library's pair (resolved before Apple answered)
  const stale = book({ id: 'ol_x', ratingAverage: 4.1, ratingCount: 300, ratingSource: 'openlibrary' });
  assert.deepEqual(mainPair(mainRating(stale, live)), [4.5, 900, 'apple']);
  assert.deepEqual(otherRatings(live, 'apple').map(f => f.source), ['openlibrary', 'google']); // the others stay visible, once each
  // a saved Google pair does not outrank Open Library either
  const savedGoogle = book({ id: 'gb_x', ratingAverage: 3.8, ratingCount: 60, ratingSource: 'google' });
  assert.deepEqual(mainPair(mainRating(savedGoogle, live.filter(f => f.source !== 'apple'))), [4.1, 300, 'openlibrary']);
  assert.deepEqual(mainPair(mainRating(book({ id: 'n' }), live.filter(f => f.source === 'google'))), [3.8, 60, 'google']);
  assert.equal(mainRating(book({ id: 'n' }), []), undefined); // none
  // while nothing live is known yet the saved pair shows at once
  assert.deepEqual(mainPair(mainRating(stale, [])), [4.1, 300, 'openlibrary']);
});

test('each provider keeps its own average, count and source: nothing is summed or mixed', () => {
  const live = [{ source: 'apple' as const, average: 4.5, count: 12 }, { source: 'openlibrary' as const, average: 3.9, count: 5000 }, { source: 'google' as const, average: 4.2, count: 1 }];
  const main = mainRating(book({ id: 'z' }), live);
  assert.deepEqual(mainPair(main), [4.5, 12, 'apple']);
  assert.deepEqual(otherRatings(live, main?.source).map(f => [f.source, f.average, f.count]), [['openlibrary', 3.9, 5000], ['google', 4.2, 1]]);
});

test('a Google rating displays with even one rating; SUFFICIENT_RATINGS only decides between sources', () => {
  assert.deepEqual(externalRating({ ratingAverage: 4.2, ratingCount: 1 }), { average: 4.2, count: 1 });
  assert.deepEqual(chooseRating({ google: { average: 4.2, count: 1 } }), { average: 4.2, count: 1 });
  assert.deepEqual(mainPair(mainRating(book({ id: 'g' }), [{ source: 'google', average: 4.2, count: 1 }])), [4.2, 1, 'google']);
  const html = renderToStaticMarkup(React.createElement(RatingLine, { book: book({ ratingAverage: 4.2, ratingCount: 1, ratingSource: 'google' }) }));
  assert.ok(html.includes('4.2') && html.includes('1 ratings'));
  // a thin preferred source still yields to a solid lower one (unchanged), but a lone thin pair is never hidden
  assert.deepEqual(chooseRating({ apple: { average: 5, count: 3 }, ol: { average: 4, count: 500 } }), { average: 4, count: 500 });
  assert.deepEqual(chooseRating({ apple: { average: 5, count: 3 } }), { average: 5, count: 3 });
});

test('a saved copy or Store merge never overrides a better-ranked pair; the library\'s own rating still does', () => {
  const card = book({ id: 'ol_a', title: 'Merge Alpha', author: 'Mo Author', ratingAverage: 4.4, ratingCount: 700, ratingSource: 'apple' });
  const savedOl = book({ id: 'saved-1', title: 'Merge Alpha', author: 'Mo Author', ratingAverage: 3.1, ratingCount: 40, ratingSource: 'openlibrary' });
  assert.equal(withKnownRating(card, [savedOl]), card); // a stale saved Open Library pair does not replace the card's Apple pair
  // ...but a saved Apple pair does replace a card's Open Library pair (the ladder, not "whoever is the library")
  const cardOl = book({ id: 'ol_b', title: 'Merge Alpha', author: 'Mo Author', ratingAverage: 3.1, ratingCount: 40, ratingSource: 'openlibrary' });
  const savedApple = book({ id: 'saved-2', title: 'Merge Alpha', author: 'Mo Author', ratingAverage: 4.4, ratingCount: 700, ratingSource: 'apple' });
  assert.deepEqual(pairOf(withKnownRating(cardOl, [savedApple])), [4.4, 700, 'apple']);
  // a card with no rating borrows the saved pair, with its source
  assert.deepEqual(pairOf(withKnownRating(book({ id: 'ol_c', title: 'Merge Alpha', author: 'Mo Author' }), [savedOl])), [3.1, 40, 'openlibrary']);
  // the library's own hand-written pair always wins
  const mine = book({ id: 3, source: 'curated', title: 'Merge Alpha', author: 'Mo Author', ratingAverage: 4.9, ratingCount: 20000 });
  assert.deepEqual(pairOf(withKnownRating(card, [mine])), [4.9, 20000, 'library']);
  assert.deepEqual(knownRating(card, [mine]), { average: 4.9, count: 20000, source: 'library' });

  // mergeBooks: the better-ranked attributed pair is kept whichever record came first; unattributed pairs keep the old rule (a wins)
  assert.deepEqual(pairOf(mergeBooks(cardOl, card)), [4.4, 700, 'apple']);
  assert.deepEqual(pairOf(mergeBooks(card, cardOl)), [4.4, 700, 'apple']);
  assert.deepEqual(pairOf(mergeBooks(book({ ratingAverage: 4, ratingCount: 10 }), book({ ratingAverage: 3, ratingCount: 99999, ratingSource: 'apple' }))), [4, 10, undefined]);
});

test('re-adding a book never wipes or downgrades its saved rating pair', () => {
  const state = (customBooks: any[]) => ({ status: {}, currentPage: {}, totalPages: {}, dailyLog: {}, notes: {}, highlights: {}, goal: 10, readingIntention: '', profile: { name: '', photo: '', theme: 'auto' }, customBooks, onDeviceOverrides: {}, hiddenBookIds: {}, words: [], garden: { plants: {}, placements: {}, achievements: {}, celebrated: {} } }) as any;
  const saved = book({ id: 'ol_keep', title: 'Readd Alpha', author: 'Rae Author', ratingAverage: 4.4, ratingCount: 700, ratingSource: 'apple' });
  const noRating = { ...saved, ratingAverage: undefined, ratingCount: undefined, ratingSource: undefined };
  const lower = { ...saved, ratingAverage: 3.1, ratingCount: 40, ratingSource: 'openlibrary' };
  const newer = { ...saved, ratingAverage: 4.6, ratingCount: 800, ratingSource: 'apple' };
  assert.deepEqual(pairOf(applyAddBook(state([saved]), noRating as any).customBooks[0]), [4.4, 700, 'apple']);
  assert.deepEqual(pairOf(applyAddBook(state([saved]), lower as any).customBooks[0]), [4.4, 700, 'apple']);
  assert.deepEqual(pairOf(applyAddBook(state([saved]), newer as any).customBooks[0]), [4.6, 800, 'apple']); // the same site's fresher pair wins
  assert.equal(applyAddBook(state([saved]), lower as any).customBooks[0].id, 'ol_keep'); // library ids are untouched
});

// ------------------------------------------------ Apple, end to end through the resolver ----

test('Apple: the rated listing among matches is used, not simply the first (an unrated duplicate no longer hides the rating)', async () => {
  routeFetch([apple(appleItem('Dup Alpha', 'Pat Author'), appleItem('Dup Alpha: Study Guide', 'Pat Author', 2, 9999), appleItem('Dup Alpha', 'Pat Author', 4.4, 1200))]); // the study guide is not a stand-in
  const r = await lookupApple({ title: 'Dup Alpha', author: 'Pat Author' });
  assert.equal(r.hit?.book.ratingAverage, 4.4);
  assert.equal(r.hit?.book.ratingCount, 1200);

  routeFetch([olSearch('/works/OL801W', 'Dup Alpha', 'Pat Author', { ratings_average: 4.1, ratings_count: 300 }), olOther, googleBy([], []), apple(appleItem('Dup Alpha', 'Pat Author'), appleItem('Dup Alpha', 'Pat Author', 4.4, 1200))]);
  assert.deepEqual(pairOf((await resolveBook({ title: 'Dup Alpha', author: 'Pat Author', apple: true }))!.book), [4.4, 1200, 'apple']);
});

test('a card resolved while Apple was unreachable shows Open Library; the book info then prefers the Apple rating it finds', async () => {
  routeFetch([olSearch('/works/OL802W', 'Late Apple', 'Quin Author', { ratings_average: 4.1, ratings_count: 300 }), olOther, googleBy([], []), appleDown]);
  const card = (await resolveBook({ title: 'Late Apple', author: 'Quin Author', apple: true }))!.book;
  assert.deepEqual(pairOf(card), [4.1, 300, 'openlibrary']);
  routeFetch([olSearch('/works/OL802W', 'Late Apple', 'Quin Author', { ratings_average: 4.1, ratings_count: 300 }), olOther, googleBy([], []), apple(appleItem('Late Apple', 'Quin Author', 4.6, 2500))]);
  const found = await fetchRatingSources(book({ id: 'ol_la', title: 'Late Apple', author: 'Quin Author' }));
  assert.deepEqual(found.map(f => f.source).sort(), ['apple', 'openlibrary']);
  assert.deepEqual(mainPair(mainRating(card, found)), [4.6, 2500, 'apple']);
  assert.deepEqual(otherRatings(found, 'apple').map(f => [f.source, f.average, f.count]), [['openlibrary', 4.1, 300]]);
});

// ---------------------------------------------------------- Google fallback ----

test('Google: an exact-ISBN volume that is another book is not used; the safely matched edition is', async () => {
  const wrong = gbItem('wrong1', 'A Completely Different Title', 'Another Person', { industryIdentifiers: isbnId(), pageCount: 500, averageRating: 5, ratingsCount: 900, description: LONG });
  const right = gbItem('right1', 'Wrong Isbn', 'Kay Writer', { pageCount: 321, publishedDate: '2021', description: LONG });
  routeFetch([googleBy([wrong], [right])]);
  const hit = await findGoogle({ title: 'Wrong Isbn', author: 'Kay Writer', isbn: ISBN });
  assert.equal(hit?.book.id, 'gb_right1');
  assert.equal(hit?.book.pageCount, 321);
  assert.notEqual(hit?.book.ratingCount, 900);
  // the rating search ignores the other book's pair too
  routeFetch([googleBy([wrong], [])]);
  assert.equal((await findGoogleRating({ title: 'Wrong Isbn', author: 'Kay Writer', isbn: ISBN })).hit, null);
});

test('Google: a sparse exact-ISBN edition is completed field by field from matched alternate editions only', async () => {
  const sparse = gbItem('ex1', 'Hungered Delta', 'Kay Writer', { industryIdentifiers: isbnId(), pageCount: undefined, publishedDate: undefined });
  const alt = gbItem('alt2', 'Hungered Delta', 'Kay Writer', { pageCount: 321, publishedDate: '2021', description: LONG, imageLinks: { thumbnail: 'http://books.example/cover.jpg&edge=curl' }, averageRating: 4.2, ratingsCount: 1, categories: ['Fiction'] });
  const otherTitle = gbItem('bad3', 'Hungered Delta Cookbook', 'Kay Writer', { pageCount: 999, publishedDate: '1999', averageRating: 1, ratingsCount: 50 });
  const otherAuthor = gbItem('bad4', 'Hungered Delta', 'Zed Other', { pageCount: 777, averageRating: 2, ratingsCount: 80 });
  const calls = routeFetch([googleBy([sparse], [sparse, otherTitle, otherAuthor, alt])]);
  assert.equal(isSparseGoogle(gbItemToHit(sparse)), true);
  const hit = await findGoogle({ title: 'Hungered Delta', author: 'Kay Writer', isbn: ISBN });
  assert.equal(hit?.book.id, 'gb_ex1'); // still the exact edition
  assert.deepEqual(hit?.book.identity, { gbVolume: 'ex1', isbn13: ISBN, isbn10: '0306406152' });
  assert.equal(hit?.book.pageCount, 321);
  assert.equal(hit?.book.year, '2021');
  assert.equal(hit?.book.coverUrl, 'https://books.example/cover.jpg');
  assert.equal(hit?.book.genre, 'Fiction');
  assert.ok(hit?.book.summary.startsWith('A long enough description'));
  assert.deepEqual([hit?.book.ratingAverage, hit?.book.ratingCount], [4.2, 1]); // one pair, whole
  assert.equal(googleCalls(calls).length, 2); // the ISBN lookup + one title search
});

test('Google: a complete exact-ISBN edition costs no extra request; a sparse one is capped; values it has are never replaced', async () => {
  const full = gbItem('full1', 'Complete Epsilon', 'Lee Author', { industryIdentifiers: isbnId(), description: LONG, imageLinks: { thumbnail: 'https://books.example/full.jpg' } });
  const calls = routeFetch([googleBy([full], [gbItem('x', 'Complete Epsilon', 'Lee Author', { pageCount: 999 })])]);
  assert.equal((await findGoogle({ title: 'Complete Epsilon', author: 'Lee Author', isbn: ISBN }))?.book.pageCount, 200);
  assert.equal(googleCalls(calls).length, 1);

  const sparse = gbItem('sp1', 'Capped Zeta: A Tale of Hunger and Hope Forever', 'Lee Author', { industryIdentifiers: isbnId(), pageCount: undefined });
  const capped = routeFetch([googleBy([sparse], [])]);
  await findGoogle({ title: 'Capped Zeta: A Tale of Hunger and Hope Forever', author: 'Lee Author', isbn: ISBN });
  assert.equal(googleCalls(capped).length, 2, 'the ISBN lookup + ONE search, never the other title variants'); // sparse, so one search is made; nothing found, so it stops

  // a caller that needs only a cover does not search again for a missing description, and one that needs text does
  const noText = gbItem('nt1', 'Need Mu', 'Lee Author', { industryIdentifiers: isbnId('9782222222222'), imageLinks: { thumbnail: 'https://books.example/nt.jpg' } });
  const needCalls = routeFetch([googleBy([noText], [gbItem('nt2', 'Need Mu', 'Lee Author', { description: LONG })])]);
  assert.equal((await findGoogle({ title: 'Need Mu', author: 'Lee Author', isbn: '9782222222222' }, {}, ['cover']))?.book.coverUrl, 'https://books.example/nt.jpg');
  assert.equal(googleCalls(needCalls).length, 1);
  assert.ok((await findGoogle({ title: 'Need Mu', author: 'Lee Author', isbn: '9782222222222' }, {}, ['text']))?.book.summary.startsWith('A long enough description'));
  assert.equal(googleCalls(needCalls).length, 3);

  // fillGoogleGaps itself never overwrites what the volume has
  const base = gbItemToHit(gbItem('b1', 'Keep Eta', 'Lee Author', { pageCount: 100, publishedDate: '2001', description: LONG }));
  const filled = fillGoogleGaps(base, [gbItemToHit(gbItem('b2', 'Keep Eta', 'Lee Author', { pageCount: 999, publishedDate: '2030' }))]);
  assert.deepEqual([filled.book.pageCount, filled.book.year], [100, '2001']);
});

test('Google: with no ISBN, the other matching editions of the same search fill the gaps at no extra request', async () => {
  const first = gbItem('n1', 'Rules Theta', 'Mia Author', { pageCount: undefined, publishedDate: undefined, averageRating: 3.9, ratingsCount: 30 });
  const second = gbItem('n2', 'Rules Theta', 'Mia Author', { pageCount: 280, publishedDate: '2019', description: LONG });
  const calls = routeFetch([googleBy([], [first, second])]);
  const hit = await findGoogle({ title: 'Rules Theta', author: 'Mia Author' });
  assert.equal(hit?.book.id, 'gb_n1'); // the best-rated edition stays the base
  assert.deepEqual([hit?.book.pageCount, hit?.book.year], [280, '2019']);
  assert.deepEqual([hit?.book.ratingAverage, hit?.book.ratingCount], [3.9, 30]); // its own rating, not the other edition's
  assert.equal(googleCalls(calls).length, 1);
});

test('Google: the resolver uses a sparse exact edition + alternates for metadata, and Google\'s single rating is the card\'s rating', async () => {
  const iotaIsbn = '9781111111111'; // the resolver saves results per ISBN: each test uses its own
  const sparse = gbItem('rs1', 'Resolve Iota', 'Ned Author', { industryIdentifiers: isbnId(iotaIsbn), pageCount: undefined, publishedDate: undefined });
  const alt = gbItem('rs2', 'Resolve Iota', 'Ned Author', { pageCount: 410, publishedDate: '2022', description: LONG, averageRating: 4.6, ratingsCount: 1 });
  routeFetch([olOther, googleBy([sparse], [sparse, alt]), apple()]);
  const r = await resolveBook({ title: 'Resolve Iota', author: 'Ned Author', isbn: iotaIsbn, fallbackId: 'fb-iota' });
  assert.deepEqual([r?.book.pageCount, r?.book.year], [410, '2022']);
  assert.deepEqual(pairOf(r?.book), [4.6, 1, 'google']);
  assert.ok(r?.ratings?.some(x => x.source === 'google' && x.count === 1));
  assert.equal(r?.book.id, 'fb-iota');
});

test('Google: an API failure is told apart from genuinely missing data', async () => {
  routeFetch([u => (isGoogle(u) ? { status: 503, body: {} } : undefined)]);
  const failed = await findGoogleRating({ title: 'Failure Kappa', author: 'Oz Author' });
  assert.deepEqual([failed.hit, failed.failed], [null, true]);
  routeFetch([googleBy([], [gbItem('k1', 'Missing Kappa', 'Oz Author')])]); // answered fine, no rating anywhere
  const missing = await findGoogleRating({ title: 'Missing Kappa', author: 'Oz Author' });
  assert.deepEqual([missing.hit, missing.failed], [null, false]);
});

// ------------------------------------------------------------ cache / loading ----

test('no regression: a resolved book is served from the saved result, and concurrent asks share one lookup', async () => {
  const calls = routeFetch([olSearch('/works/OL803W', 'Cache Lambda', 'Pia Author', { ratings_average: 4, ratings_count: 50 }), olOther, googleBy([], []), apple(appleItem('Cache Lambda', 'Pia Author', 4.3, 200))]);
  const q = { title: 'Cache Lambda', author: 'Pia Author', apple: true };
  const [a, b] = await Promise.all([resolveBook(q), resolveBook(q)]);
  assert.deepEqual(pairOf(a?.book), [4.3, 200, 'apple']);
  assert.deepEqual(pairOf(b?.book), pairOf(a?.book));
  const used = calls.length;
  assert.ok(used > 0);
  await resolveBook(q);
  assert.equal(calls.length, used); // no new request: instant cached display is unchanged
});
