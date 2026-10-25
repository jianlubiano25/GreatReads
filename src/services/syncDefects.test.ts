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
import { syncSettingsRecords } from './settingsRecordsSync';
import { acknowledgeCloudCopy, markPersonalAnnotationDeleted, hasLibrarySyncConflicts, hasPendingLibrarySync, loadRemoteLibrary, mergeRemoteLibrary, pausedLibraryKeys, resolveLibraryConflictsToCloud, resolveLibraryConflictsToLocal, syncLocalLibrary, type RemoteLibrarySnapshot } from './librarySync';
import { mergePreferencesFirstSync } from './librarySyncMerge';
import { withEdits, withWordsDeleted } from './editTimes';
import { applyDeviceSettings, exportDeviceSettings, mergeDeviceSettings, mergeNameChoices, restoreDeviceSettings } from './deviceSettings';
import { NO_PREFS, loadStorePrefs, saveStorePrefs } from './store/prefs';
import { getFontPrefs, setFontPrefs } from './fontPrefs';
import { getNookMatchesTheme, getWindowFollowsTime, setNookMatchesTheme, setWindowFollowsTime } from './nookPrefs';
import { setSettingsRecordsOverride } from './settingsRecordsFlag';
import { decideDay, keepDeviceDay, loadDailyTies, setDailyPagesSyncOverride, stampDayEdit, syncDailyPages, takeCloudDay, type CloudDay } from './dailyPagesSync';

const defect = (name: string, fn: () => Promise<void> | void) => test(name, { todo: 'known sync defect (see sync audit)' }, fn);

const USER = 'user-1';
const TABLES = ['user_library_books', 'user_book_annotations', 'user_shelves', 'user_shelf_books', 'user_reading_sessions', 'user_library_preferences', 'user_daily_pages', 'user_settings', 'user_words'];

const blank = (): ReadingState => ({
  status: {}, currentPage: {}, totalPages: {}, dailyLog: {}, notes: {}, highlights: {}, goal: 10, readingIntention: '',
  profile: { name: '', photo: '', theme: 'auto' }, customBooks: [], onDeviceOverrides: {}, hiddenBookIds: {}, words: [],
  garden: { v: 1, peaks: { bestStreak: 0, tenPageDays: 0, maxPagesInDay: 0, bestWeekGoalDays: 0, booksFinished: 0, totalPages: 0, highlights: 0, wordsAdded: 0, wordsLearned: 0 }, achievements: {}, plants: {}, placements: {}, celebrated: {}, vine: 0 },
  history: {}, ratings: {},
});
const T0 = Date.now() - 3_600_000;
/** A user edit of one day, stamped like the app does (setDayPages). */
const setDay = (s: ReadingState, day: string, pages: number, at: number, dev = 'dev-a'): ReadingState => ({ ...s, dailyLog: { ...s.dailyLog, [day]: pages }, dailyLogMeta: stampDayEdit(s.dailyLogMeta, day, at, dev) });
const cloudDays = (w: { dayRows: () => Record<string, any>[] }) => Object.fromEntries(w.dayRows().filter(r => !r.deleted_at).map(r => [r.day, r.pages]));
const cloudRow = (day: string, pages: number, editedAt: number, extra: Partial<CloudDay> = {}): CloudDay => ({ user_id: USER, day, pages, edited_at: new Date(editedAt).toISOString(), device_id: 'x', edit_seq: 1, revision: 1, updated_at: new Date(Math.max(editedAt, Date.now())).toISOString(), deleted_at: null, ...extra });
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
    if (method === 'POST') {
      const made = (Array.isArray(payload) ? payload : [payload]).map((p: any) => ({ ...p, id: p.id || crypto.randomUUID(), revision: p.revision || 1, updated_at: new Date().toISOString() }));
      rows.push(...made); return reply(made, 201);
    }
    if (method === 'PATCH') {
      const row = rows.find(r => r.user_id === eq(url, 'user_id')
        && (!url.searchParams.has('local_book_id') || r.local_book_id === eq(url, 'local_book_id'))
        && (!url.searchParams.has('id') || r.id === eq(url, 'id'))
        && (!url.searchParams.has('day') || r.day === eq(url, 'day'))
        && (!url.searchParams.has('key') || r.key === eq(url, 'key'))
        && (!url.searchParams.has('word_id') || r.word_id === eq(url, 'word_id'))
        && r.revision === Number(eq(url, 'revision')));
      if (!row) return reply([]);
      Object.assign(row, payload, { updated_at: new Date().toISOString() }); return reply([row]);
    }
    return reply({}, 404);
  }) as typeof fetch;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });

  const device = () => {
    const m = new Map<string, string>([['readlife.sb1', JSON.stringify({ access: 'a', refresh: 'r', exp: Date.now() + 3.6e6, user: { id: USER } })]]);
    const storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; } };
    const use = () => Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    /** What the app does for per-day pages: pull the cloud's days, apply the newer ones, upload this device's newer ones. */
    const days = async (state: ReadingState): Promise<{ state: ReadingState; ok: boolean }> => {
      use();
      let holder = state;
      const ok = await syncDailyPages(USER, { getState: () => holder, apply: change => { holder = change(holder); } });
      return { state: holder, ok };
    };
    /** What the app does on open: pull the cloud copy, merge it into local, then push, then sync the days. */
    const open = async (state: ReadingState, books: any[] = []) => {
      use();
      const remote = await loadRemoteLibrary(USER);
      const m0 = remote ? mergeRemoteLibrary(state, [], remote, {}, false) : undefined; if (m0) applyDeviceSettings(m0.deviceSettings);
      const merged = m0 ? m0.state : state;
      const ok = await syncLocalLibrary(USER, { state: merged, books, collections: [], coverPicks: {} });
      const d = await days(merged);
      return { state: d.state, ok };
    };
    /** What the app does after a local edit: push, then take the cloud copy back. Records paused by a conflict are left alone; the rest keep refreshing. */
    const edit = async (state: ReadingState, books: any[] = []) => {
      use();
      const ok = await syncLocalLibrary(USER, { state, books, collections: [], coverPicks: {} });
      let after = state;
      if (ok) { const remote = await loadRemoteLibrary(USER); if (remote) { const m1 = mergeRemoteLibrary(state, [], remote, {}, true, pausedLibraryKeys(USER)); applyDeviceSettings(m1.deviceSettings); after = m1.state; } }
      const d = await days(after);
      return { state: d.state, ok };
    };
    /** What the app does when the cloud tells it something changed: take the cloud copy, skipping paused records. */
    const refresh = async (state: ReadingState) => { use(); const remote = await loadRemoteLibrary(USER); if (!remote) return state; const m2 = mergeRemoteLibrary(state, [], remote, {}, true, pausedLibraryKeys(USER)); applyDeviceSettings(m2.deviceSettings); acknowledgeCloudCopy(USER, remote); return m2.state; };
    /** What the app does for per-setting and per-word records. */
    const settings = async (state: ReadingState): Promise<{ state: ReadingState; ok: boolean }> => {
      use();
      let holder = state;
      const ok = await syncSettingsRecords(USER, { getState: () => holder, apply: change => { holder = change(holder); } });
      return { state: holder, ok };
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
    const ties = () => { use(); return loadDailyTies(USER); };
    /** What the app does when a note or highlight is deleted (markPersonalAnnotationDeleted), run as this device. */
    const markDeleted = (bookId: string, annotationId: string) => { use(); markPersonalAnnotationDeleted(bookId, annotationId); };
    /** Run something as this device (its own localStorage), like a setting being changed in the app. */
    const run = <T,>(fn: () => T): T => { use(); return fn(); };
    return { open, edit, refresh, settings, days, ties, conflicts, paused, pending, useCloud, useDevice, markDeleted, run };
  };
  const prefs = () => tables.get('user_library_preferences')![0]?.preferences as any;
  const setOnline = (onLine: boolean) => Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine } });
  const done = () => {
    setDailyPagesSyncOverride(undefined);
    globalThis.fetch = realFetch;
    if (realStorage) Object.defineProperty(globalThis, 'localStorage', realStorage); else delete (globalThis as any).localStorage;
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
  };
  const dayRows = () => tables.get('user_daily_pages')!;
  return { device, prefs, tables, setOnline, dayRows, done };
}

