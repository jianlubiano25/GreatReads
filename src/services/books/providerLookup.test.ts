import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureProviderFacts, forgetProviderLookupsForTests, lookupBudgetLeft, LOOKUP_BOOKS_PER_PAGE_LOAD, missingProviders } from './providerLookup';
import { forgetProviderFactsForTests, rememberProviderFacts } from './providerFacts';

const deps = (log: string[], failOn = '') => ({
  google: async () => { log.push('google'); if (failOn === 'google') throw new Error('429'); },
  apple: async () => { log.push('apple'); },
  openlibrary: async () => { log.push('openlibrary'); },
  hardcover: async () => { log.push('hardcover'); },
});

test('a book with no provider facts is asked once per provider, one at a time; a second request in the session asks nothing', async () => {
  forgetProviderLookupsForTests(); forgetProviderFactsForTests();
  const log: string[] = [];
  const book = { id: 'x1', title: 'Dune', author: 'Frank Herbert' };
  assert.deepEqual(await ensureProviderFacts(book, deps(log)), ['google', 'apple', 'openlibrary', 'hardcover']);
  assert.deepEqual(log, ['google', 'apple', 'openlibrary', 'hardcover']);
  assert.deepEqual(await ensureProviderFacts(book, deps(log)), []);
  assert.equal(log.length, 4);
});

test('a provider that already has facts is not asked again; one that fails does not stop the others', async () => {
  forgetProviderLookupsForTests(); forgetProviderFactsForTests();
  rememberProviderFacts({ provider: 'google', recordId: 'abcDEF123', authors: ['A'] });
  const book = { id: 'abcDEF123', title: 'Emma', author: 'Jane Austen', identity: { gbVolume: 'abcDEF123' } };
  assert.deepEqual(missingProviders(book), ['apple', 'openlibrary', 'hardcover']);
  const log: string[] = [];
  await ensureProviderFacts(book, { ...deps(log), apple: async () => { throw new Error('timeout'); } });
  assert.deepEqual(log, ['openlibrary', 'hardcover']);
  forgetProviderFactsForTests();
});

test('a book without a title is never looked up', async () => {
  forgetProviderLookupsForTests();
  assert.deepEqual(await ensureProviderFacts({ title: '  ' }, deps([])), []);
});

test('background look-ups stop after the page-load budget; Save to catalog on one book is never refused for it', async () => {
  forgetProviderLookupsForTests(); forgetProviderFactsForTests();
  for (let i = 0; i < LOOKUP_BOOKS_PER_PAGE_LOAD; i++) await ensureProviderFacts({ id: `b${i}`, title: `Book ${i}`, author: 'A' }, deps([]));
  assert.equal(lookupBudgetLeft(), false);
  const log: string[] = [];
  assert.deepEqual(await ensureProviderFacts({ id: 'late', title: 'One more', author: 'A' }, deps(log)), [], 'background: budget used up');
  assert.deepEqual(log, []);
  assert.equal((await ensureProviderFacts({ id: 'late', title: 'One more', author: 'A' }, deps(log), { force: true })).length, 4, 'owner pressed Save to catalog');
  forgetProviderLookupsForTests();
});
