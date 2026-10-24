/**
 * Phase 0 safety net for cross-device sync (no production code changes).
 *
 * - Plain `test(...)` = behaviour that works TODAY and must keep working (regression guards).
 * - `defect(...)`    = the behaviour we WANT, which fails TODAY. They are marked `todo`, so `npm test` stays green while
 *                      still printing each failure. A later phase flips its tests to plain `test(...)` once it is fixed.
 *
 * Everything here runs against an in-memory fake of the Supabase REST API and two fake devices (separate localStorage).
 * It is a simulation: it does NOT replace testing on real devices against the real project.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ReadingState } from '../types';
import { hasLibrarySyncConflicts, hasPendingLibrarySync, loadRemoteLibrary, mergeRemoteLibrary, pausedLibraryKeys, resolveLibraryConflictsToCloud, resolveLibraryConflictsToLocal, syncLocalLibrary, type RemoteLibrarySnapshot } from './librarySync';
import { mergePreferencesFirstSync } from './librarySyncMerge';

const defect = (name: string, fn: () => Promise<void> | void) => test(name, { todo: 'known sync defect (see sync audit)' }, fn);

const USER = 'user-1';
const TABLES = ['user_library_books', 'user_book_annotations', 'user_shelves', 'user_shelf_books', 'user_reading_sessions', 'user_library_preferences'];

const blank = (): ReadingState => ({
  status: {}, currentPage: {}, totalPages: {}, dailyLog: {}, notes: {}, highlights: {}, goal: 10, readingIntention: '',
  profile: { name: '', photo: '', theme: 'auto' }, customBooks: [], onDeviceOverrides: {}, hiddenBookIds: {}, words: [],
  garden: { v: 1, peaks: { bestStreak: 0, tenPageDays: 0, maxPagesInDay: 0, bestWeekGoalDays: 0, booksFinished: 0, totalPages: 0, highlights: 0, wordsAdded: 0, wordsLearned: 0 }, achievements: {}, plants: {}, placements: {}, celebrated: {}, vine: 0 },
  history: {}, ratings: {},
});
const word = (id: string, learned = false) => ({ id, word: id, definition: 'd', isLearned: learned, addedAt: 1 });
const book = (id: string) => ({ id, title: `Book ${id}`, author: 'A', shelf: 'mine' as const, difficulty: 0, isOnDevice: false, year: '', genre: '', summary: '', authorBio: '', pageCount: 100 });

/** A fake cloud plus any number of fake devices that share it. Restores the globals it replaces. */
function world() {
  const tables = new Map<string, Record<string, any>[]>(TABLES.map(n => [n, []]));
  const realFetch = globalThis.fetch;
  const realStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const eq = (url: URL, key: string) => url.searchParams.get(key)?.replace(/^eq\./, '');
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input)); const table = url.pathname.split('/').pop()!; const method = init.method || 'GET';
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    const rows = tables.get(table);
    if (!rows) return reply({ message: 'unknown table' }, 404);
    if (method === 'GET') return reply(rows.filter(r => r.user_id === eq(url, 'user_id')));
    const payload = init.body ? JSON.parse(String(init.body)) : {};
    if (method === 'POST') { const row = { ...payload, id: payload.id || crypto.randomUUID(), revision: payload.revision || 1 }; rows.push(row); return reply([row], 201); }
    if (method === 'PATCH') {
      const row = rows.find(r => r.user_id === eq(url, 'user_id')
        && (!url.searchParams.has('local_book_id') || r.local_book_id === eq(url, 'local_book_id'))
        && (!url.searchParams.has('id') || r.id === eq(url, 'id'))
        && r.revision === Number(eq(url, 'revision')));
      if (!row) return reply([]);
      Object.assign(row, payload); return reply([row]);
    }
    return reply({}, 404);
  }) as typeof fetch;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });

  const device = () => {
    const m = new Map<string, string>([['readlife.sb1', JSON.stringify({ access: 'a', refresh: 'r', exp: Date.now() + 3.6e6, user: { id: USER } })]]);
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; } };
    const use = () => Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    /** What the app does on open: pull the cloud copy, merge it into local, then push. */
    const open = async (state: ReadingState, books: any[] = []) => {
      use();
      const remote = await loadRemoteLibrary(USER);
      const merged = remote ? mergeRemoteLibrary(state, [], remote, {}, false).state : state;
      const ok = await syncLocalLibrary(USER, { state: merged, books, collections: [], coverPicks: {} });
      return { state: merged, ok };
    };
    /** What the app does after a local edit: push, then take the cloud copy back. Records paused by a conflict are left alone; the rest keep refreshing. */
    const edit = async (state: ReadingState, books: any[] = []) => {
      use();
      const ok = await syncLocalLibrary(USER, { state, books, collections: [], coverPicks: {} });
      let after = state;
      if (ok) { const remote = await loadRemoteLibrary(USER); if (remote) after = mergeRemoteLibrary(state, [], remote, {}, true, pausedLibraryKeys(USER)).state; }
      return { state: after, ok };
    };
    const conflicts = () => { use(); return hasLibrarySyncConflicts(USER); };
    const paused = () => { use(); return [...pausedLibraryKeys(USER)].sort(); };
    const pending = () => { use(); return hasPendingLibrarySync(USER); };
    /** "Use cloud": push unconflicted edits, accept the cloud copy of the paused records, apply it here. */
    const useCloud = async (state: ReadingState, books: any[] = []) => {
      use();
      await syncLocalLibrary(USER, { state, books, collections: [], coverPicks: {} });
      const remote = await loadRemoteLibrary(USER);
      resolveLibraryConflictsToCloud(USER, remote!);
      return mergeRemoteLibrary(state, [], remote!, {}, true).state;
    };
    const useDevice = () => { use(); resolveLibraryConflictsToLocal(USER); };
    return { open, edit, conflicts, paused, pending, useCloud, useDevice };
  };
  const prefs = () => tables.get('user_library_preferences')![0]?.preferences as any;
  const setOnline = (onLine: boolean) => Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine } });
  const done = () => {
    globalThis.fetch = realFetch;
    if (realStorage) Object.defineProperty(globalThis, 'localStorage', realStorage); else delete (globalThis as any).localStorage;
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
  };
  return { device, prefs, tables, setOnline, done };
}

