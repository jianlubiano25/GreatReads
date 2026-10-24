// Run with: npm test
// Two devices on one account against an in-memory copy of the personal tables.
import test from 'node:test';
import assert from 'node:assert/strict';
import { claimLibrarySyncAccount, hasLibrarySyncConflicts, loadRemoteLibrary, mergeRemoteLibrary, syncLocalLibraryDetailed } from './librarySync';
import { USER, blankState, installNetwork, makeDevice, makeServer, mkBook, useDevice } from './librarySync-testkit';

const books = [mkBook('b1', 'Piranesi'), mkBook('b2', 'Circe')];
const push = (state: any, ids: string[]) => syncLocalLibraryDetailed(USER, { state, books: books.filter(b => ids.includes(String(b.id))), collections: [], coverPicks: {} });
/** What the app does when a device signs in: pull, merge (this device's own values survive), push the merged copy. */
async function signIn(state: any, ids: string[]) {
  const remote = (await loadRemoteLibrary(USER))!;
  const merged = mergeRemoteLibrary(state, [], remote, {}, false);
  const sent = await syncLocalLibraryDetailed(USER, { state: merged.state, books: books.filter(b => ids.includes(String(b.id))), collections: merged.collections, coverPicks: merged.coverPicks });
  return { merged, sent };
}
const pull = async () => { const remote = (await loadRemoteLibrary(USER))!; return remote; };

test('a second device that already has its own library signs in without a conflict, and keeps receiving the first device\'s changes', async () => {
  const server = makeServer(); const restore = installNetwork(server);
  try {
    const phone = makeDevice(), pad = makeDevice();
    useDevice(phone); claimLibrarySyncAccount(USER);
    const p = blankState(); p.status.b1 = 'now'; p.currentPage.b1 = 40; p.profile.name = 'JL'; p.goal = 20; p.dailyLog['2026-10-20'] = 30; p.customBooks = [books[0]];
    assert.equal((await push(p, ['b1'])).ok, true);

    useDevice(pad); claimLibrarySyncAccount(USER);
    const d = blankState(); d.status.b2 = 'done'; d.currentPage.b2 = 300; d.dailyLog['2026-10-21'] = 15; d.customBooks = [books[1]];
    const { merged, sent } = await signIn(d, ['b2']);
    assert.equal(sent.ok, true);
    assert.equal(hasLibrarySyncConflicts(USER), false, 'no conflict is recorded');
    assert.equal(merged.state.profile.name, 'JL'); assert.equal(merged.state.goal, 20); assert.equal(merged.state.status.b1, 'now'); assert.equal(merged.state.status.b2, 'done');
    assert.deepEqual(Object.keys(merged.state.dailyLog).sort(), ['2026-10-20', '2026-10-21']);

    // the phone finishes its book; the pad must be able to receive it (the old code stopped applying cloud changes after the first conflict)
    useDevice(phone);
    p.status.b1 = 'done'; p.currentPage.b1 = 280;
    assert.equal((await push(p, ['b1'])).ok, true);
    useDevice(pad);
    const latest = await pull();
    const next = mergeRemoteLibrary(merged.state, [], latest, {}, true);
    assert.equal(next.state.status.b1, 'done'); assert.equal(next.state.currentPage.b1, 280);
    assert.equal(hasLibrarySyncConflicts(USER), false);
    // and the pad's own copy of its own book reached the cloud, so the phone sees it too
    assert.ok(latest.books.some(r => r.local_book_id === 'b2' && r.status === 'done'));
  } finally { restore(); }
});

