// Run with: npm test
// Developer mode: your own Google Books key, pasted in Profile, kept on this device only. With it the browser calls Google directly; without it, the proxy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };

import { searchGoogle, findGoogleRating, checkGoogleBooks, setOwnGoogleKey, hasOwnGoogleKey, looksLikeGoogleKey, setBrowserForTests, setGoogleModeForTests, resetGoogleKeyForTests } from './sources/googleBooks';
import { routeFetch } from '../store/testkit';

const OWN = 'AIzaSyOWN-KEY-for-tests_1234567890abc';
const google = (u: URL) => u.hostname === 'www.googleapis.com';
const proxy = (u: URL) => u.pathname === '/api/google-books';
const gbItem = (id: string, title: string, author: string, extra: any = {}) => ({ id, volumeInfo: { title, authors: [author], publishedDate: '1965', pageCount: 412, ...extra } });

const browser = async (fn: () => Promise<void>) => {
  mem.clear();
  resetGoogleKeyForTests();
  setGoogleModeForTests(null);
  setBrowserForTests(true);
  try { await fn(); } finally { setBrowserForTests(null); mem.clear(); resetGoogleKeyForTests(); }
};

test('a pasted key must look like a Google key; nothing odd is stored; an empty value removes it', () => {
  mem.clear();
  for (const bad of ['', 'short', 'has spaces in it and is long enough yes', 'https://x.test/?key=abcdefghijklmnopqrstuvwxyz']) assert.equal(looksLikeGoogleKey(bad), false, bad);
  assert.equal(setOwnGoogleKey('not a key at all!!'), false);
  assert.equal(hasOwnGoogleKey(), false);
  assert.equal(setOwnGoogleKey(`  ${OWN}  `), true); // pasted with spaces around it
  assert.equal(hasOwnGoogleKey(), true);
  assert.equal([...mem.values()].includes(OWN), true);
  assert.equal(setOwnGoogleKey(''), true);
  assert.equal(hasOwnGoogleKey(), false);
  assert.equal(mem.size, 0);
});

test('browser without an own key: the proxy, no key anywhere', () => browser(async () => {
  const calls = routeFetch([u => (proxy(u) ? { body: { items: [] } } : undefined)]);
  await searchGoogle('intitle:"Dune"', 2);
  assert.ok(calls[0].startsWith('/api/google-books?') && !calls[0].includes('key='));
}));

test('browser with an own key: Google is called directly with it and the proxy is not used', () => browser(async () => {
  setOwnGoogleKey(OWN);
  const calls = routeFetch([u => (google(u) ? { body: { items: [] } } : undefined)]);
  await searchGoogle('intitle:"Dune"', 2);
  assert.equal(calls.length, 1);
  const u = new URL(calls[0]);
  assert.equal(u.hostname, 'www.googleapis.com');
  assert.equal(u.searchParams.get('key'), OWN);
  assert.equal(u.searchParams.get('q'), 'intitle:"Dune"');
  // removing the key sends the next request back through the proxy
  setOwnGoogleKey('');
  const after = routeFetch([u2 => (proxy(u2) ? { body: { items: [] } } : undefined)]);
  await searchGoogle('intitle:"Dune"', 2);
  assert.ok(after[0].startsWith('/api/google-books?'));
}));

test('browser: an own key Google refuses is dropped for the session, the request still gets its answer, later requests use the proxy, and the key is never logged', () => browser(async () => {
  setOwnGoogleKey(OWN);
  const warn = (console as any).warn;
  const logged: unknown[][] = [];
  (console as any).warn = (...a: unknown[]) => void logged.push(a);
  try {
    const first = routeFetch([u => (google(u) ? (u.searchParams.has('key') ? { status: 403, body: { error: { errors: [{ reason: 'ipRefererBlocked' }] } } } : { body: { items: [gbItem('g1', 'Own Alpha', 'Jo Author', { averageRating: 4.1, ratingsCount: 50 })] } }) : undefined)]);
    const r = await findGoogleRating({ title: 'Own Alpha', author: 'Jo Author' });
    assert.deepEqual([r.hit?.book.ratingAverage, r.hit?.book.ratingCount, r.failed], [4.1, 50, false]);
    assert.equal(first.length, 2); // refused with the key, answered without
    const next = routeFetch([u => (proxy(u) ? { body: { items: [] } } : undefined)]);
    await findGoogleRating({ title: 'Own Beta', author: 'Jo Author' });
    assert.ok(next.length > 0 && next.every(c => c.startsWith('/api/google-books?') && !c.includes('key=')), 'afterwards the proxy takes over');
    assert.ok(!JSON.stringify(logged).includes(OWN));
    // saving a key again forgets the refusal and tries Google directly
    setOwnGoogleKey(OWN.replace('OWN', 'NEW'));
    const again = routeFetch([u => (google(u) ? { body: { items: [] } } : undefined)]);
    await searchGoogle('intitle:"Dune"', 2);
    assert.equal(new URL(again[0]).hostname, 'www.googleapis.com');
  } finally {
    (console as any).warn = warn;
  }
}));

test('Test: reports success, and says in words why a refusal happened (never the key); each test is a request nobody made before', () => browser(async () => {
  setOwnGoogleKey(OWN);
  const urls = new Set<string>();
  const ok = routeFetch([u => (google(u) ? { body: { totalItems: 12 } } : undefined)]);
  for (let i = 0; i < 12; i++) await checkGoogleBooks();
  ok.forEach(c => urls.add(c));
  assert.ok(urls.size > 3, 'a varying startIndex avoids the service worker\'s 12-hour copy');
  routeFetch([u => (google(u) ? { body: { totalItems: 12 } } : undefined)]);
  const good = await checkGoogleBooks();
  assert.deepEqual([good.route, good.ok], ['own key', true]);

  routeFetch([u => (google(u) ? { status: 403, body: { error: { message: `blocked ${OWN}`, errors: [{ reason: 'ipRefererBlocked' }] } } } : undefined)]);
  const blocked = await checkGoogleBooks();
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /restrict it by API/);
  assert.ok(!JSON.stringify(blocked).includes(OWN) && !blocked.message.includes('blocked '));

  setOwnGoogleKey('');
  routeFetch([u => (proxy(u) ? { status: 503, body: { error: 'not_configured' } } : undefined)]);
  const server = await checkGoogleBooks();
  assert.deepEqual([server.route, server.ok, server.status], ['server', false, 503]);
  assert.match(server.message, /GOOGLE_BOOKS_API_KEY/);

  routeFetch([u => (proxy(u) ? { status: 502, body: { error: 'upstream_error', upstream: 403, reason: 'keyInvalid' } } : undefined)]);
  assert.match((await checkGoogleBooks()).message, /does not accept this key/);
  routeFetch([() => ({ throws: true })]);
  assert.match((await checkGoogleBooks()).message, /network/i);
}));

test('the key field is only rendered while developer mode is on, and the key stays out of backups', () => {
  const profile = fs.readFileSync(new URL('../../components/ProfileModal.tsx', import.meta.url), 'utf8');
  assert.match(profile, /\{devMode && <GoogleKeyPanel \/>\}/);
  assert.equal((profile.match(/<GoogleKeyPanel/g) || []).length, 1, 'rendered once, only behind devMode');
  const hook = fs.readFileSync(new URL('../../hooks/useReadingLife.ts', import.meta.url), 'utf8');
  assert.ok(!/googleKey|OWN_KEY|readlife\.googleKey/.test(hook.slice(hook.indexOf('const exportBackup'), hook.indexOf('const importBackup'))), 'exportBackup does not include it');
});
