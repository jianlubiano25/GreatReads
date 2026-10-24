// Run with: npm test
// When this device sends and when it reads, with fake timers and an in-memory copy of the cloud tables.
import test from 'node:test';
import assert from 'node:assert/strict';
import { claimLibrarySyncAccount, forgetRemoteLibraryCache, hasPendingLibrarySync, loadRemoteLibrary, syncLocalLibraryDetailed, type RemoteLibrarySnapshot } from './librarySync';
import { createLibrarySyncController } from './librarySyncController';
import { USER, blankState, installNetwork, makeDevice, makeServer, mkBook, useDevice } from './librarySync-testkit';

/** A clock the test moves by hand. */
function clock() {
  let t = Date.now(); let seq = 0; const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t, setTimer: (fn: () => void, ms: number) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; }, clearTimer: (h: unknown) => void timers.delete(h as number),
    pending: () => [...timers.values()].map(x => x.at - t).sort((a, b) => a - b),
    async advance(ms: number, idle: () => Promise<void>) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); t = Math.max(t, due[1].at); due[1].fn(); await idle(); await new Promise(r => setImmediate(r)); await idle();
      }
      t = end;
    },
  };
}
const books = [mkBook('b1', 'Piranesi'), mkBook('b2', 'Circe')];

async function setup() {
  const server = makeServer(); const restore = installNetwork(server);
  const phone = makeDevice(); useDevice(phone); claimLibrarySyncAccount(USER);
  const state = blankState(); state.customBooks = [...books]; state.status.b1 = 'now'; state.currentPage.b1 = 10;
  const args = { state, books, collections: [], coverPicks: {} };
  assert.equal((await syncLocalLibraryDetailed(USER, args)).ok, true);
  const applied: RemoteLibrarySnapshot[] = []; const c = clock(); let online = true;
  const ctl = createLibrarySyncController({ userId: USER, getArgs: () => args, applyRemote: r => void applied.push(r), now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer, online: () => online });
  server.reset();
  return { server, restore, state, args, applied, c, ctl, setOnline: (v: boolean) => { online = v; }, phone };
}
const otherDeviceSaves = async (server: ReturnType<typeof makeServer>, local: string, patch: Record<string, unknown>) => {
  server.setClock(Date.now());
  const row = server.tables.get('user_library_books')!.find(r => r.local_book_id === local);
  await fetch(`https://x.test/rest/v1/user_library_books?user_id=eq.${USER}&local_book_id=eq.${local}&revision=eq.${row.revision}`, { method: 'PATCH', body: JSON.stringify(patch) });
};

test('a burst of cloud events is one read of the named tables, and the change is applied', async () => {
  const { server, restore, applied, c, ctl } = await setup();
  try {
    await otherDeviceSaves(server, 'b1', { status: 'done' }); server.reset();
    for (let i = 0; i < 12; i++) ctl.realtime('user_library_books');
    await c.advance(1000, ctl.whenIdle);
    assert.deepEqual(server.requests.filter(r => r.startsWith('GET')), ['GET user_library_books'], 'one read, one table');
    assert.equal(applied.length, 1); assert.equal(applied[0].books.find(r => r.local_book_id === 'b1')!.status, 'done');
  } finally { restore(); ctl.dispose(); }
});

test('an edit is sent after a short pause with no reads, and the cloud is not read back', async () => {
  const { server, restore, state, applied, c, ctl } = await setup();
  try {
    await loadRemoteLibrary(USER); server.reset();
    state.currentPage.b1 = 60; ctl.edited(); ctl.edited(); state.currentPage.b1 = 80; ctl.edited();
    assert.equal(hasPendingLibrarySync(USER), true, 'marked the moment it happened');
    await c.advance(400, ctl.whenIdle); assert.equal(server.requests.length, 0, 'still waiting for the pause');
    await c.advance(300, ctl.whenIdle);
    assert.deepEqual(server.requests, ['PATCH user_library_books']);
    assert.equal(server.tables.get('user_library_books')!.find(r => r.local_book_id === 'b1').reading_progress.currentPage, 80);
    assert.equal(hasPendingLibrarySync(USER), false); assert.equal(applied.length, 0);
  } finally { restore(); ctl.dispose(); }
});

