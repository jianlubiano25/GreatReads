// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { searchBooksLive, searchLocal, searchRelevance, forgetRecentSearchesForTests } from './search';
import { forgetSeenForTests } from './localIndex';
import { parseQuery } from './query';
import { isMoodQuery, keywordGroups, keywordPhrases, stem } from './keywords';
import { isBlocked } from './quality';

const book = (o: any) => ({ id: o.title, title: 'T', author: 'A B', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '2020', genre: 'Fiction', summary: 'x'.repeat(80), authorBio: '', pageCount: 300, ...o }) as any;
const ol = (key: string, title: string, author: string, extra: any = {}) => ({ key: `/works/${key}`, title, author_name: [author], first_publish_year: 2001, ...extra });
function mockFetch(handler: (url: URL) => unknown) {
  const seen: URL[] = [];
  (globalThis as any).fetch = async (input: string) => {
    const url = new URL(String(input), 'https://example.test');
    seen.push(url);
    const body = handler(url);
    return { ok: body !== null, status: body === null ? 404 : 200, json: async () => body };
  };
  return seen;
}
const reset = () => { store.clear(); forgetRecentSearchesForTests(); forgetSeenForTests(); };

/* ---------- occult / demonic filter: narrow ---------- */

test('named occult works and practices are blocked', () => {
  assert.ok(isBlocked('The Satanic Bible'));
  assert.ok(isBlocked('Demonolatry: Worship of Demons'));
  assert.ok(isBlocked('The Goetia'));
  assert.ok(isBlocked('The Lesser Key of Solomon', { subjects: ['Magic'] }));
  assert.ok(isBlocked('The Necronomicon', { subjects: ['Magic', 'Occultism'] }));
  assert.ok(isBlocked('Necronomicon'), 'the grimoire, with no categories at all');
  assert.ok(isBlocked('Grimoire of the Dark', { subjects: ['Occultism', 'Demonology'] }), 'two independent signals');
  assert.ok(isBlocked('Worship the Devil', { subjects: ['Satanism'] }), 'a practice category');
});

test('books that merely mention Satan, demons, witches, the occult or religion are NOT blocked', () => {
  assert.ok(!isBlocked('The Satanic Verses', { subjects: ['Fiction'] }), 'a novel: the word "satanic" alone decides nothing');
  assert.ok(!isBlocked('The Satanic Verses'));
  assert.ok(!isBlocked('Paradise Lost', { subjects: ['Epic poetry'], description: 'Satan, the rebel angel, is its most compelling figure.' }));
  assert.ok(!isBlocked('Necronomicon: The Best Weird Tales of H.P. Lovecraft', { subjects: ['Horror tales'] }), 'fiction that shares the name');
  assert.ok(!isBlocked('Satanism: A Social History', { subjects: ['Satanism -- History'] }), 'a study');
  assert.ok(!isBlocked('The Occult: A History', { subjects: ['Occultism -- History'] }), 'the history of the occult');
  assert.ok(!isBlocked('Black Mass', { subjects: ['Organized crime'] }), 'a crime book, not a rite');
  assert.ok(!isBlocked('Demon Copperhead', { subjects: ['Fiction'] }));
  assert.ok(!isBlocked('The Exorcist', { subjects: ['Horror'] }));
  assert.ok(!isBlocked('A Discovery of Witches', { subjects: ['Fantasy'] }));
  assert.ok(!isBlocked('Inferno', { subjects: ['Epic poetry'], description: 'Demons and devils of hell, in Dante\'s journey.' }));
  assert.ok(!isBlocked('The Devil in the White City', { subjects: ['History'] }));
});

test('a book already in your library is found even when the same title would be blocked online; nothing is stripped from it', async () => {
  reset();
  const mine = book({ id: 'my1', title: 'The Satanic Bible', author: 'Anton LaVey', source: 'manual' });
  assert.deepEqual(searchLocal('satanic bible', '', 10, [mine]).map(b => b.id), ['my1']);
  mockFetch(url => (url.hostname === 'openlibrary.org' ? { docs: [ol('OL7W', 'The Satanic Bible', 'Anton LaVey', { ratings_count: 5000 })] } : { items: [] }));
  const found = await searchBooksLive('satanic bible', { known: [mine], final: true });
  assert.deepEqual(found.map(b => b.id), ['my1'], 'only your own copy; the online copy stays out');
  assert.deepEqual(mine, book({ id: 'my1', title: 'The Satanic Bible', author: 'Anton LaVey', source: 'manual' }), 'the saved record is untouched');
});