/* ---------- regression guards: these work today and must keep working ---------- */

test('guard (kill switch off, legacy path): a day lowered on the same device stays lowered after a push and refresh', async () => {
  const w = world();
  try {
    setDailyPagesSyncOverride(false);
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
    assert.deepEqual(cloudDays(w), { '2026-10-20': 10, '2026-10-21': 7 }, 'both devices\' days are in the cloud');
  } finally { w.done(); }
});

test('daily pages edited on two devices for different days both reach the cloud and both devices', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const sa = blank(); sa.dailyLog = { '2026-10-20': 10 };
    await a.open(sa);
    const sb = blank(); sb.dailyLog = { '2026-10-21': 7 };
    await b.open(sb);
    const sa2 = setDay(blank(), '2026-10-22', 5, T0); sa2.dailyLog['2026-10-20'] = 10;
    const refreshedA = (await a.edit(sa2)).state;
    assert.deepEqual(cloudDays(w), { '2026-10-20': 10, '2026-10-21': 7, '2026-10-22': 5 }, 'no day lost');
    assert.equal(refreshedA.dailyLog['2026-10-21'], 7, 'device A receives device B\'s day');
    const refreshedB = (await b.edit(sb)).state;
    assert.equal(refreshedB.dailyLog['2026-10-22'], 5, 'device B receives device A\'s day');
  } finally { w.done(); }
});

/* ---------- Phase 3: a clear or a delete is a real, timestamped edit ---------- */

const E1 = T0 + 1_000, E2 = T0 + 2_000, E3 = T0 + 3_000;
const clearStatus = (s: ReadingState, id: string, at: number): ReadingState => { const { [id]: _gone, ...rest } = s.status; return withEdits({ ...s, status: rest }, 'status', [id], at); };
const setStatus = (s: ReadingState, id: string, v: any, at: number): ReadingState => withEdits({ ...s, status: { ...s.status, [id]: v } }, 'status', [id], at);
const setRating = (s: ReadingState, id: string, stars: number, at: number): ReadingState => {
  const { [id]: _gone, ...rest } = s.ratings;
  return withEdits({ ...s, ratings: stars ? { ...s.ratings, [id]: stars } : rest }, 'rating', [id], at);
};

test('a cleared status on one device is cleared on the other', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const bk = book('b1');
    let sa = blank(); sa.customBooks = [bk as any]; sa = setStatus(sa, 'b1', 'now', E1);
    await a.open(sa, [bk]);
    let sb = (await b.open(blank(), [bk])).state;
    assert.equal(sb.status.b1, 'now');
    sb = clearStatus(sb, 'b1', E2);
    await b.edit(sb, [bk]);
    const refreshedA = await a.refresh(sa); // A hears about it from the cloud
    assert.equal(refreshedA.status.b1, undefined);
    assert.equal(a.conflicts(), false);
  } finally { w.done(); }
});

test('a status set later than another device\'s clear brings the book back (latest edit wins)', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const bk = book('b1');
    let sa = blank(); sa.customBooks = [bk as any]; sa = setStatus(sa, 'b1', 'now', E1);
    await a.open(sa, [bk]);
    let sb = (await b.open(blank(), [bk])).state;
    sb = clearStatus(sb, 'b1', E2);
    await b.edit(sb, [bk]);
    sa = setStatus((await a.refresh(sa)), 'b1', 'next', E3); // A, after the clear, chooses a new status
    await a.edit(sa, [bk]);
    const refreshedB = await b.refresh(sb);
    assert.equal(refreshedB.status.b1, 'next');
  } finally { w.done(); }
});

test('a cleared personal rating on one device is cleared on the other', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const bk = book('b1');
    let sa = blank(); sa.customBooks = [bk as any]; sa = setRating(setStatus(sa, 'b1', 'done', E1), 'b1', 4, E1);
    await a.open(sa, [bk]);
    let sb = (await b.open(blank(), [bk])).state;
    assert.equal(sb.ratings.b1, 4);
    sb = setRating(sb, 'b1', 0, E2);
    await b.edit(sb, [bk]);
    const refreshedA = await a.refresh(sa);
    assert.equal(refreshedA.ratings.b1, undefined);
  } finally { w.done(); }
});

test('a rating cleared on a book that has nothing else still reaches the cloud', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const bk = book('b1');
    let sa = blank(); sa.customBooks = [bk as any]; sa = setRating(sa, 'b1', 5, E1);
    await a.open(sa, [bk]);
    let sb = (await b.open(blank(), [bk])).state;
    sb = setRating(sb, 'b1', 0, E2);
    await b.edit(sb, [bk]);
    const row = w.tables.get('user_library_books')!.find(r => r.local_book_id === 'b1')!;
    assert.equal(row.personal_data.rating, null);
    assert.equal(row.personal_data.times.rating, E2);
  } finally { w.done(); }
});