test('what the person changes while the cloud is being read is sent first, and the cloud copy is applied after, never over it', async () => {
  const { server, restore, state, applied, c, ctl } = await setup();
  try {
    await otherDeviceSaves(server, 'b2', { status: 'next' });
    const realFetch = globalThis.fetch; let edited = false;
    globalThis.fetch = (async (input: any, init?: RequestInit) => { const res = await realFetch(input, init); if (!edited && String(input).includes('user_shelves')) { edited = true; state.currentPage.b1 = 150; ctl.edited(); } return res; }) as typeof fetch;
    ctl.realtime('user_library_books'); ctl.realtime('user_shelves');
    await c.advance(2000, ctl.whenIdle);
    globalThis.fetch = realFetch;
    assert.equal(server.tables.get('user_library_books')!.find(r => r.local_book_id === 'b1').reading_progress.currentPage, 150, 'the edit reached the cloud');
    assert.ok(applied.length >= 1); assert.equal(applied[applied.length - 1].books.find(r => r.local_book_id === 'b1')!.reading_progress.currentPage, 150, 'only a copy that includes the edit was applied');
  } finally { restore(); ctl.dispose(); }
});

test('coming back to the app reads the cloud, but not more often than every 15 seconds; a reconnection reads unless the cloud was read a moment ago', async () => {
  const { server, restore, applied, c, ctl } = await setup();
  try {
    ctl.resume(); await c.advance(10, ctl.whenIdle); const first = server.requests.filter(r => r.startsWith('GET')).length;
    assert.ok(first >= 5, 'a read of every table'); server.reset();
    ctl.resume(); await c.advance(5000, ctl.whenIdle); assert.equal(server.requests.length, 0, 'too soon');
    await c.advance(11_000, ctl.whenIdle); ctl.resume(); await c.advance(10, ctl.whenIdle); assert.ok(server.requests.length >= 5, 'after 15 s: reads again');
    server.reset(); ctl.connected(); await c.advance(10, ctl.whenIdle); assert.equal(server.requests.length, 0, 'the cloud was read a moment ago');
    await c.advance(5000, ctl.whenIdle); ctl.connected(); await c.advance(10, ctl.whenIdle); assert.ok(server.requests.length >= 5, 'a (re)connection catches up');
  } finally { restore(); ctl.dispose(); }
});

test('offline nothing is attempted and nothing retries; coming back online carries on', async () => {
  const { server, restore, state, c, ctl, setOnline } = await setup();
  try {
    setOnline(false); state.currentPage.b1 = 99; ctl.edited(); await c.advance(60_000, ctl.whenIdle);
    assert.equal(server.requests.length, 0); assert.deepEqual(c.pending(), [], 'no retry timer is left running while offline');
    setOnline(true); ctl.resume(); await c.advance(10, ctl.whenIdle);
    assert.equal(server.tables.get('user_library_books')!.find(r => r.local_book_id === 'b1').reading_progress.currentPage, 99);
  } finally { restore(); ctl.dispose(); }
});

test('a failing cloud is retried with growing gaps, not in a loop', async () => {
  const { server, restore, state, c, ctl } = await setup();
  try {
    server.failTable('user_library_books'); state.currentPage.b1 = 31; ctl.edited();
    const gaps: number[] = [];
    for (let i = 0; i < 5; i++) { await c.advance(500 + (i ? 0 : 0), ctl.whenIdle); const p = c.pending(); if (p.length) gaps.push(p[0]); await c.advance(p.length ? p[0] : 1, ctl.whenIdle); }
    assert.ok(server.requests.length < 40, `requests: ${server.requests.length}`);
    assert.ok(gaps.length >= 2 && gaps[1] > gaps[0], `gaps grow: ${gaps.join(', ')}`);
    server.failTable(null); await c.advance(120_000, ctl.whenIdle);
    assert.equal(hasPendingLibrarySync(USER), false); assert.equal(server.tables.get('user_library_books')!.find(r => r.local_book_id === 'b1').reading_progress.currentPage, 31);
  } finally { restore(); ctl.dispose(); }
});

test('a send that finds newer cloud values pulls them without waiting for an event', async () => {
  const { server, restore, state, applied, c, ctl } = await setup();
  try {
    await otherDeviceSaves(server, 'b2', { status: 'done' });
    forgetRemoteLibraryCache(); // this device's picture of the cloud is out of date (e.g. the app was in the background)
    state.currentPage.b1 = 44; ctl.edited(); server.reset();
    await c.advance(700, ctl.whenIdle);
    assert.ok(applied.length >= 1, 'the cloud copy was pulled and applied');
    assert.equal(applied[applied.length - 1].books.find(r => r.local_book_id === 'b2')!.status, 'done');
  } finally { restore(); ctl.dispose(); }
});
