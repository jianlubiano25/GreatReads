import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SEARCH_GENRES } from '../../data/searchGenres';
import { genrePicks, genrePopular } from './genrePicks';
import { NYT_EXTRA_SHELVES, NYT_GENRE_SHELVES } from './lists';
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
  // the page is HTML: "Humor & Comedy" is written with &amp; and "Children's" with &#x27;
  const html_ = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;');
  for (const g of SEARCH_GENRES) assert.ok(html.includes(html_(g.label)), `${g.label} is listed`);
});

test('a genre with an official NYT list gets a "Popular now" row from it; one without gets none', () => {
  const ids = new Set([...NYT_GENRE_SHELVES, ...NYT_EXTRA_SHELVES].map(x => x.id));
  const lists = [...NYT_GENRE_SHELVES, ...NYT_EXTRA_SHELVES].map(x => x.list);
  assert.equal(new Set(NYT_GENRE_SHELVES.map(x => x.id)).size, NYT_GENRE_SHELVES.length);
  for (const g of SEARCH_GENRES) {
    const p = genrePopular(g);
    if (!g.popular) { assert.equal(p, null, g.label); continue; }
    assert.ok(ids.has(g.popular), `${g.label}: unknown NYT shelf ${g.popular}`);
    assert.ok(p && p.id === g.popular, g.label);
    assert.equal(genrePopular(g), p, `${g.label}: one source object per genre`);
  }
  for (const s of NYT_GENRE_SHELVES) assert.equal(s.fallback, false, `${s.id}: official only, no GreatReads stand-in`);
  assert.equal(new Set(lists).size, lists.length, 'no NYT list used twice');
  assert.equal(genrePopular(SEARCH_GENRES.find(g => g.label === 'Fantasy')!), null);
});

test('the NYT row (headed by the official list name) shows above the hand-picked row on the genre itself, and not on a sub-genre', () => {
  const g = SEARCH_GENRES.find(x => x.label === 'Business')!;
  const main = renderToStaticMarkup(h(GenrePicks, { genre: g, query: g.query, known: [], onPick: noop, onOpen: noop }));
  assert.ok(main.indexOf('data-shelf-id="nyt-genre-business"') >= 0 && main.indexOf('NYT Best Sellers') < main.indexOf('Hand-picked'));
  const sub = renderToStaticMarkup(h(GenrePicks, { genre: g, query: g.subgenres[0].query, known: [], onPick: noop, onOpen: noop }));
  assert.ok(!/nyt-genre-business/.test(sub));
});