test('legacy values (no edit times anywhere) still merge exactly as before: nothing is cleared by a missing value', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const bk = book('b1');
    const sa = blank(); sa.customBooks = [bk as any]; sa.status = { b1: 'now' }; sa.ratings = { b1: 3 };
    await a.open(sa, [bk]);
    const sb = (await b.open(blank(), [bk])).state;
    assert.equal(sb.status.b1, 'now');
    assert.equal(sb.ratings.b1, 3);
    const keepA = await a.refresh(sa);
    assert.equal(keepA.status.b1, 'now');
    assert.equal(keepA.ratings.b1, 3);
  } finally { w.done(); }
});

test('a vocabulary word deleted on one device does not come back from a second device that still has it', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const sa = blank(); sa.words = [word('w1'), word('w2')];
    await a.open(sa);
    const sb = (await b.open(blank())).state; // B has both words and has synced them
    assert.equal(sb.words.length, 2);
    const deleted = withWordsDeleted({ ...sa, words: sa.words.filter(x => x.id !== 'w1') }, ['w1'], E2); // A deletes w1
    await a.edit(deleted);
    const reopenedB = (await b.open(sb)).state; // B opens again with its stale copy
    assert.deepEqual(reopenedB.words.map(x => x.id), ['w2']);
    assert.deepEqual((w.prefs().words as any[]).map(x => x.id), ['w2'], 'the cloud copy must not get the word back');
    assert.equal(w.prefs().deletedWords.w1, E2);
  } finally { w.done(); }
});

test('a word re-added after it was deleted comes back everywhere', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    let sa = blank(); sa.words = [word('w1')];
    await a.open(sa);
    let sb = (await b.open(blank())).state;
    sa = withWordsDeleted({ ...sa, words: [] }, ['w1'], E1);
    await a.edit(sa);
    sb = await b.refresh(sb);
    assert.equal(sb.words.length, 0);
    sb = withEdits({ ...sb, words: [word('w1')] }, 'word', ['w1'], E2); // B adds it again, later
    await b.edit(sb);
    const refreshedA = await a.refresh(sa);
    assert.deepEqual(refreshedA.words.map(x => x.id), ['w1']);
  } finally { w.done(); }
});

test('a word marked learned on one device is learned on the other', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const sa = blank(); sa.words = [word('w1')];
    await a.open(sa);
    const sb = (await b.open(blank())).state;
    await b.edit(withEdits({ ...sb, words: sb.words.map(x => ({ ...x, isLearned: true })) }, 'word', ['w1'], E2));
    const refreshedA = await a.refresh(sa);
    assert.equal(refreshedA.words.find(x => x.id === 'w1')?.isLearned, true);
  } finally { w.done(); }
});

test('legacy words (no edit times) keep merging as before: a word is never dropped for being missing, and learned is kept if either side has it', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const sa = blank(); sa.words = [word('w1', true)];
    await a.open(sa);
    const sb = blank(); sb.words = [word('w1'), word('w2')];
    const reopened = (await b.open(sb)).state;
    assert.deepEqual(reopened.words.map(x => x.id).sort(), ['w1', 'w2']);
    assert.equal(reopened.words.find(x => x.id === 'w1')?.isLearned, true);
  } finally { w.done(); }
});

test('a book un-hidden on one device is not re-hidden by a second device that still has it hidden', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const sa = blank(); sa.hiddenBookIds = { b9: true };
    await a.open(sa);
    const sb = (await b.open(blank())).state;
    assert.equal(sb.hiddenBookIds.b9, true);
    await a.edit(withEdits({ ...sa, hiddenBookIds: {} }, 'hidden', ['b9'], E2)); // A un-hides
    const reopenedB = (await b.open(sb)).state;
    assert.equal(reopenedB.hiddenBookIds.b9, undefined);
    assert.equal(w.prefs().hiddenBookIds.b9, undefined);
  } finally { w.done(); }
});

test('hiding a book later than another device\'s un-hide hides it again', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const sa = blank(); sa.hiddenBookIds = { b9: true };
    await a.open(sa);
    let sb = (await b.open(blank())).state;
    const unhidden = withEdits({ ...sa, hiddenBookIds: {} }, 'hidden', ['b9'], E1);
    await a.edit(unhidden);
    sb = await b.refresh(sb);
    assert.equal(sb.hiddenBookIds.b9, undefined);
    sb = withEdits({ ...sb, hiddenBookIds: { b9: true } }, 'hidden', ['b9'], E2);
    await b.edit(sb);
    assert.equal((await a.refresh(unhidden)).hiddenBookIds.b9, true);
  } finally { w.done(); }
});

/* ---------- Phase 3b: notes and highlights are timestamped edits too ---------- */

const hl = (id: string, text: string, page?: number) => ({ id, text, page, timestamp: 1 });
const setNote = (s: ReadingState, id: string, text: string, at: number): ReadingState => withEdits({ ...s, notes: { ...s.notes, [id]: text } }, 'note', [id], at);
const clearNote = (s: ReadingState, id: string, at: number): ReadingState => { const { [id]: _gone, ...rest } = s.notes; return withEdits({ ...s, notes: rest }, 'note', [id], at); };
const setHls = (s: ReadingState, id: string, list: any[], changed: string, at: number): ReadingState => withEdits({ ...s, highlights: { ...s.highlights, [id]: list } }, 'highlight', [`${id}:${changed}`], at);

test('a note edited on one device shows the newer text on the other, with no conflict', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const bk = book('b1');
    let sa = blank(); sa.customBooks = [bk as any]; sa = setNote(setStatus(sa, 'b1', 'now', E1), 'b1', 'first', E1);
    await a.open(sa, [bk]);
    let sb = (await b.open(blank(), [bk])).state;
    assert.equal(sb.notes.b1, 'first');
    sb = setNote(sb, 'b1', 'second', E2);
    await b.edit(sb, [bk]);
    assert.equal((await a.refresh(sa)).notes.b1, 'second');
    assert.equal(a.conflicts(), false);
  } finally { w.done(); }
});