test('a row another device changed is not overwritten by a device that did not change it', async () => {
  const server = makeServer(); const restore = installNetwork(server);
  try {
    const phone = makeDevice(), pad = makeDevice();
    useDevice(phone); claimLibrarySyncAccount(USER);
    const p = blankState(); p.status.b1 = 'now'; p.currentPage.b1 = 10; p.customBooks = [books[0]];
    await push(p, ['b1']);
    useDevice(pad); claimLibrarySyncAccount(USER);
    const d = blankState();
    const first = await signIn(d, ['b1']);           // pad receives the book
    assert.equal(first.merged.state.status.b1, 'now');
    // the phone moves on
    useDevice(phone); p.status.b1 = 'done'; p.currentPage.b1 = 200; await push(p, ['b1']);
    // the pad has NOT changed anything; a sync from it (foreground, timer...) must leave the phone's newer values alone
    useDevice(pad);
    const res = await syncLocalLibraryDetailed(USER, { state: first.merged.state, books: [books[0]], collections: [], coverPicks: {} });
    assert.equal(res.ok, true); assert.equal(res.stale, true, 'the pad is told the cloud has newer values to pull');
    const row = server.tables.get('user_library_books')!.find(r => r.local_book_id === 'b1');
    assert.equal(row.status, 'done'); assert.equal(row.reading_progress.currentPage, 200);
    // pulling brings the pad up to date, and then it is level with the cloud
    const pulled = mergeRemoteLibrary(first.merged.state, [], await pull(), {}, true);
    assert.equal(pulled.state.status.b1, 'done');
    const again = await syncLocalLibraryDetailed(USER, { state: pulled.state, books: [books[0]], collections: [], coverPicks: {} });
    assert.equal(again.ok, true); assert.equal(again.stale, false);
  } finally { restore(); }
});

test('when both devices changed the same row, this device\'s values are written (never a permanent block) and syncing carries on', async () => {
  const server = makeServer(); const restore = installNetwork(server);
  try {
    const phone = makeDevice(), pad = makeDevice();
    useDevice(phone); claimLibrarySyncAccount(USER);
    const p = blankState(); p.status.b1 = 'now'; p.currentPage.b1 = 10; p.customBooks = [books[0]];
    await push(p, ['b1']);
    useDevice(pad); claimLibrarySyncAccount(USER);
    const first = await signIn(blankState(), ['b1']);
    useDevice(phone); p.currentPage.b1 = 100; await push(p, ['b1']);
    useDevice(pad);
    const d = first.merged.state; d.currentPage.b1 = 55; d.notes.b1 = 'from the pad';
    const res = await syncLocalLibraryDetailed(USER, { state: d, books: [books[0]], collections: [], coverPicks: {} });
    assert.equal(res.ok, true); assert.equal(hasLibrarySyncConflicts(USER), false);
    const row = server.tables.get('user_library_books')!.find(r => r.local_book_id === 'b1');
    assert.equal(row.reading_progress.currentPage, 55, 'this device\'s edit is written');
    // a later edit still goes through
    d.currentPage.b1 = 70;
    assert.equal((await syncLocalLibraryDetailed(USER, { state: d, books: [books[0]], collections: [], coverPicks: {} })).ok, true);
    assert.equal(server.tables.get('user_library_books')!.find(r => r.local_book_id === 'b1').reading_progress.currentPage, 70);
  } finally { restore(); }
});

test('when both devices changed the same row and the cloud copy was saved AFTER this device began its change, the newer cloud value is kept and pulled', async () => {
  const server = makeServer(); const restore = installNetwork(server);
  try {
    const phone = makeDevice(), pad = makeDevice();
    useDevice(phone); claimLibrarySyncAccount(USER);
    const p = blankState(); p.status.b1 = 'now'; p.currentPage.b1 = 10; p.customBooks = [books[0]];
    await push(p, ['b1']);
    useDevice(pad); claimLibrarySyncAccount(USER);
    const first = await signIn(blankState(), ['b1']);
    const d = first.merged.state;
    // the pad edits while offline (the change is stamped when it is made) ...
    pad.storage.set('readlife.librarySyncPending1.' + encodeURIComponent(USER), String(Date.now() - 10 * 60_000));
    d.currentPage.b1 = 55;
    // ... and the phone saved afterwards
    useDevice(phone); server.setClock(Date.now() - 60_000); p.currentPage.b1 = 100; p.status.b1 = 'done'; await push(p, ['b1']);
    useDevice(pad);
    const res = await syncLocalLibraryDetailed(USER, { state: d, books: [books[0]], collections: [], coverPicks: {} });
    assert.equal(res.ok, true); assert.equal(res.stale, true);
    assert.equal(server.tables.get('user_library_books')!.find(r => r.local_book_id === 'b1').reading_progress.currentPage, 100, 'the phone\'s later save is not overwritten');
    const pulled = mergeRemoteLibrary(d, [], await pull(), {}, true);
    assert.equal(pulled.state.currentPage.b1, 100); assert.equal(pulled.state.status.b1, 'done');
  } finally { restore(); }
});