/* ---------- regression guards: these work today and must keep working ---------- */

test('guard: a day lowered on the same device stays lowered after a push and refresh', async () => {
  const w = world();
  try {
    const a = w.device();
    let s = blank(); s.dailyLog = { '2026-10-20': 10 };
    s = (await a.open(s)).state;
    s = { ...s, dailyLog: { '2026-10-20': 6 } };
    s = (await a.edit(s)).state;
    assert.equal(s.dailyLog['2026-10-20'], 6);
    assert.equal(w.prefs().dailyLog['2026-10-20'], 6);
  } finally { w.done(); }
});

test('guard: a device that is the only writer keeps all of its data across push and refresh', async () => {
  const w = world();
  try {
    const a = w.device();
    let s = blank(); s.words = [word('w1')]; s.goal = 12; s.readingIntention = 'read daily'; s.profile = { name: 'Reader', photo: '', theme: 'dark' };
    s = (await a.open(s)).state;
    s = (await a.edit({ ...s, words: [...s.words, word('w2')] })).state;
    assert.deepEqual(s.words.map(x => x.id).sort(), ['w1', 'w2']);
    assert.equal(w.prefs().profile.name, 'Reader');
    assert.equal(w.prefs().goal, 12);
  } finally { w.done(); }
});

/* ---------- known defects: desired behaviour, failing today ---------- */

test('second device first sync does not pause its own edits as a conflict', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const sa = blank(); sa.dailyLog = { '2026-10-20': 10 };
    await a.open(sa);
    const sb = blank(); sb.dailyLog = { '2026-10-21': 7 };
    await b.open(sb);
    assert.equal(b.conflicts(), false, 'first sync of a second device must not be flagged as a conflict');
    assert.deepEqual(w.prefs().dailyLog, { '2026-10-20': 10, '2026-10-21': 7 }, 'both devices\' days are in the cloud');
  } finally { w.done(); }
});