test('a note cleared on one device is cleared on the other, and the cloud keeps when it was cleared', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const bk = book('b1');
    let sa = blank(); sa.customBooks = [bk as any]; sa = setNote(setStatus(sa, 'b1', 'now', E1), 'b1', 'keep me?', E1);
    await a.open(sa, [bk]);
    let sb = (await b.open(blank(), [bk])).state;
    sb = clearNote(sb, 'b1', E2); b.markDeleted('b1', 'note');
    await b.edit(sb, [bk]);
    const row = w.tables.get('user_book_annotations')!.find(r => r.annotation_type === 'note')!;
    assert.ok(row.deleted_at);
    assert.equal(row.extra_data.edited_at, E2);
    assert.equal((await a.refresh(sa)).notes.b1, undefined);
  } finally { w.done(); }
});

test('a note written again after another device cleared it comes back on both devices', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const bk = book('b1');
    let sa = blank(); sa.customBooks = [bk as any]; sa = setNote(setStatus(sa, 'b1', 'now', E1), 'b1', 'old', E1);
    await a.open(sa, [bk]);
    let sb = (await b.open(blank(), [bk])).state;
    sb = clearNote(sb, 'b1', E2); b.markDeleted('b1', 'note');
    await b.edit(sb, [bk]);
    sa = await a.refresh(sa);
    assert.equal(sa.notes.b1, undefined);
    sa = setNote(sa, 'b1', 'written again', E3);
    await a.edit(sa, [bk]);
    assert.equal((await b.refresh(sb)).notes.b1, 'written again');
    assert.equal(a.conflicts(), false);
  } finally { w.done(); }
});

test('a clear that is OLDER than another device\'s edit does not delete that edit', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const bk = book('b1');
    let sa = blank(); sa.customBooks = [bk as any]; sa = setNote(setStatus(sa, 'b1', 'now', E1), 'b1', 'old', E1);
    await a.open(sa, [bk]);
    let sb = (await b.open(blank(), [bk])).state;
    sb = clearNote(sb, 'b1', E2); b.markDeleted('b1', 'note');
    await b.edit(sb, [bk]);
    const editedLater = setNote(sa, 'b1', 'edited after the clear', E3); // A never saw the clear, edits later
    assert.equal((await a.refresh(editedLater)).notes.b1, 'edited after the clear');
  } finally { w.done(); }
});

test('an edited highlight shows the newer text on the other device; a deleted highlight is gone', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const bk = book('b1');
    let sa = blank(); sa.customBooks = [bk as any]; sa = setHls(setStatus(sa, 'b1', 'now', E1), 'b1', [hl('h1', 'one', 3), hl('h2', 'two', 4)], 'h1', E1);
    await a.open(sa, [bk]);
    let sb = (await b.open(blank(), [bk])).state;
    assert.equal(sb.highlights.b1.length, 2);
    sb = setHls(sb, 'b1', [hl('h1', 'one, corrected', 3), hl('h2', 'two', 4)], 'h1', E2);
    await b.edit(sb, [bk]);
    let ra = await a.refresh(sa);
    assert.equal(ra.highlights.b1.find(x => x.id === 'h1')?.text, 'one, corrected');
    sb = setHls(sb, 'b1', [hl('h1', 'one, corrected', 3)], 'h2', E3); b.markDeleted('b1', 'h2');
    await b.edit(sb, [bk]);
    ra = await a.refresh(ra);
    assert.deepEqual(ra.highlights.b1.map(x => x.id), ['h1']);
  } finally { w.done(); }
});

test('first sync with a note on both devices: the later edit wins instead of pausing as a conflict', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const bk = book('b1');
    let sa = blank(); sa.customBooks = [bk as any]; sa = setNote(setStatus(sa, 'b1', 'now', E1), 'b1', 'from A', E1);
    await a.open(sa, [bk]);
    let sb = blank(); sb.customBooks = [bk as any]; sb = setNote(setStatus(sb, 'b1', 'now', E1), 'b1', 'from B, later', E2);
    const opened = await b.open(sb, [bk]);
    assert.equal(opened.state.notes.b1, 'from B, later');
    assert.equal(b.conflicts(), false);
    assert.equal(w.tables.get('user_book_annotations')!.find(r => r.annotation_type === 'note')!.content, 'from B, later');
  } finally { w.done(); }
});

test('legacy notes and highlights (no edit times) behave exactly as before: two different unstamped notes still pause as a real conflict', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const bk = book('b1');
    const sa = blank(); sa.customBooks = [bk as any]; sa.status = { b1: 'now' }; sa.notes = { b1: 'from A' };
    await a.open(sa, [bk]);
    const sb = blank(); sb.customBooks = [bk as any]; sb.status = { b1: 'now' }; sb.notes = { b1: 'from B' };
    await b.open(sb, [bk]);
    assert.equal(b.conflicts(), true);
    assert.equal(w.tables.get('user_book_annotations')!.find(r => r.annotation_type === 'note')!.content, 'from A', 'the cloud copy is not overwritten');
  } finally { w.done(); }
});

/* ---------- Phase 5: store layout, fonts, nook toggles and name choices sync; shelf order is applied ---------- */

const LAYOUT = { order: ['trending', 'fiction'], hidden: ['prizes'], shown: [] as string[] };

test('a second device gets the first device\'s store layout, fonts and nook toggles on its first sync', async () => {
  const w = world(); setSettingsRecordsOverride(false); // these tests cover the legacy shared record on its own (per-setting records are tested in settingsRecordsSync.test.ts)
  try {
    const a = w.device(); const b = w.device();
    a.run(() => { saveStorePrefs(LAYOUT); setFontPrefs({ title: 'Lora' }); setNookMatchesTheme(true); setWindowFollowsTime(false); });
    await a.open(blank());
    await b.open(blank());
    assert.deepEqual(b.run(() => loadStorePrefs()), LAYOUT);
    assert.equal(b.run(() => getFontPrefs().title), 'Lora');
    assert.equal(b.run(() => getNookMatchesTheme()), true);
    assert.equal(b.run(() => getWindowFollowsTime()), false);
    assert.equal(b.conflicts(), false);
  } finally { setSettingsRecordsOverride(undefined); w.done(); }
});

test('a later settings change on one device reaches the other without a conflict, and a reset to default counts as a change', async () => {
  const w = world(); setSettingsRecordsOverride(false); // these tests cover the legacy shared record on its own (per-setting records are tested in settingsRecordsSync.test.ts)
  try {
    const a = w.device(); const b = w.device();
    a.run(() => saveStorePrefs(LAYOUT));
    const sa = (await a.open(blank())).state; await b.open(blank());
    b.run(() => saveStorePrefs({ ...LAYOUT, order: ['fiction', 'trending'] }));
    await b.edit(blank());
    await a.refresh(sa);
    assert.deepEqual(a.run(() => loadStorePrefs().order), ['fiction', 'trending']);
    a.run(() => saveStorePrefs(NO_PREFS)); // A resets the layout
    await a.edit(sa);
    await b.refresh(blank());
    assert.deepEqual(b.run(() => loadStorePrefs()), NO_PREFS);
    assert.equal(a.conflicts() || b.conflicts(), false);
  } finally { setSettingsRecordsOverride(undefined); w.done(); }
});

