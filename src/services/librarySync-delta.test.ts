// Run with: npm test
// Reading the cloud copy: one full read, then only what changed; counted against an in-memory copy of the tables.
import test from 'node:test';
import assert from 'node:assert/strict';
import { claimLibrarySyncAccount, forgetRemoteLibraryCache, loadRemoteLibrary, syncLocalLibraryDetailed } from './librarySync';
import { USER, blankState, installNetwork, makeDevice, makeServer, mkBook, useDevice } from './librarySync-testkit';

const gets = (server: ReturnType<typeof makeServer>) => server.requests.filter(r => r.startsWith('GET')).length;
const writes = (server: ReturnType<typeof makeServer>) => server.requests.filter(r => !r.startsWith('GET')).length;
async function seeded(count = 30) {
  const server = makeServer(); const restore = installNetwork(server);
  const phone = makeDevice(); useDevice(phone, () => forgetRemoteLibraryCache()); claimLibrarySyncAccount(USER);
  const state = blankState(); const books = Array.from({ length: count }, (_, i) => mkBook(`b${i}`, `Book ${i}`));
  state.customBooks = books; books.forEach(b => { state.status[String(b.id)] = 'now'; state.currentPage[String(b.id)] = 5; });
  assert.equal((await syncLocalLibraryDetailed(USER, { state, books, collections: [], coverPicks: {} })).ok, true);
  forgetRemoteLibraryCache(); server.reset();
  return { server, restore, state, books };
}

test('the first read is complete; the next reads fetch only rows changed since, and the snapshot stays complete', async () => {
  const { server, restore, state, books } = await seeded();
  try {
    const first = (await loadRemoteLibrary(USER))!;
    assert.equal(first.books.length, 30); assert.equal(gets(server), 6, 'books, notes, shelves, shelf entries, preferences, sessions');
    server.reset();
    const none = (await loadRemoteLibrary(USER))!;
    assert.equal(none.books.length, 30);
    assert.equal(gets(server), 5, 'five small reads (sessions are not re-read)'); assert.ok(Object.values(server.rows).every(n => n <= 1), `at most the newest row of each table is read again: ${JSON.stringify(server.rows)}`);
    // another device changes one book
    server.setClock(Date.now());
    await fetch('https://x.test/rest/v1/user_library_books?user_id=eq.' + USER + '&local_book_id=eq.b7&revision=eq.1', { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
    server.reset();
    const after = (await loadRemoteLibrary(USER))!;
    assert.equal(after.books.length, 30, 'unchanged books are still in the snapshot');
    assert.equal(after.books.find(r => r.local_book_id === 'b7')!.status, 'done');
    assert.ok((server.rows.user_library_books || 0) <= 2, `fetched ${server.rows.user_library_books} book rows, not 30`);
  } finally { restore(); }
});

test('a warm snapshot needs no request at all, and an edit costs only the write', async () => {
  const { server, restore, state, books } = await seeded();
  try {
    await loadRemoteLibrary(USER); server.reset();
    assert.equal((await loadRemoteLibrary(USER, { maxAgeMs: 30_000 }))!.books.length, 30); assert.equal(server.requests.length, 0);
    state.currentPage.b3 = 90;
    const res = await syncLocalLibraryDetailed(USER, { state, books, collections: [], coverPicks: {} }, { maxAgeMs: 30_000 });
    assert.equal(res.ok, true);
    assert.equal(gets(server), 0, 'no reads'); assert.equal(writes(server), 1, 'one write: ' + server.requests.join(' | '));
    // our own write is already in the snapshot, so the next edit does not trip over a stale revision
    server.reset(); state.currentPage.b3 = 120;
    assert.equal((await syncLocalLibraryDetailed(USER, { state, books, collections: [], coverPicks: {} }, { maxAgeMs: 30_000 })).ok, true);
    assert.equal(gets(server), 0); assert.equal(writes(server), 1);
    assert.equal(server.tables.get('user_library_books')!.find(r => r.local_book_id === 'b3').reading_progress.currentPage, 120);
  } finally { restore(); }
});

test('a pull can be limited to the tables that changed', async () => {
  const { server, restore } = await seeded();
  try {
    await loadRemoteLibrary(USER); server.reset();
    await loadRemoteLibrary(USER, { tables: ['user_library_preferences'] });
    assert.deepEqual(server.requests, ['GET user_library_preferences']);
  } finally { restore(); }
});

test('removed rows arrive as removal markers and stay in the snapshot; a full re-read drops rows deleted outright', async () => {
  const { server, restore } = await seeded(5);
  try {
    await loadRemoteLibrary(USER); server.setClock(Date.now());
    await fetch('https://x.test/rest/v1/user_library_books?user_id=eq.' + USER + '&local_book_id=eq.b1&revision=eq.1', { method: 'PATCH', body: JSON.stringify({ deleted_at: '2026-10-24T00:00:00Z' }) });
    const soft = (await loadRemoteLibrary(USER))!;
    assert.ok(soft.books.find(r => r.local_book_id === 'b1')!.deleted_at);
    server.tables.set('user_library_books', server.tables.get('user_library_books')!.filter(r => r.local_book_id !== 'b2')); // a row removed outright is invisible to "changed since"
    assert.ok((await loadRemoteLibrary(USER))!.books.some(r => r.local_book_id === 'b2'));
    assert.ok(!(await loadRemoteLibrary(USER, { full: true }))!.books.some(r => r.local_book_id === 'b2'));
  } finally { restore(); }
});

test('a failed or partial read never replaces what is known; the next read starts again from a full read', async () => {
  const { server, restore } = await seeded(5);
  try {
    const good = (await loadRemoteLibrary(USER))!; assert.equal(good.books.length, 5);
    server.failTable('user_shelves');
    assert.equal(await loadRemoteLibrary(USER), null);
    server.failTable(null); server.reset();
    const again = (await loadRemoteLibrary(USER))!;
    assert.equal(again.books.length, 5); assert.equal(gets(server), 6, 'a full read');
  } finally { restore(); }
});
