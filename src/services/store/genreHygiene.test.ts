import test from 'node:test';
import assert from 'node:assert/strict';
import type { CuratedShelf } from '../../data/storeCatalog';
import { genreOrEmpty, isShelfOrHonorLabel, displayGenre } from '../books/catalogFill';
import { seedPlaceholders } from './curated';
import { rowsFor } from '../capture';

/* WP1 / D0: a shelf, prize or club name must never become book.genre or a genre candidate. */

test('prize, club, tag and new-release labels are not genres; real genres pass through', () => {
  for (const bad of ['Prize winner', 'Prize winners', "Reese's Book Club", 'Booker Prize shortlist', 'Inklings', 'New release', "Reader favourite"]) {
    assert.equal(isShelfOrHonorLabel(bad), true, bad);
    assert.equal(genreOrEmpty(bad), '', bad);
  }
  for (const ok of ['Fiction', 'Fiction / Historical', 'Self-help', 'Romcom', 'Cooking Methods']) assert.equal(genreOrEmpty(ok), ok);
  assert.equal(genreOrEmpty(undefined), '');
});

test('a shelf whose genre is a prize or club name gives its books no genre (placeholder default), a real one is kept', () => {
  const mk = (genre: string): CuratedShelf => ({ id: `t-${genre}`, title: 'T', emoji: '⭐', genre, seeds: [['A Book', 'An Author']] });
  assert.notEqual(seedPlaceholders(mk('Prize winner'))[0].genre, 'Prize winner');
  assert.equal(seedPlaceholders(mk('Fiction / Historical'))[0].genre, 'Fiction / Historical');
});

test('admin capture sends no genre candidate for a prize label, and still sends a real genre', () => {
  const rows = (genre: string) => rowsFor({ title: 'T', author: 'A B', genre } as any, 'w1').filter(r => r.table === 'catalog_metadata_candidates' && (r.body as any).field_name === 'genre');
  assert.equal(rows('Prize winner').length, 0);
  assert.equal(rows('Fantasy').length, 1);
});

test('F1: the placeholder "Book" (and shelf/prize labels) is never shown as a genre; real genres are', () => {
  for (const bad of ['Book', 'book', ' Book ', '', undefined, null, 'Prize winner']) assert.equal(displayGenre(bad), '', String(bad));
  assert.equal(displayGenre('Memoir'), 'Memoir');
});