test('a layout this device never changed since before stamping (legacy) is replaced by a real, stamped change from the cloud', async () => {
  const w = world(); setSettingsRecordsOverride(false); // these tests cover the legacy shared record on its own (per-setting records are tested in settingsRecordsSync.test.ts)
  try {
    const a = w.device(); const b = w.device();
    a.run(() => saveStorePrefs(LAYOUT));
    await a.open(blank());
    b.run(() => localStorage.setItem('readlife.storeprefs1', JSON.stringify({ order: ['other'], hidden: [], shown: [] }))); // old value, no stamp
    await b.open(blank());
    assert.deepEqual(b.run(() => loadStorePrefs()), LAYOUT);
  } finally { setSettingsRecordsOverride(undefined); w.done(); }
});

test('settings with nothing changed anywhere add nothing to the cloud or to a backup', async () => {
  const w = world();
  try {
    const a = w.device();
    await a.open(blank());
    assert.equal(a.run(() => exportDeviceSettings()), undefined);
    assert.equal(w.prefs().deviceSettings, null);
  } finally { w.done(); }
});

test('settings travel in a JSON backup and a restore puts them back (and counts as a change made now)', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    a.run(() => { saveStorePrefs(LAYOUT); setFontPrefs({ text: 'Inter' }); setWindowFollowsTime(false); });
    const json = JSON.stringify({ deviceSettings: a.run(() => exportDeviceSettings()) });
    b.run(() => restoreDeviceSettings(json));
    assert.deepEqual(b.run(() => loadStorePrefs()), LAYOUT);
    assert.equal(b.run(() => getFontPrefs().text), 'Inter');
    assert.equal(b.run(() => getWindowFollowsTime()), false);
    assert.ok((b.run(() => exportDeviceSettings())!.storeLayout!.at) > 0);
    b.run(() => restoreDeviceSettings(JSON.stringify({ goal: 5 }))); // an older backup leaves settings alone
    assert.deepEqual(b.run(() => loadStorePrefs()), LAYOUT);
  } finally { w.done(); }
});

test('mergeDeviceSettings: later change wins per group; a tie keeps this device unless the cloud copy is being taken', () => {
  const local = { fonts: { value: { title: 'Lora', text: 'Inter' }, at: 5 }, storeLayout: { value: LAYOUT, at: 9 } };
  const remote = { fonts: { value: { title: 'Fraunces', text: 'Lato' }, at: 7 }, storeLayout: { value: { order: [], hidden: [], shown: [] }, at: 9 } };
  const merged = mergeDeviceSettings(local as any, remote)!;
  assert.equal(merged.fonts!.value.title, 'Fraunces');
  assert.deepEqual(merged.storeLayout!.value, LAYOUT); // tie: this device's
  assert.deepEqual(mergeDeviceSettings(local as any, remote, true)!.storeLayout!.value, NO_PREFS); // tie, cloud taken
  assert.deepEqual(mergeDeviceSettings(undefined, { fonts: { value: { title: 'not a font', text: 'x' }, at: 3 } })!.fonts!.value, { title: 'DM Serif Display', text: 'System (default)' }, 'junk from the cloud is repaired, never trusted');
});

test('name choices merge per book: newest wins, nothing is lost, and a clear after a choice removes it', () => {
  const c = (author: string, t: number) => ({ v: { author }, t });
  const local = { value: { a: c('A1', 10), b: c('B1', 20) }, at: 20 };
  const remote = { value: { a: c('A2', 30), c: c('C1', 25) }, at: 30 };
  const merged = mergeNameChoices(local, remote)!;
  assert.equal(merged.value.a.v.author, 'A2');          // newer on the cloud
  assert.equal(merged.value.c.v.author, 'C1');          // only on the cloud: kept
  assert.equal(merged.value.b, undefined);              // the cloud changed its choices (at 30) after b was made (20) and has no b: cleared
  const keepB = mergeNameChoices({ value: { b: c('B1', 40) }, at: 40 }, { value: {}, at: 30 })!;
  assert.equal(keepB.value.b.v.author, 'B1');           // b was chosen AFTER the cloud's last change: kept
});

test('shelf and book order from the cloud is applied when the cloud copy is taken, and new shelves arrive in the cloud\'s order', () => {
  const shelf = (id: string, local: string, order: number): any => ({ id, user_id: USER, name: local.toUpperCase(), description: null, sort_order: order, shelf_data: { local_id: local, kind: 'shelf' }, deleted_at: null, revision: 1 });
  const lb = (id: string, local: string): any => ({ id, user_id: USER, local_book_id: local, status: null, reading_progress: {}, personal_data: {}, book_snapshot: null, personal_cover: null, deleted_at: null, revision: 1 });
  const mem = (id: string, shelfId: string, bookId: string, local: string, shelfLocal: string, order: number): any => ({ id, user_id: USER, shelf_id: shelfId, library_book_id: bookId, sort_order: order, membership_data: { local_id: `${shelfLocal}|${local}`, local_shelf_id: shelfLocal, local_book_id: local }, deleted_at: null, revision: 1 });
  const remote: RemoteLibrarySnapshot = {
    books: [lb('l1', 'b1'), lb('l2', 'b2'), lb('l3', 'b3')], annotations: [], sessions: [], preferences: [],
    shelves: [shelf('s1', 'one', 2), shelf('s2', 'two', 0), shelf('s3', 'three', 1)],
    memberships: [mem('m1', 's1', 'l1', 'b1', 'one', 2), mem('m2', 's1', 'l2', 'b2', 'one', 0), mem('m3', 's1', 'l3', 'b3', 'one', 1)],
  };
  const fresh = mergeRemoteLibrary(blank(), [], remote, {}, false);          // a device that has nothing yet
  assert.deepEqual(fresh.collections.map(x => x.id), ['two', 'three', 'one']);
  assert.deepEqual(fresh.collections.find(x => x.id === 'one')!.bookIds, ['b2', 'b3', 'b1']);
  const local = [{ id: 'one', name: 'ONE', kind: 'shelf' as const, bookIds: ['b1', 'b2', 'b3'] }, { id: 'two', name: 'TWO', kind: 'shelf' as const, bookIds: [] }, { id: 'mine', name: 'Only here', kind: 'shelf' as const, bookIds: ['b9'] }];
  const kept = mergeRemoteLibrary(blank(), local, remote, {}, false);        // opening: this device's own order is not rearranged
  assert.deepEqual(kept.collections.map(x => x.id).slice(0, 3), ['one', 'two', 'mine']);
  const taken = mergeRemoteLibrary(blank(), local, remote, {}, true);        // the cloud copy: its order wins, local-only shelves stay after it
  assert.deepEqual(taken.collections.map(x => x.id), ['two', 'three', 'one', 'mine']);
  assert.deepEqual(taken.collections.find(x => x.id === 'one')!.bookIds, ['b2', 'b3', 'b1']);
  assert.deepEqual(taken.collections.find(x => x.id === 'mine')!.bookIds, ['b9']);
});

