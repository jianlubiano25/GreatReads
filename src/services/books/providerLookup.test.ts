import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureProviderFacts, forgetProviderLookupsForTests, missingProviders } from './providerLookup';
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
