// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; } };

import { refreshEverything } from './refreshApp';
import { clearableCacheKeys } from './books/cache';
import { setNameChoice, nameChoiceOf } from './books/englishTitle';
import { makeBook } from './books/model';
import { routeFetch } from './store/testkit';

test('Refresh App & Data clears downloads and the app copy, and never your data or choices', async () => {
  routeFetch([]);
  const cacheNames = new Set(['rl-shell-abc', 'rl-img-v4', 'rl-api-v1']);
  let unregistered = 0;
  (globalThis as any).caches = { keys: async () => [...cacheNames], delete: async (n: string) => cacheNames.delete(n) };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true, serviceWorker: { getRegistrations: async () => [{ unregister: async () => { unregistered++; return true; } }] } } });

  // yours
  store.set('readlife.v2', '{"customBooks":[{"id":"1"}]}');
  const nb = makeBook({ id: 'a', title: 'Nettle & Bone', author: 'Ursula Vernon' });
  setNameChoice(nb, { author: 'Ursula Vernon' });
  // downloaded
  store.set('readlife.resolved3', '{"x":1}');
  store.set('readlife.englishTitles1', '{"x":1}');

  assert.equal(await refreshEverything(), true);
  assert.equal(store.get('readlife.v2'), '{"customBooks":[{"id":"1"}]}');
  assert.equal(nameChoiceOf(nb).author, 'Ursula Vernon', 'the owner\'s title/author choices stay');
  assert.equal(store.has('readlife.resolved3'), false);
  assert.equal(store.has('readlife.englishTitles1'), false);
  assert.equal(cacheNames.size, 0, 'the saved copy of the app is deleted');
  assert.equal(unregistered, 1);
  assert.equal(clearableCacheKeys().includes('readlife.nameChoices1'), false);
});

test('offline: nothing is deleted (the app could not download itself again)', async () => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  store.set('readlife.resolved3', '{"x":1}');
  const cacheNames = new Set(['rl-shell-abc']);
  (globalThis as any).caches = { keys: async () => [...cacheNames], delete: async (n: string) => cacheNames.delete(n) };
  assert.equal(await refreshEverything(), false);
  assert.equal(store.has('readlife.resolved3'), true);
  assert.equal(cacheNames.size, 1);
});