/* ---------- Two-device checks for what the owner saw on iPhone + iPad ---------- */

const plant = { milestoneId: 'm1', earnedAt: 1, growth: 0.5 };
const garden = (placements: Record<string, { areaId: string; slot: number }>, times?: Record<string, number>): ReadingState['garden'] => ({ ...blank().garden, plants: { p1: plant, p2: { ...plant, milestoneId: 'm2' } }, placements, ...(times ? { placementTimes: times } : {}) });

test('plants rearranged on one device are rearranged on the other (the later move wins per plant)', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    let sa = blank(); sa.garden = garden({ p1: { areaId: 'shelf', slot: 0 }, p2: { areaId: 'shelf', slot: 1 } });
    sa = (await a.settings(sa)).state;
    let sb = (await b.settings(blank())).state;
    assert.equal(sb.garden.placements.p1.slot, 0);
    sa = { ...sa, garden: garden({ p1: { areaId: 'shelf', slot: 1 }, p2: { areaId: 'shelf', slot: 0 } }, { p1: E2, p2: E2 }) }; // A moved them
    await a.settings(sa);
    sb = (await b.settings(sb)).state;
    assert.deepEqual(sb.garden.placements, { p1: { areaId: 'shelf', slot: 1 }, p2: { areaId: 'shelf', slot: 0 } });
    sb = { ...sb, garden: garden({ p1: { areaId: 'shelf', slot: 0 }, p2: { areaId: 'shelf', slot: 1 } }, { p1: E3, p2: E3 }) }; // B moves them back, later
    await b.settings(sb);
    sa = (await a.settings(sa)).state;
    assert.equal(sa.garden.placements.p1.slot, 0);
  } finally { w.done(); }
});

test('a word deleted on one device disappears from the other through the per-word records', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    let sa = blank(); sa.words = [word('w1'), word('w2')];
    sa = (await a.settings(sa)).state;
    let sb = (await b.settings(blank())).state;
    assert.equal(sb.words.length, 2);
    sa = withWordsDeleted({ ...sa, words: sa.words.filter(x => x.id !== 'w1') }, ['w1'], E2);
    assert.equal((await a.settings(sa)).ok, true);
    sb = (await b.settings(sb)).state;
    assert.deepEqual(sb.words.map(x => x.id), ['w2']);
  } finally { w.done(); }
});

test('a page number changed on one device reaches the other, and the other can keep editing without a conflict', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const bk = book('b1');
    let sa = blank(); sa.customBooks = [bk as any]; sa = setStatus(sa, 'b1', 'now', E1); sa.currentPage = { b1: 10 }; sa.totalPages = { b1: 100 };
    await a.open(sa, [bk]);
    let sb = (await b.open(blank(), [bk])).state;
    assert.equal(sb.currentPage.b1, 10);
    sa = { ...sa, currentPage: { b1: 25 } };
    await a.edit(sa, [bk]);
    sb = await b.refresh(sb);
    assert.equal(sb.currentPage.b1, 25);
    sb = { ...sb, currentPage: { b1: 40 } };            // now B reads on
    assert.equal((await b.edit(sb, [bk])).ok, true);
    sa = await a.refresh(sa);
    assert.equal(sa.currentPage.b1, 40);
    assert.equal(a.conflicts() || b.conflicts(), false);
  } finally { w.done(); }
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

test('first-sync preferences merge: gaps filled, collections unioned, only two different non-empty values conflict (legacy daily log merge, both kill switches off)', () => {
  setDailyPagesSyncOverride(false); setSettingsRecordsOverride(false);
  try { legacyPrefsMerge(); } finally { setDailyPagesSyncOverride(undefined); setSettingsRecordsOverride(undefined); }
});
function legacyPrefsMerge() {
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
}

/* ---------- Phase 2: per-day pages ---------- */

const D = '2026-10-20';

test('the later edit wins per day, and lowering a day on one device lowers it on the other', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const sa = setDay(blank(), D, 10, T0);
    await a.open(sa);
    const sb = (await b.open(blank())).state;
    assert.equal(sb.dailyLog[D], 10);
    const lowered = (await b.edit(setDay(sb, D, 6, T0 + 1000, 'dev-b'))).state;
    assert.equal(lowered.dailyLog[D], 6);
    const refreshedA = (await a.edit(sa)).state; // A still holds the older 10
    assert.equal(refreshedA.dailyLog[D], 6, 'the older value does not win');
    assert.equal(cloudDays(w)[D], 6);
    assert.deepEqual(a.ties(), []);
  } finally { w.done(); }
});

test('an exact same-moment edit with different pages is a tie: nothing is overwritten and the owner chooses (cloud)', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const sa = setDay(blank(), D, 10, T0);
    await a.open(sa);
    const sb = (await b.open(blank())).state;
    await a.edit(setDay(sa, D, 12, T0 + 5000, 'dev-a'));
    const tied = (await b.edit(setDay(sb, D, 15, T0 + 5000, 'dev-b'))).state;
    assert.equal(cloudDays(w)[D], 12, 'the cloud value was not overwritten');
    assert.equal(tied.dailyLog[D], 15, 'this device\'s value was not overwritten either');
    const ties = b.ties();
    assert.equal(ties.length, 1);
    assert.deepEqual([ties[0].day, ties[0].localPages, ties[0].cloudPages], [D, 15, 12]);
    const chosen = takeCloudDay(tied, ties[0]);
    const after = await b.days(chosen);
    assert.equal(after.state.dailyLog[D], 12);
    assert.deepEqual(b.ties(), [], 'the tie is gone once chosen');
    assert.equal(cloudDays(w)[D], 12);
  } finally { w.done(); }
});