defect('daily pages edited on two devices for different days both reach the cloud', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const sa = blank(); sa.dailyLog = { '2026-10-20': 10 };
    await a.open(sa);
    const sb = blank(); sb.dailyLog = { '2026-10-21': 7 };
    await b.open(sb);
    const sa2 = blank(); sa2.dailyLog = { '2026-10-20': 10, '2026-10-22': 5 };
    await a.edit(sa2);
    const log = w.prefs().dailyLog;
    assert.equal(log['2026-10-20'], 10);
    assert.equal(log['2026-10-21'], 7, 'device B day must not be lost');
    assert.equal(log['2026-10-22'], 5);
  } finally { w.done(); }
});

defect('a cleared status on one device is cleared on the other', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const bk = book('b1');
    const sa = blank(); sa.customBooks = [bk as any]; sa.status = { b1: 'now' };
    await a.open(sa, [bk]);
    const sb = (await b.open(blank(), [bk])).state;
    assert.equal(sb.status.b1, 'now');
    const cleared = { ...sb, status: {} };
    await b.edit(cleared, [bk]);
    const refreshedA = (await a.edit(sa, [bk])).state; // A refreshes from the cloud
    assert.equal(refreshedA.status.b1, undefined);
  } finally { w.done(); }
});

defect('a cleared personal rating on one device is cleared on the other', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const bk = book('b1');
    const sa = blank(); sa.customBooks = [bk as any]; sa.status = { b1: 'done' }; sa.ratings = { b1: 4 };
    await a.open(sa, [bk]);
    const sb = (await b.open(blank(), [bk])).state;
    await b.edit({ ...sb, ratings: {} }, [bk]);
    const refreshedA = (await a.edit(sa, [bk])).state;
    assert.equal(refreshedA.ratings.b1, undefined);
  } finally { w.done(); }
});

defect('a vocabulary word deleted on one device does not come back from a second device that still has it', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const sa = blank(); sa.words = [word('w1'), word('w2')];
    await a.open(sa);
    const sb = (await b.open(blank())).state; // B has both words and has synced them
    assert.equal(sb.words.length, 2);
    await a.edit({ ...sa, words: sa.words.filter(x => x.id !== 'w1') }); // A deletes w1
    const reopenedB = (await b.open(sb)).state; // B opens again with its stale copy
    assert.deepEqual(reopenedB.words.map(x => x.id), ['w2']);
    assert.deepEqual((w.prefs().words as any[]).map(x => x.id), ['w2'], 'the cloud copy must not get the word back');
  } finally { w.done(); }
});

defect('a word marked learned on one device is learned on the other', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const sa = blank(); sa.words = [word('w1')];
    await a.open(sa);
    const sb = (await b.open(blank())).state;
    await b.edit({ ...sb, words: sb.words.map(x => ({ ...x, isLearned: true })) });
    const refreshedA = (await a.edit(sa)).state;
    assert.equal(refreshedA.words.find(x => x.id === 'w1')?.isLearned, true);
  } finally { w.done(); }
});

defect('a book un-hidden on one device is not re-hidden by a second device that still has it hidden', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const sa = blank(); sa.hiddenBookIds = { b9: true };
    await a.open(sa);
    const sb = (await b.open(blank())).state;
    assert.equal(sb.hiddenBookIds.b9, true);
    await a.edit({ ...sa, hiddenBookIds: {} }); // A un-hides
    const reopenedB = (await b.open(sb)).state;
    assert.equal(reopenedB.hiddenBookIds.b9, undefined);
    assert.equal(w.prefs().hiddenBookIds.b9, undefined);
  } finally { w.done(); }
});

/* Contract for Phase 2 (not testable until the per-day records exist): written here so it is not forgotten. */
defect('an exact-timestamp tie on a day with different pages is reported for the user to choose', () => {
  assert.fail('needs per-day timestamps (Phase 2)');
});

/* ---------- Phase 1: second-device first sync, per-record conflicts, use cloud, reconnect ---------- */