/* ---------- keyword and mood mapping ---------- */

test('mood and genre words map to a little extra searching and matching', () => {
  assert.equal(stem('classics'), 'classic');
  assert.equal(stem('mysteries'), 'mystery');
  assert.equal(stem('chess'), 'chess', 'a double s is not a plural');
  assert.deepEqual(keywordPhrases(['cozy']), ['cozy', 'cozy mystery']);
  assert.deepEqual(keywordPhrases(['classics']), ['classics', 'classic literature']);
  assert.deepEqual(keywordPhrases(['classics', 'mystery']), ['classics mystery', 'classic mystery']);
  assert.deepEqual(keywordPhrases(['dragons']), ['dragons'], 'an unmapped word asks for nothing extra');
  assert.deepEqual(keywordPhrases(['fast', 'paced']), ['fast paced', 'thriller']);
  assert.equal(keywordGroups(['fast', 'paced']).length, 1, 'fast-paced is one phrase');
  assert.ok(isMoodQuery(['cozy']) && isMoodQuery(['hopeful']) && isMoodQuery(['dark']) && isMoodQuery(['fast', 'paced']) && isMoodQuery(['classics']));
  assert.ok(!isMoodQuery(['dune']) && !isMoodQuery(['classics', 'mystery']) && !isMoodQuery(['mystery']));
});

test('a box holding only a mood is read as keywords in All and Keywords, never in Title or Author', () => {
  assert.equal(parseQuery('cozy').mood, true);
  assert.equal(parseQuery('Fast-paced').mood, true);
  assert.equal(parseQuery('cozy', '', true, 'keywords').mood, true);
  assert.equal(parseQuery('cozy', '', true, 'title').mood, false);
  assert.equal(parseQuery('cozy', '', true, 'author').mood, false);
  assert.equal(parseQuery('dune').mood, false);
  assert.equal(parseQuery('Cozy by Somebody').mood, false);
});

test('a mood is also asked as its mapped phrase (one extra phrase, subject searches)', async () => {
  reset();
  const seen = mockFetch(() => ({ docs: [], items: [] }));
  await searchBooksLive('cozy', { local: false });
  const subjects = seen.map(u => u.searchParams.get('subject')).filter(Boolean);
  assert.ok(subjects.includes('cozy') && subjects.includes('cozy mystery'), `asked for: ${subjects.join(', ')}`);
  assert.equal(seen.length, 7); // + the subject asked most-read first
  assert.ok(seen.some(u => u.searchParams.get('subject') === 'cozy' && u.searchParams.get('sort') === 'readinglog'), 'the most-read list is asked for too');
});

test('"classics mystery" in Keywords lists classic mysteries first, then either one alone', async () => {
  reset();
  const seen = mockFetch(url => {
    if (url.hostname !== 'openlibrary.org') return { items: [] };
    return { docs: [
      ol('OL1W', 'A Recent Cozy Thriller', 'New Author', { first_publish_year: 2022, ratings_count: 60000, ratings_average: 4.1, subject: ['Mystery fiction', 'Thrillers'] }),
      ol('OL2W', 'Pride and Prejudice', 'Jane Austen', { first_publish_year: 1813, ratings_count: 900000, ratings_average: 4.3, subject: ['Classic literature', 'Love stories'] }),
      ol('OL3W', 'The Murder of Roger Ackroyd', 'Agatha Christie', { first_publish_year: 1926, ratings_count: 120000, ratings_average: 4.2, subject: ['Detective and mystery stories'] }),
      ol('OL4W', 'Obscure Notes on Greek Classics', 'Some Professor', { first_publish_year: 1951, ratings_count: 0, subject: ['Classical literature'] }),
    ] };
  });
  const found = await searchBooksLive('classics mystery', { scope: 'keywords', local: false, final: true });
  assert.equal(found[0].title, 'The Murder of Roger Ackroyd', found.map(b => b.title).join(' | '));
  const rest = found.slice(1).map(b => b.title);
  assert.ok(rest.indexOf('Pride and Prejudice') < rest.indexOf('Obscure Notes on Greek Classics'));
  assert.ok(rest.indexOf('A Recent Cozy Thriller') < rest.indexOf('Obscure Notes on Greek Classics'));
  assert.ok(seen.some(u => u.searchParams.get('subject') === 'classic mystery'), 'the short form "classic mystery" is asked for too');
});