test('a tie resolved with "keep this device" uploads this device\'s value', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const sa = setDay(blank(), D, 10, T0);
    await a.open(sa);
    const sb = (await b.open(blank())).state;
    await a.edit(setDay(sa, D, 12, T0 + 5000));
    const tied = (await b.edit(setDay(sb, D, 15, T0 + 5000, 'dev-b'))).state;
    assert.equal(b.ties().length, 1);
    const kept = (await b.days(keepDeviceDay(tied, D))).state;
    assert.equal(kept.dailyLog[D], 15);
    assert.equal(cloudDays(w)[D], 15);
    assert.deepEqual(b.ties(), []);
    assert.equal((await a.edit(setDay(sa, D, 12, T0 + 5000))).state.dailyLog[D], 15, 'the other device then receives it');
  } finally { w.done(); }
});

test('legacy values (never edited since stamping) merge to the larger one with no tie; any real edit beats a legacy value, even a lower one', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const sa = blank(); sa.dailyLog = { [D]: 5 };
    await a.open(sa);
    const sb = blank(); sb.dailyLog = { [D]: 8 };
    await b.open(sb);
    assert.deepEqual(a.ties(), []); assert.deepEqual(b.ties(), []);
    assert.equal((await a.edit(sa)).state.dailyLog[D], 8, 'the larger legacy value wins');
    assert.equal(cloudDays(w)[D], 8);
    const real = (await a.edit(setDay(blank(), D, 3, T0))).state; // a real, deliberate edit down to 3
    assert.equal(real.dailyLog[D], 3);
    assert.equal(cloudDays(w)[D], 3, 'a real edit beats a legacy value');
  } finally { w.done(); }
});

test('a day missing from the cloud or from a device is never a deletion; only an explicit deleted_at removes it', async () => {
  const w = world();
  try {
    const a = w.device(); const b = w.device();
    const sa = blank(); sa.dailyLog = { '2026-10-01': 1, '2026-10-02': 2 };
    await a.open(sa);
    const sb = blank(); sb.dailyLog = { '2026-10-01': 1 };
    const afterB = (await b.open(sb)).state;
    assert.equal(afterB.dailyLog['2026-10-02'], 2, 'B receives the day it did not have');
    assert.deepEqual(cloudDays(w), { '2026-10-01': 1, '2026-10-02': 2 }, 'the cloud keeps both');
    // an explicit tombstone newer than this device's edit removes the day
    const row = w.dayRows().find(r => r.day === '2026-10-02')!;
    Object.assign(row, { deleted_at: new Date().toISOString(), edited_at: new Date(T0 + 9000).toISOString(), revision: row.revision + 1 });
    const gone = (await b.days(setDay(afterB, '2026-10-02', 2, T0))).state;
    assert.equal('2026-10-02' in gone.dailyLog, false);
  } finally { w.done(); }
});

test('an untrustworthy clock never wins silently: a far-future local edit or a cloud time far ahead of its own server time is a tie', () => {
  const now = Date.now();
  const hour = 3_600_000;
  const cloud = cloudRow(D, 7, now - 1000);
  assert.equal(decideDay(9, { editedAt: now + 2 * hour, deviceId: 'a', editSeq: 1 }, cloud, now), 'tie', 'local edit time is in the future');
  assert.equal(decideDay(9, { editedAt: now, deviceId: 'a', editSeq: 1 }, cloud, now), 'push-local', 'a normal newer local edit wins');
  const future = cloudRow(D, 7, now + 2 * hour, { updated_at: new Date(now).toISOString() });
  assert.equal(decideDay(9, { editedAt: now, deviceId: 'a', editSeq: 1 }, future, now), 'tie', 'cloud time is far ahead of the server\'s own time');
  assert.equal(decideDay(7, { editedAt: now, deviceId: 'a', editSeq: 1 }, future, now), 'same', 'equal pages are never a conflict');
  assert.equal(decideDay(undefined, undefined, undefined, now), 'skip');
  assert.equal(decideDay(4, undefined, undefined, now), 'push-local');
});

test('stampDayEdit is strictly later than the previous stamp even if the clock goes backwards, and counts edits', () => {
  const one = stampDayEdit(undefined, D, 5000, 'dev');
  const two = stampDayEdit(one, D, 1000, 'dev');
  assert.equal(two[D].editedAt, 5001);
  assert.equal(two[D].editSeq, 2);
  assert.equal(stampDayEdit(two, '2026-10-21', 10, 'dev')[D].editedAt, 5001, 'other days are left alone');
});

test('with per-day pages on, the old preferences.dailyLog is read-only: never modified, imported once, and a stale copy cannot undo a stamped day', async () => {
  const w = world();
  try {
    w.tables.get('user_library_preferences')!.push({ user_id: USER, preferences: { goal: 10, readingIntention: '', profile: { name: '', photo: '', theme: 'auto' }, dailyLog: { '2026-10-01': 4, [D]: 9 }, words: [], hiddenBookIds: {}, onDeviceOverrides: {}, coverPicks: {}, nookLook: null }, revision: 1 });
    const legacyBefore = JSON.stringify(w.prefs().dailyLog);
    const a = w.device();
    let s = setDay(blank(), D, 2, T0); // a deliberate, stamped value lower than the stale old copy
    s = (await a.open(s)).state;
    s = (await a.edit({ ...s, goal: 12 })).state;
    assert.equal(JSON.stringify(w.prefs().dailyLog), legacyBefore, 'the old copy is untouched');
    assert.equal(s.dailyLog[D], 2, 'the stale old copy did not undo the stamped edit');
    assert.equal(s.dailyLog['2026-10-01'], 4, 'a day only the old copy had is imported');
    assert.equal(cloudDays(w)['2026-10-01'], 4, '... and uploaded once as a legacy value');
    assert.equal(cloudDays(w)[D], 2);
  } finally { w.done(); }
});

test('kill switch off: per-day pages do nothing and the old preferences.dailyLog path behaves exactly as before', async () => {
  const w = world();
  try {
    setDailyPagesSyncOverride(false);
    const a = w.device();
    const s = (await a.open(setDay(blank(), D, 6, T0))).state;
    assert.equal(w.dayRows().length, 0, 'nothing written to the daily table');
    assert.equal(w.prefs().dailyLog[D], 6, 'the old copy is still written');
    assert.equal(s.dailyLog[D], 6);
  } finally { w.done(); }
});

