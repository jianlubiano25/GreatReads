import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_BOOKS } from '../../data/defaultBooks';
import { awardsFor } from '../../components/BookMeta';
import { StoreShelf } from '../../components/StoreShelf';
import { SEARCH_GENRES } from '../../data/searchGenres';

const noop = () => {};

test('Discover shelves show every honor of a book in full: nothing is cut to one line or hidden', () => {
  const book = DEFAULT_BOOKS.find(b => awardsFor(b).length >= 1)!;
  assert.ok(book, 'a built-in book with honors');
  const html = renderToStaticMarkup(h(StoreShelf, { id: 'x', title: 'T', books: [book], onOpen: noop }));
  const chips = html.match(/class="rl-bdg[ "]/g) || [];
  assert.equal(chips.length, awardsFor(book).length);
  assert.ok(!/truncate whitespace-nowrap/.test(html), 'no truncated badge');
  assert.ok(!/h-\[26px\] overflow-hidden/.test(html), 'no fixed-height box clipping the honors');
});

test('the icon bar scrolls smoothly (unless the reader asks for less motion), with the flicker guard', () => {
  const nav = readFileSync(new URL('../../components/StoreNav.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
  assert.match(nav, /behavior: still \? 'auto' : 'smooth'/);
  assert.match(nav, /rl-jumping/);
  assert.match(css, /\.rl-jumping \.rl-shelf \{ content-visibility: visible; \}/);
});

test('the Search genres do not include LGBTQ+', () => {
  assert.ok(!SEARCH_GENRES.some(g => /lgbt|queer/i.test(`${g.label} ${g.query}`)));
});