/* ---------- broad one-word searches: widely read before obscure and specialist ---------- */

test('"chess": widely read books come before old specialist titles that only contain the word', () => {
  const specialist = book({ title: 'Chess Endgame Studies: Proceedings of the Symposium', year: '1962', ratingCount: 0, genre: 'Games' });
  const plainExact = book({ title: 'Chess', year: '1958', ratingCount: 1, genre: 'Games' });
  const novel = book({ title: 'The Queen\'s Gambit', author: 'Walter Tevis', year: '1983', ratingCount: 90000, ratingAverage: 4.3, genre: 'Fiction', summary: 'A young orphan, a chess prodigy, takes on the world of competitive chess in the 1960s.' });
  const history = book({ title: 'The Immortal Game: A History of Chess', author: 'David Shenk', year: '2006', ratingCount: 2500, ratingAverage: 4.0, genre: 'History' });
  const s = (b: any) => searchRelevance(b, 'chess', '', true, false, true);
  assert.ok(s(novel) > s(specialist) && s(novel) > s(plainExact), 'the novel about chess beats unrated titles that contain the word');
  assert.ok(s(history) > s(specialist) && s(history) > s(plainExact));
  // the old behaviour is still what every other caller gets
  assert.ok(searchRelevance(plainExact, 'chess', '', true) > searchRelevance(novel, 'chess', '', true));
});

test('"chess": a topic is detected and the subject is asked for; the widely read books end up on top', async () => {
  reset();
  const obscure = ['Chess Endgames', 'Chess Openings Made Easy', 'Chess Tactics Tables', 'Studies in Chess Problems', 'Chess', 'Chess Strategy Handbook of the Club', 'Chess Notation and Records'].map((t, i) => ol(`OL${10 + i}W`, t, `Author ${i}`, { first_publish_year: 1950 + i, ratings_count: 0 }));
  const seen = mockFetch(url => {
    if (url.hostname !== 'openlibrary.org') return { items: [] };
    if (url.searchParams.get('subject') === 'chess') {
      return { docs: [
        ol('OL1W', 'The Queen\'s Gambit', 'Walter Tevis', { first_publish_year: 1983, ratings_count: 90000, ratings_average: 4.3, subject: ['Chess'] }),
        ol('OL2W', 'The Immortal Game', 'David Shenk', { first_publish_year: 2006, ratings_count: 2500, ratings_average: 4.0, subject: ['Chess', 'History'] }),
      ] };
    }
    return { docs: obscure };
  });
  const found = await searchBooksLive('chess', { local: false });
  assert.ok(seen.some(u => u.searchParams.get('subject') === 'chess'), 'asked Open Library for books filed under the subject');
  assert.ok(seen.some(u => u.hostname.includes('googleapis') && u.searchParams.get('q') === 'subject:chess'), 'and Google Books');
  const top = found.slice(0, 3).map(b => b.title);
  assert.ok(top.includes('The Queen\'s Gambit') && top.includes('The Immortal Game'), `top three: ${top.join(' | ')}`);
});

test('an ordinary title costs no extra request, even one-word', async () => {
  reset();
  const seen = mockFetch(() => ({ docs: [ol('OL1W', 'The Hobbit', 'J. R. R. Tolkien', { ratings_count: 90000 })], items: [] }));
  await searchBooksLive('hobbit', { local: false });
  assert.equal(seen.length, 2);
});
