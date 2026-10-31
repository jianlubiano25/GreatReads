import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { searchBooksLive, forgetRecentSearchesForTests } from './search';
import { forgetSeenForTests } from './localIndex';
import { flushPersistentCaches } from './cache';

const ol = (key: string, title: string) => ({ key: `/works/${key}`, title, author_name: ['J. K. Rowling'], first_publish_year: 1997, edition_count: 300 });

test('a finished search is kept: when every source fails later it still shows the last good answer, and shows it first', async () => {
  const real = globalThis.fetch;
  forgetRecentSearchesForTests(); forgetSeenForTests();
  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'https://example.test');
      const body = url.hostname === 'openlibrary.org' ? { numFound: 2, docs: [ol('OL1W', 'Harry Potter and the Philosopher\'s Stone'), ol('OL2W', 'Harry Potter and the Chamber of Secrets')] } : { totalItems: 0, items: [] };
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as typeof fetch;
    const first = await searchBooksLive('harry potter', { final: true });
    assert.ok(first.length >= 2);
    flushPersistentCaches();

    // a new session: every source rate-limited / down
    forgetSeenForTests(); // (the saved answer itself stays: it is what a new session finds)
    globalThis.fetch = (async () => ({ ok: false, status: 429, json: async () => null }) as Response) as typeof fetch;
    const froms: string[] = [];
    const again = await searchBooksLive('harry potter', { final: true, onUpdate: (_b, p) => froms.push(p.from) });
    assert.equal(froms[0], 'saved', 'the saved answer is shown first');
    assert.deepEqual(again.map(b => b.title), first.map(b => b.title), 'and it is the answer when all sources fail');
  } finally {
    globalThis.fetch = real;
  }
});

test('a search nobody ever answered stays empty (nothing invented)', async () => {
  const real = globalThis.fetch;
  try {
    forgetRecentSearchesForTests(); forgetSeenForTests();
    globalThis.fetch = (async () => ({ ok: false, status: 429, json: async () => null }) as Response) as typeof fetch;
    assert.deepEqual(await searchBooksLive('zzz never searched before', { final: true }), []);
  } finally {
    globalThis.fetch = real;
  }
});
