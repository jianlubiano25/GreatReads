// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { looksEnglish, titleLooksForeign } from './language';
import { hasRealSummary } from './model';
import { weak, weakBio } from './details';
import { mergeBooks } from './merge';
import { makeBook } from './model';
import { openLibraryEnglishTitle, openLibraryEditionCovers, openLibraryEditionPages, forgetEditionsForTests } from './sources/openLibrary';
import { findGoogle, searchGoogle } from './sources/googleBooks';
import { routeFetch } from '../store/testkit';

const FRENCH = "Aujourd'hui, maman est morte. Ou peut-être hier, je ne sais pas. Le narrateur est un homme qui vit à Alger et qui ne pleure pas à l'enterrement de sa mère, dans un roman qui est devenu un classique.";
const ENGLISH = 'A young clerk in Algiers attends his mother’s funeral without crying, and what follows after a killing on a beach is a trial that judges the man as much as the deed.';

test('descriptions and bios in another language are not accepted as the English ones', () => {
  assert.equal(looksEnglish(ENGLISH), true);
  assert.equal(looksEnglish(FRENCH), false);
  assert.equal(looksEnglish('Albert Camus était un écrivain, philosophe et journaliste français, et il est l’auteur de ce roman qui est connu dans le monde.'), false);
  assert.equal(looksEnglish('Это роман о человеке, который живёт в Алжире и не плачет на похоронах матери, и о суде над ним.'), false);
  assert.equal(looksEnglish('Short text'), true); // too little to judge: kept
  assert.equal(hasRealSummary(FRENCH), false);
  assert.equal(hasRealSummary(ENGLISH), true);
  assert.equal(weak(FRENCH), true);
  assert.equal(weak(ENGLISH), false);
  assert.equal(weakBio('Albert Camus était un écrivain, philosophe et journaliste français, et il est l’auteur de ce roman célèbre.'), true);
});

test('titles that look foreign are only a hint to look for an English one', () => {
  for (const t of ['L’étranger', 'Der Process', 'Cien años de soledad', 'La peste', 'Les Misérables', 'Преступление и наказание']) assert.equal(titleLooksForeign(t), true, t);
  for (const t of ['The Stranger', 'How to Win at Chess', 'Pokémon', 'Café Society', 'Dune', 'Of Mice and Men', 'Lord of the Flies']) assert.equal(titleLooksForeign(t), false, t);
});

test('a foreign catalogue title takes the English title of its other copy; an accent alone does not', () => {
  const fr = makeBook({ id: 'ol_/works/OL1230613W', title: 'L’étranger', author: 'Albert Camus', summary: FRENCH, authorBio: 'Albert Camus était un écrivain, philosophe et journaliste français, et il est l’auteur de ce roman célèbre.' });
  const en = makeBook({ id: 'gb_x', title: 'The Stranger', author: 'Albert Camus', summary: ENGLISH, authorBio: 'Albert Camus was a French philosopher, author and journalist who won the Nobel Prize in Literature in 1957.' });
  const m = mergeBooks(fr, en);
  assert.equal(m.title, 'The Stranger');
  assert.equal(m.id, 'ol_/works/OL1230613W'); // the record id never changes
  assert.equal(m.summary, ENGLISH);
  assert.match(m.authorBio, /was a French philosopher/);
  assert.equal(mergeBooks(makeBook({ id: 'a', title: 'Pokémon', author: 'X Y' }), makeBook({ id: 'b', title: 'Pokemon', author: 'X Y' })).title, 'Pokémon');
});

const ed = (title: string, langs: string[], extra: any = {}) => ({ title, languages: langs.map(key => ({ key: `/languages/${key}` })), ...extra });

test('Open Library: the English title comes from the English editions, and one editions request serves pages, covers and title', async () => {
  forgetEditionsForTests();
  const calls = routeFetch([u => u.pathname === '/works/OL1230613W/editions.json' ? { body: { entries: [
    ed('L’étranger', ['fre'], { covers: [1] }), ed('The Stranger', ['eng'], { covers: [2], number_of_pages: 123 }), ed('The Outsider', ['eng'], { covers: [3] }), ed('The Stranger', ['eng'], { covers: [4] }), ed('Der Fremde', ['ger'], { covers: [5] }),
  ] } } : undefined]);
  assert.equal(await openLibraryEnglishTitle('OL1230613W'), 'The Stranger');
  assert.deepEqual(await openLibraryEditionCovers('OL1230613W'), [2, 3, 4]); // no French or German jacket
  assert.equal(await openLibraryEditionPages('OL1230613W'), 123);
  assert.equal(calls.filter(c => c.includes('editions.json')).length, 1);
  forgetEditionsForTests();
  routeFetch([() => ({ body: { entries: [ed('L’étranger', ['fre'])] } })]);
  assert.equal(await openLibraryEnglishTitle('OL9W'), ''); // no English edition: nothing to swap in
});

test('Google Books: searches ask for English volumes; an exact ISBN lookup is not restricted, and a foreign exact edition yields to an English one', async () => {
  const gb = (id: string, title: string, language: string) => ({ id, volumeInfo: { title, authors: ['Albert Camus'], language, publishedDate: '1989', pageCount: 123, description: language === 'en' ? ENGLISH : FRENCH, imageLinks: { thumbnail: `https://g/${id}.jpg` } } });
  const calls = routeFetch([u => {
    if (!u.pathname.endsWith('/volumes')) return undefined;
    const q = u.searchParams.get('q') || '';
    if (q.startsWith('isbn:')) return { body: { items: [gb('fr1', 'L’étranger', 'fr')] } };
    return { body: { items: u.searchParams.get('langRestrict') === 'en' ? [gb('en1', 'The Stranger', 'en')] : [gb('fr1', 'L’étranger', 'fr')] } };
  }]);
  const found = await findGoogle({ title: 'The Stranger', author: 'Albert Camus', isbn: '9782070360024' });
  assert.equal(found?.book.title, 'The Stranger');
  assert.equal(found?.flags.language, 'en');
  const isbnCall = calls.find(c => decodeURIComponent(c).includes('q=isbn:'))!;
  assert.ok(!isbnCall.includes('langRestrict'), isbnCall);
  assert.ok(calls.filter(c => !decodeURIComponent(c).includes('q=isbn:')).every(c => c.includes('langRestrict=en')));
  routeFetch([() => ({ body: { items: [] } })]);
  assert.deepEqual(await searchGoogle('anything', 5), []);
});

test('resolveBook shows the English title of a work Open Library files under a foreign one, and keeps its id', async () => {
  const { resolveBook } = await import('./resolve');
  forgetEditionsForTests();
  store.clear();
  routeFetch([
    u => (u.pathname === '/search.json' ? { body: { numFound: 1, docs: [{ key: '/works/OL1230613W', title: 'L’étranger', author_name: ['Albert Camus'], first_publish_year: 1942, cover_i: 7, language: ['fre', 'eng'], ratings_count: 900, ratings_average: 4.0 }] } } : undefined),
    u => (u.pathname === '/works/OL1230613W/editions.json' ? { body: { entries: [ed('The Stranger', ['eng'], { covers: [2] })] } } : undefined),
  ]);
  const r = await resolveBook({ title: 'The Stranger', author: 'Albert Camus' });
  assert.equal(r?.book.title, 'The Stranger');
  assert.equal(String(r?.book.id), 'ol_/works/OL1230613W'.replace(/\W/g, '_'));
});
