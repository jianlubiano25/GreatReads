import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SEARCH_GENRES } from '../../data/searchGenres';
import { genrePicks } from './genrePicks';
import { GenrePicks } from '../../components/GenrePicks';
import { SearchTab } from '../../components/tabs/SearchTab';

const noop = () => {};

test('every genre has a row of picks: the Store shelf for it, or its own hand-picked list', () => {
  const ids = new Set<string>();
  for (const g of SEARCH_GENRES) {
    const p = genrePicks(g);
    assert.ok(p, `${g.label} has no picks`);
    if (!g.shelfId) assert.ok(p.id.startsWith('genre-'), p.id);
    assert.equal(genrePicks(g), p, `${g.label}: one source object per genre (a shelf reloads when its source changes)`);
    ids.add(p.id);
  }
  assert.equal(ids.size, SEARCH_GENRES.length, 'no two genres share a shelf');
});

test('a genre page shows its name, sub-genre chips and (on the genre itself) the picks; a sub-genre hides the picks', () => {
  const g = SEARCH_GENRES.find(x => x.label === 'Thriller')!;
  const main = renderToStaticMarkup(h(GenrePicks, { genre: g, query: g.query, known: [], onPick: noop, onOpen: noop }));
  assert.match(main, /Thriller/);
  assert.match(main, /All Thriller/);
  for (const s of g.subgenres) assert.match(main, new RegExp(s.label));
  assert.match(main, /Hand-picked/);
  const sub = renderToStaticMarkup(h(GenrePicks, { genre: g, query: g.subgenres[0].query, known: [], onPick: noop, onOpen: noop }));
  assert.ok(!/Hand-picked/.test(sub));
  assert.match(sub, /aria-pressed="true"[^>]*>Psychological thriller/);
});

test('the Search tab still lists every genre to browse', () => {
  const html = renderToStaticMarkup(h(SearchTab, { active: true, allBooks: [], handleOpenCover: noop }));
  for (const g of SEARCH_GENRES) assert.match(html, new RegExp(g.label.replace(/[&]/g, '&amp;')));
});
