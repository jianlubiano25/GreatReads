import test from 'node:test';
import assert from 'node:assert/strict';
import type { ReadingState, Book } from '../types';
import { mergeRemoteLibrary, syncLocalLibrary, type RemoteLibrarySnapshot } from './librarySync';

const state = (): ReadingState => ({
  status: {}, currentPage: {}, totalPages: {}, dailyLog: {}, notes: {}, highlights: {}, goal: 10, readingIntention: '',
  profile: { name: '', photo: '', theme: 'auto' }, customBooks: [], onDeviceOverrides: {}, hiddenBookIds: {}, words: [],
  garden: { v: 1, peaks: { bestStreak: 0, tenPageDays: 0, maxPagesInDay: 0, bestWeekGoalDays: 0, booksFinished: 0, totalPages: 0, highlights: 0, wordsAdded: 0, wordsLearned: 0 }, achievements: {}, plants: {}, placements: {}, celebrated: {}, vine: 0 }, history: {}, ratings: {},
});
const mk = (id: string): Book => ({ id, title: `Book ${id}`, author: 'A. Writer', shelf: 'mine', difficulty: 0, isOnDevice: false, year: '', genre: '', summary: '', authorBio: '', pageCount: 0 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test('a shelf that still lists a hidden/removed book does not stall sync for everything else', async () => {
  const storage = new Map<string, string>();
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) } });
  storage.set('readlife.sb1', JSON.stringify({ access: 'a', refresh: 'r', exp: Date.now() + 3_600_000, user: { id: 'user-a' } }));
  const oldFetch = globalThis.fetch;
  const tables = new Map<string, Record<string, any>[]>();
  let nextId = 0;
  // Like the real database: library_book_id is a NOT NULL uuid, so '' is rejected
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input)); const table = url.pathname.split('/').pop()!; const method = init.method || 'GET';
    const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (method === 'GET') return res((tables.get(table) || []).filter(r => r.user_id === url.searchParams.get('user_id')?.replace(/^eq\./, '')));
    const payload = init.body ? JSON.parse(String(init.body)) : {};
    if (method === 'POST') {
      if ('library_book_id' in payload && !UUID.test(String(payload.library_book_id))) return res({ message: 'invalid input syntax for type uuid' }, 400);
      const row = { ...payload, id: payload.id || `00000000-0000-5000-8000-${String(++nextId).padStart(12, '0')}`, revision: payload.revision || 1 };
      tables.set(table, [...(tables.get(table) || []), row]);
      return res([row], 201);
    }
    return res([]);
  }) as typeof fetch;
  const priorNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
    const keep = mk('keep'), gone = mk('gone');
    const local = state();
    local.customBooks = [keep]; local.status.keep = 'now';
    local.hiddenBookIds.gone = true; // removed from the library but still listed on a shelf
    const collections = [{ id: 's1', name: 'Favourites', kind: 'shelf' as const, bookIds: ['keep', 'gone'] }];
    assert.equal(await syncLocalLibrary('user-a', { state: local, books: [keep, gone], collections, coverPicks: {} }), true, 'sync completes');
    assert.equal(tables.get('user_library_books')!.length, 1);
    assert.equal(tables.get('user_shelf_books')!.length, 1, 'only the book that has a cloud row is filed on the shelf');
  } finally {
    globalThis.fetch = oldFetch;
    if (priorNav) Object.defineProperty(globalThis, 'navigator', priorNav); else delete (globalThis as any).navigator;
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage); else delete (globalThis as any).localStorage;
  }
});

test('applying the cloud copy keeps shelf entries the cloud has no record of (they are not deletions)', () => {
  const local = state();
  const remote: RemoteLibrarySnapshot = { books: [], annotations: [], shelves: [{ id: 's-cloud', user_id: 'user-a', name: 'Favourites', description: null, sort_order: 0, shelf_data: { local_id: 's1', kind: 'shelf' }, revision: 1, deleted_at: null }], memberships: [], preferences: [], sessions: [] };
  const merged = mergeRemoteLibrary(local, [{ id: 's1', name: 'Favourites', kind: 'shelf', bookIds: ['only-here'] }], remote, {}, true);
  assert.deepEqual(merged.collections.find(c => c.id === 's1')?.bookIds, ['only-here']);
});

test('a shelf entry the cloud marks as removed IS removed when applying the cloud copy', () => {
  const local = state();
  const remote: RemoteLibrarySnapshot = {
    books: [{ id: 'b-cloud', user_id: 'user-a', local_book_id: 'x', catalog_work_id: null, catalog_edition_id: null, status: null, reading_progress: {}, personal_cover: null, book_snapshot: mk('x'), personal_data: {}, revision: 1, deleted_at: null }],
    annotations: [], shelves: [{ id: 's-cloud', user_id: 'user-a', name: 'Favourites', description: null, sort_order: 0, shelf_data: { local_id: 's1', kind: 'shelf' }, revision: 1, deleted_at: null }],
    memberships: [{ id: 'm1', user_id: 'user-a', shelf_id: 's-cloud', library_book_id: 'b-cloud', sort_order: 0, membership_data: { local_book_id: 'x', local_shelf_id: 's1' }, revision: 2, deleted_at: '2026-10-23T00:00:00Z' }],
    preferences: [], sessions: [],
  };
  const merged = mergeRemoteLibrary(local, [{ id: 's1', name: 'Favourites', kind: 'shelf', bookIds: ['x'] }], remote, {}, true);
  assert.deepEqual(merged.collections.find(c => c.id === 's1')?.bookIds, []);
});
