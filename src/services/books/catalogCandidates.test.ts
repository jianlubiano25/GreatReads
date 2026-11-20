// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { catalogBookOf, catalogGenreCandidates, catalogSearchCandidates, genreEvidenceOfWork } from './catalogCandidates';
import { dedupeBooks } from './merge';
import { parseQuery } from './query';
import { SEARCH_GENRES } from '../../data/searchGenres';
import type { CatalogWork } from './catalogCovers';

const work = (o: Partial<CatalogWork> & { id: string; title: string }): CatalogWork => ({ key: null, author: '', updatedAt: '2026-01-01', cover: null, ...o }) as CatalogWork;
const fantasy = SEARCH_GENRES.find(g => g.label === 'Fantasy')!;
const sf = SEARCH_GENRES.find(g => g.label === 'Science Fiction')!;

test('a catalog work with genres naming the genre is a candidate; title words, no genres and "Book" are not', () => {
  const works = [
    work({ id: '1', title: 'The Hobbit', author: 'J.R.R. Tolkien', genres: ['Fantasy'], ratings: [{ source: 'google_books', average: 4.3, count: 900 }] }),
    work({ id: '2', title: 'Fantasy Football Guide', author: 'X Y', genres: ['Sports'] }),
    work({ id: '3', title: 'Untagged Dragon Book', author: 'A B' }),
    work({ id: '4', title: 'Generic', author: 'A B', genres: ['Book'] }),
    work({ id: '5', title: 'Dune', author: 'Frank Herbert', genres: ['dystopia'] }),
  ];
  assert.deepEqual(catalogGenreCandidates(fantasy, works).map(b => b.title), ['The Hobbit']);
  assert.deepEqual(catalogGenreCandidates(sf, works).map(b => b.title), ['Dune']); // subjectTerms evidence for a subject genre
  assert.equal(genreEvidenceOfWork(fantasy, { genres: [] }), false);
});

test('a candidate carries the catalog facts and dedupes with the provider record by canonical work identity (provider id stays)', () => {
  const w = work({ id: 'w1', title: 'The Hobbit', author: 'J.R.R. Tolkien', genres: ['Fantasy'], cover: 'https://img.example/h.jpg', identifiers: { olWork: 'OL262758W' }, editions: [{ isbn13: '9780547928227', year: 1937, pages: 300 }], ratings: [{ source: 'apple_books', average: 4.6, count: 2000 }] });
  const cand = catalogBookOf(w);
  assert.equal(cand.identity?.olWork, 'OL262758W');
  assert.equal(cand.ratingAverage, 4.6);
  assert.equal(cand.ratingSource, 'apple');
  const provider = { id: 'ol_works_OL262758W', title: 'The Hobbit', author: 'J. R. R. Tolkien', shelf: 'mine', difficulty: 2, isOnDevice: false, year: '', genre: '', summary: '', authorBio: '', pageCount: 0, identity: { olWork: 'OL262758W' } } as any;
  const merged = dedupeBooks([provider, cand]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'ol_works_OL262758W');
  assert.equal(merged[0].pageCount, 300);
  // a work merged into another is never a candidate
  assert.deepEqual(catalogGenreCandidates(fantasy, [work({ id: '9', title: 'Old', genres: ['Fantasy'], identifiers: { mergedInto: 'x' } })]), []);
});

test('search candidates: title, author and alias words all find a published work; scope and topic searches are respected', () => {
  const works = [
    work({ id: '1', title: "Harry Potter and the Philosopher's Stone", author: 'J.K. Rowling', authorAliases: ['Joanne Rowling'] }),
    work({ id: '2', title: 'Emma', author: 'Jane Austen' }),
    work({ id: '3', title: 'Dark Matter', author: 'Blake Crouch' }),
  ];
  const names = (t: string, scope: any = 'all', author = '') => catalogSearchCandidates(parseQuery(t, author, true, scope), 20, works).map(b => b.title);
  assert.deepEqual(names('harry potter'), ["Harry Potter and the Philosopher's Stone"]);
  assert.deepEqual(names('j.k. rowling'), ["Harry Potter and the Philosopher's Stone"]);
  assert.deepEqual(names('joanne rowling'), ["Harry Potter and the Philosopher's Stone"]);
  assert.deepEqual(names('jane aust'), ['Emma']);
  assert.deepEqual(names('dark matter'), ['Dark Matter']);
  assert.deepEqual(names('austen', 'title'), []); // Title scope looks at titles only
  assert.deepEqual(names('cozy', 'keywords'), []);
  assert.deepEqual(names('matter', 'all', 'crouch'), ['Dark Matter']);
});