test('first sync fills gaps in both directions: cloud status and this device\'s rating both end up in the cloud, with no conflict', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const bk = book('b1');
    const sa = blank(); sa.customBooks = [bk as any]; sa.status = { b1: 'now' };
    await a.open(sa, [bk]);
    const sb = blank(); sb.customBooks = [bk as any]; sb.ratings = { b1: 5 };
    const opened = await b.open(sb, [bk]);
    assert.equal(b.conflicts(), false);
    assert.equal(opened.state.status.b1, 'now');
    const row = w.tables.get('user_library_books')![0];
    assert.equal(row.status, 'now');
    assert.equal(row.personal_data.rating, 5);
  } finally { w.done(); }
});

test('a real field conflict on first sync pauses only that book; other records still sync and nothing is overwritten', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const b1 = book('b1'), b2 = book('b2');
    const sa = blank(); sa.customBooks = [b1 as any]; sa.status = { b1: 'now' };
    await a.open(sa, [b1]);
    const sb = blank(); sb.customBooks = [b1 as any, b2 as any]; sb.status = { b1: 'done', b2: 'next' }; sb.words = [word('w9')];
    await b.open(sb, [b1, b2]);
    assert.equal(b.conflicts(), true);
    assert.deepEqual(b.paused(), ['book:b1'], 'only the disagreeing book is paused');
    const rows = w.tables.get('user_library_books')!;
    assert.equal(rows.find(r => r.local_book_id === 'b1')!.status, 'now', 'the cloud value was not overwritten');
    assert.equal(rows.find(r => r.local_book_id === 'b2')!.status, 'next', 'the other book still synced');
    assert.deepEqual((w.prefs().words as any[]).map(x => x.id), ['w9'], 'preferences still synced');
  } finally { w.done(); }
});

test('a cloud refresh leaves paused records as they are here and keeps updating the rest', () => {
  const local = blank(); local.status = { b1: 'now' }; local.customBooks = [book('b1') as any, book('b2') as any];
  const row = (id: string, status: string) => ({ id: `id-${id}`, user_id: USER, local_book_id: id, catalog_work_id: null, catalog_edition_id: null, status, reading_progress: {}, personal_cover: null, book_snapshot: book(id), personal_data: { isCustomBook: true }, revision: 2, deleted_at: null });
  const remote: RemoteLibrarySnapshot = { books: [row('b1', 'done'), row('b2', 'now')] as any, annotations: [], shelves: [], memberships: [], preferences: [{ user_id: USER, preferences: { goal: 30 }, revision: 2 }], sessions: [] };
  const merged = mergeRemoteLibrary(local, [], remote, {}, true, new Set(['book:b1'])).state;
  assert.equal(merged.status.b1, 'now', 'paused book keeps this device\'s value');
  assert.equal(merged.status.b2, 'now', 'unpaused book takes the cloud value');
  assert.equal(merged.goal, 30, 'preferences still refresh');
  assert.equal(mergeRemoteLibrary(local, [], remote, {}, true, new Set(['preferences'])).state.goal, 10, 'paused preferences stay put');
});

test('use cloud: the paused record takes the cloud value, is not re-flagged, and the cloud is not overwritten afterwards', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const b1 = book('b1');
    const sa = blank(); sa.customBooks = [b1 as any]; sa.status = { b1: 'now' };
    await a.open(sa, [b1]);
    const sb = blank(); sb.customBooks = [b1 as any]; sb.status = { b1: 'done' };
    await b.open(sb, [b1]);
    assert.equal(b.conflicts(), true);
    const after = await b.useCloud(sb, [b1]);
    assert.equal(after.status.b1, 'now');
    assert.equal(b.conflicts(), false);
    const next = await b.edit(after, [b1]);
    assert.equal(next.ok, true);
    assert.equal(b.conflicts(), false, 'not flagged again');
    assert.equal(w.tables.get('user_library_books')![0].status, 'now');
  } finally { w.done(); }
});