test('a day edited offline stays on this device, then uploads on reconnect', async () => {
  const w = world();
  try {
    const a = w.device();
    let s = (await a.open(blank())).state;
    w.setOnline(false);
    s = setDay(s, D, 11, T0);
    const offline = await a.edit(s);
    assert.equal(offline.ok, false);
    assert.equal(w.dayRows().length, 0);
    assert.equal(offline.state.dailyLog[D], 11, 'the edit is still here');
    w.setOnline(true);
    const back = await a.edit(s);
    assert.equal(back.ok, true);
    assert.deepEqual(cloudDays(w), { [D]: 11 });
  } finally { w.done(); }
});

test('a lost race (someone else wrote the day first) is retried and re-decided, not overwritten', async () => {
  const w = world();
  try {
    const a = w.device();
    await a.open(setDay(blank(), D, 10, T0));
    const row = w.dayRows()[0];
    const realFetch = globalThis.fetch;
    let raced = false;
    globalThis.fetch = (async (input: any, init: any = {}) => {
      // between A's read and A's write, another device writes the same day later
      if (!raced && (init.method || 'GET') === 'PATCH') { raced = true; Object.assign(row, { pages: 20, edited_at: new Date(T0 + 60_000).toISOString(), revision: row.revision + 1 }); }
      return realFetch(input, init);
    }) as typeof fetch;
    const first = await a.days(setDay(setDay(blank(), D, 10, T0), D, 12, T0 + 1000));
    assert.equal(first.ok, false, 'the lost compare-and-swap reports a retry');
    assert.equal(row.pages, 20, 'the other device\'s newer value is intact');
    globalThis.fetch = realFetch;
    const second = await a.days(setDay(setDay(blank(), D, 10, T0), D, 12, T0 + 1000));
    assert.equal(second.ok, true);
    assert.equal(second.state.dailyLog[D], 20, 'on retry the newer cloud value wins');
  } finally { w.done(); }
});

/* ---------- device-local "on this device" is never synced ---------- */

test('"on this device" stays on the device: never uploaded, never applied, and the cloud\'s old value is left as it is', async () => {
  const w = world();
  try {
    const bk = book('b1');
    w.tables.get('user_library_books')!.push({ id: 'cloud-b1', user_id: USER, local_book_id: 'b1', status: null, reading_progress: {}, personal_cover: null, book_snapshot: bk, personal_data: { isCustomBook: true, onDevice: true, rating: null }, revision: 1, deleted_at: null });
    const a = w.device();
    const s0 = blank(); s0.customBooks = [bk as any]; s0.status = { b1: 'now' }; s0.onDeviceOverrides = { b1: false, b2: true };
    const opened = (await a.open(s0, [bk, book('b2')])).state;
    const row = w.tables.get('user_library_books')![0];
    assert.equal(row.status, 'now');
    assert.equal(row.personal_data.onDevice, true, 'the cloud\'s old value is preserved, not overwritten with this device\'s');
    assert.equal(w.tables.get('user_library_books')!.some(r => r.local_book_id === 'b2'), false, 'a book with only a device flag gets no cloud row');
    assert.deepEqual(w.prefs().onDeviceOverrides, {}, 'the device flags are not in the shared preferences');
    assert.deepEqual(opened.onDeviceOverrides, { b1: false, b2: true }, 'this device keeps its own flags (the cloud\'s true is not applied)');
    await a.edit({ ...opened, status: { b1: 'done' } }, [bk]);
    assert.equal(w.tables.get('user_library_books')![0].personal_data.onDevice, true);
  } finally { w.done(); }
});

/* ---------- The real-device report: change theme, move a plant, add pages on one device; the other device must show them ---------- */

test('theme, a moved plant and added pages made on one device show up on the other', async () => {
  const w = world();
  try {
    const phone = w.device(); const ipad = w.device();
    let sp = blank(); let si = blank();
    sp.garden = { ...sp.garden, peaks: { ...sp.garden.peaks, totalPages: 5 }, placements: {} } as any; si.garden = { ...sp.garden } as any;
    // both signed in, both have synced once
    sp = (await phone.open(sp)).state; si = (await ipad.open(si)).state;
    sp = (await phone.settings(sp)).state; si = (await ipad.settings(si)).state;
    // on the phone: Parchment theme, move a plant, read 20 pages today
    sp = { ...sp, profile: { ...sp.profile, theme: 'light' }, garden: { ...sp.garden, placements: { plantA: { area: 'shelf', index: 2 } } } as any };
    sp = { ...sp, dailyLog: { ...sp.dailyLog, '2026-10-25': 20 }, dailyLogMeta: stampDayEdit(sp.dailyLogMeta, '2026-10-25') };
    sp = (await phone.settings(sp)).state;
    sp = (await phone.days(sp)).state;
    // the iPad hears about it (live event, a foreground return, or the safety-net check: all run these same rounds)
    si = (await ipad.settings(si)).state;
    si = (await ipad.days(si)).state;
    assert.equal(si.profile.theme, 'light', 'theme');
    assert.deepEqual((si.garden as any).placements, { plantA: { area: 'shelf', index: 2 } }, 'moved plant');
    assert.equal(si.dailyLog['2026-10-25'], 20, 'pages');
  } finally { w.done(); }
});

test('the safety-net check notices each of those changes in the cloud', async () => {
  const w = world();
  try {
    const phone = w.device(); const ipad = w.device();
    const { probeFingerprint, createProbeWatcher } = await import('./changeProbe');
    const { rest } = await import('./supabase');
    let sp = blank(); sp.garden = { ...sp.garden, peaks: { ...sp.garden.peaks, totalPages: 5 } } as any;
    sp = (await phone.open(sp)).state; sp = (await phone.settings(sp)).state;
    const watcher = createProbeWatcher();
    const probe = async () => ipad.run(async () => watcher.changed(await probeFingerprint(USER, rest as any)));
    await probe(); // baseline on the iPad
    assert.equal(await probe(), false, 'nothing changed yet');
    sp = { ...sp, profile: { ...sp.profile, theme: 'light' } };
    await phone.settings(sp);
    assert.equal(await probe(), true, 'theme change noticed');
    sp = { ...sp, dailyLog: { '2026-10-25': 20 }, dailyLogMeta: stampDayEdit(sp.dailyLogMeta, '2026-10-25') };
    await phone.days(sp);
    assert.equal(await probe(), true, 'page change noticed');
    sp = { ...sp, garden: { ...sp.garden, placements: { p: { area: 'a', index: 1 } } } as any };
    await phone.settings(sp);
    assert.equal(await probe(), true, 'plant move noticed');
  } finally { w.done(); }
});