test('use this device: the paused record is written to the cloud afterwards', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const b1 = book('b1');
    const sa = blank(); sa.customBooks = [b1 as any]; sa.status = { b1: 'now' };
    await a.open(sa, [b1]);
    const sb = blank(); sb.customBooks = [b1 as any]; sb.status = { b1: 'done' };
    await b.open(sb, [b1]);
    b.useDevice();
    await b.edit(sb, [b1]);
    assert.equal(b.conflicts(), false);
    assert.equal(w.tables.get('user_library_books')![0].status, 'done');
  } finally { w.done(); }
});

test('a cloud tombstone against live local data on first sync is a conflict: the book is not resurrected', async () => {
  const w = world();
  try {
    const b = w.device();
    const b1 = book('b1');
    w.tables.get('user_library_books')!.push({ id: 'cloud-b1', user_id: USER, local_book_id: 'b1', status: 'now', reading_progress: {}, personal_cover: null, book_snapshot: b1, personal_data: { isCustomBook: true }, revision: 3, deleted_at: '2026-10-01T00:00:00Z' });
    const sb = blank(); sb.customBooks = [b1 as any]; sb.status = { b1: 'now' };
    await b.open(sb, [b1]);
    assert.deepEqual(b.paused(), ['book:b1']);
    assert.ok(w.tables.get('user_library_books')![0].deleted_at, 'the cloud tombstone is untouched');
  } finally { w.done(); }
});

test('offline edits stay pending, then upload on reconnect without a conflict', async () => {
  const w = world();
  try {
    const a = w.device();
    const b1 = book('b1');
    let s = blank(); s.customBooks = [b1 as any];
    s = (await a.open(s, [b1])).state;
    w.setOnline(false);
    s = { ...s, status: { b1: 'now' } };
    const offline = await a.edit(s, [b1]);
    assert.equal(offline.ok, false);
    assert.equal(a.pending(), true, 'the edit is remembered');
    assert.equal(w.tables.get('user_library_books')!.some(r => r.status === 'now'), false);
    w.setOnline(true);
    const back = await a.edit(s, [b1]);
    assert.equal(back.ok, true);
    assert.equal(a.pending(), false);
    assert.equal(a.conflicts(), false);
    assert.equal(w.tables.get('user_library_books')![0].status, 'now');
  } finally { w.done(); }
});

test('first-sync preferences merge: gaps filled, collections unioned, only two different non-empty values conflict', () => {
  const base = { goal: 10, readingIntention: '', profile: { name: '', photo: '', theme: 'auto' }, dailyLog: {}, words: [], hiddenBookIds: {}, onDeviceOverrides: {}, coverPicks: {}, nookLook: null };
  const merged = mergePreferencesFirstSync(
    { ...base, goal: 12, dailyLog: { d1: 5, d2: 9 }, words: [word('w1')], hiddenBookIds: { x: true } },
    { ...base, goal: 10, readingIntention: 'read daily', dailyLog: { d2: 4, d3: 2 }, words: [word('w1', true), word('w2')], hiddenBookIds: { y: true } },
  ) as any;
  assert.equal(merged.goal, 12, 'a default goal never beats a chosen one');
  assert.equal(merged.readingIntention, 'read daily');
  assert.deepEqual(merged.dailyLog, { d1: 5, d2: 9, d3: 2 });
  assert.deepEqual(merged.words.map((x: any) => [x.id, x.isLearned]).sort(), [['w1', true], ['w2', false]]);
  assert.deepEqual(Object.keys(merged.hiddenBookIds).sort(), ['x', 'y']);
  assert.equal(mergePreferencesFirstSync({ ...base, goal: 12 }, { ...base, goal: 15 }), null, 'two chosen goals disagree');
  assert.equal(mergePreferencesFirstSync({ ...base, profile: { name: 'Ana', photo: '', theme: 'auto' } }, { ...base, profile: { name: 'Bea', photo: '', theme: 'auto' } }), null, 'two profile names disagree');
  assert.equal(mergePreferencesFirstSync({ ...base, nookLook: { a: 1 } }, { ...base, nookLook: { a: 2 } }), null);
});
