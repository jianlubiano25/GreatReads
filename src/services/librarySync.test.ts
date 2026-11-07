import test from 'node:test';
import assert from 'node:assert/strict';
import type { ReadingState, Book } from '../types';
import { buildLibrarySyncSnapshot, hasLibrarySyncConflicts, hasPendingLibrarySync, markPersonalBookDeleted, mergeInitialLibrarySnapshot, mergeRemoteLibrary, resolveLibraryConflictsToLocal, syncLocalLibrary, type LibraryBookRow, type RemoteLibrarySnapshot } from './librarySync';
import { coverKey } from './books/coverAnalysis';

const state = (): ReadingState => ({
  status: {}, currentPage: {}, totalPages: {}, dailyLog: {}, notes: {}, highlights: {}, goal: 10, readingIntention: '',
  profile: { name: '', photo: '', theme: 'auto' }, customBooks: [], onDeviceOverrides: {}, hiddenBookIds: {}, words: [],
  garden: { v: 1, peaks: { bestStreak: 0, tenPageDays: 0, maxPagesInDay: 0, bestWeekGoalDays: 0, booksFinished: 0, totalPages: 0, highlights: 0, wordsAdded: 0, wordsLearned: 0 }, achievements: {}, plants: {}, placements: {}, celebrated: {}, vine: 0 }, history: {}, ratings: {},
});

const book: Book = { id: 'ol__works_OL123W', title: 'A Test Book', author: 'A. Writer', shelf: 'mine', difficulty: 0, isOnDevice: false, year: '', genre: '', summary: '', authorBio: '', pageCount: 0 };
const row = (extra: Partial<LibraryBookRow> = {}): LibraryBookRow => ({
  id: '11111111-1111-5111-8111-111111111111', user_id: 'user-a', local_book_id: String(book.id), catalog_work_id: null, catalog_edition_id: null,
  status: 'now', reading_progress: { currentPage: 12, totalPages: 240, history: { started: '2026-01-01' } }, personal_cover: { url: 'https://covers.example/book.jpg', source: 'link', t: 1 },
  book_snapshot: book, personal_data: { rating: 4, isCustomBook: true }, revision: 3, deleted_at: null, ...extra,
});

test('sync mapping keeps the GreatReads local ID and maps per-book fields to personal rows', () => {
  const local = state();
  local.customBooks = [book]; local.status[String(book.id)] = 'now'; local.currentPage[String(book.id)] = 12;
  local.totalPages[String(book.id)] = 240; local.notes[String(book.id)] = 'My note'; local.ratings[String(book.id)] = 4;
  local.highlights[String(book.id)] = [{ id: 'hl_local_1', text: 'A quote', page: 8, timestamp: 42 }];
  const snapshot = buildLibrarySyncSnapshot({ userId: 'user-a', state: local, books: [book], collections: [{ id: 'c1', name: 'Favorites', kind: 'shelf', bookIds: [String(book.id)] }], coverPicks: { [coverKey(book)]: { url: 'https://covers.example/mine.jpg', source: 'link', t: 2 } }, libraryIds: new Map(), shelfIds: new Map() });
  assert.equal(snapshot.books[0].local_book_id, 'ol__works_OL123W');
  assert.equal(snapshot.books[0].status, 'now');
  assert.equal(snapshot.books[0].reading_progress.currentPage, 12);
  assert.equal(snapshot.books[0].personal_cover?.url, 'https://covers.example/mine.jpg');
  assert.equal(snapshot.books[0].book_snapshot.id, 'ol__works_OL123W');
  assert.deepEqual(snapshot.annotations.map(x => x.annotation_type).sort(), ['highlight', 'note']);
  assert.equal(snapshot.annotations.find(x => x.annotation_type === 'highlight')?.extra_data.local_annotation_id, 'hl_local_1');
  assert.equal(snapshot.memberships[0].membership_data.local_book_id, 'ol__works_OL123W');
});

test('a book saved only in a custom shelf or tag still gets a personal book row', () => {
  const id = 'catalog-only-book';
  const snapshot = buildLibrarySyncSnapshot({ userId: 'user-a', state: state(), books: [{ ...book, id }], collections: [{ id: 'tag-1', name: 'To discuss', kind: 'tag', bookIds: [id] }], coverPicks: {}, libraryIds: new Map(), shelfIds: new Map() });
  assert.deepEqual(snapshot.books.map(item => item.local_book_id), [id]);
  assert.equal(snapshot.shelves[0].shelf_data.kind, 'tag');
  assert.equal(snapshot.memberships[0].membership_data.local_book_id, id);
});

test('bootstrap merges remote values into empty fields while retaining local IDs and populated data', () => {
  const local = state();
  local.customBooks = [{ ...book, id: 'local-existing', title: 'Local title' }];
  local.status['local-existing'] = 'next'; local.currentPage['local-existing'] = 3;
  const existingRemote = row({ local_book_id: 'local-existing', status: 'now', reading_progress: { currentPage: 22, totalPages: 240 } });
  const newRemote = row({ id: '22222222-2222-5222-8222-222222222222', local_book_id: 'custom-cloud', book_snapshot: { ...book, id: 'custom-cloud', title: 'Cloud custom' }, personal_data: { isCustomBook: true } });
  const merged = mergeInitialLibrarySnapshot(local, [existingRemote, newRemote]);
  assert.equal(merged.customBooks.find(x => x.id === 'local-existing')?.title, 'Local title');
  assert.equal(merged.status['local-existing'], 'next');
  assert.equal(merged.currentPage['local-existing'], 22); // progress is monotonically reconciled
  assert.ok(merged.customBooks.some(x => x.id === 'custom-cloud'));
});

test('remote annotations, shelves, memberships, preferences and personal covers merge without replacing local copies', () => {
  const local = state(); local.notes[String(book.id)] = 'Local note';
  const b = row();
  const remote: RemoteLibrarySnapshot = {
    books: [b], annotations: [
      { id: 'note-id', user_id: 'user-a', library_book_id: b.id, annotation_type: 'note', content: 'Cloud note', quote_text: null, page_reference: null, location_data: {}, extra_data: { local_book_id: String(book.id), local_annotation_id: 'note' }, revision: 1, deleted_at: null },
      { id: 'highlight-id', user_id: 'user-a', library_book_id: b.id, annotation_type: 'highlight', content: 'Cloud quote', quote_text: 'Cloud quote', page_reference: '7', location_data: {}, extra_data: { local_book_id: String(book.id), local_annotation_id: 'remote-hl', timestamp: 9 }, revision: 1, deleted_at: null },
    ],
    shelves: [{ id: 'shelf-uuid', user_id: 'user-a', name: 'Cloud shelf', description: null, sort_order: 0, shelf_data: { local_id: 'shelf-local', kind: 'shelf' }, revision: 1, deleted_at: null }],
    memberships: [{ id: 'membership-uuid', user_id: 'user-a', shelf_id: 'shelf-uuid', library_book_id: b.id, sort_order: 0, membership_data: {}, revision: 1, deleted_at: null }],
    preferences: [{ user_id: 'user-a', preferences: { dailyLog: { '2026-01-01': 5 }, readingIntention: 'Read daily' }, revision: 1 }], sessions: [],
  };
  const merged = mergeRemoteLibrary(local, [], remote);
  assert.equal(merged.state.notes[String(book.id)], 'Local note');
  assert.equal(merged.state.highlights[String(book.id)][0].id, 'remote-hl');
  assert.deepEqual(merged.collections[0].bookIds, [String(book.id)]);
  assert.equal(merged.state.dailyLog['2026-01-01'], 5);
  assert.equal(merged.coverPicks[coverKey(book)]?.url, 'https://covers.example/book.jpg');
});

test('soft-deleted cloud books do not resurrect during initial reconciliation', () => {
  const local = state();
  const deleted = row({ deleted_at: '2026-01-01T00:00:00Z' });
  const merged = mergeInitialLibrarySnapshot(local, [deleted]);
  assert.deepEqual(merged.customBooks, []);
  assert.deepEqual(merged.status, {});
});

test('authenticated sync is account-scoped, retries offline work, and propagates book deletion as a tombstone', async () => {
  const storage = new Map<string, string>();
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value), removeItem: (key: string) => void storage.delete(key) } });
  storage.set('readlife.sb1', JSON.stringify({ access: 'access', refresh: 'refresh', exp: Date.now() + 3_600_000, user: { id: 'user-a' } }));
  const oldFetch = globalThis.fetch;
  const tables = new Map<string, Record<string, any>[]>();
  const names = ['user_library_books', 'user_book_annotations', 'user_shelves', 'user_shelf_books', 'user_reading_sessions', 'user_library_preferences'];
  names.forEach(name => tables.set(name, []));
  let nextId = 0;
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input)); const table = url.pathname.split('/').pop()!; const method = init.method || 'GET';
    const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (method === 'GET') return response((tables.get(table) || []).filter(row => row.user_id === url.searchParams.get('user_id')?.replace(/^eq\./, '')));
    const payload = init.body ? JSON.parse(String(init.body)) : {};
    if (method === 'POST') {
      const id = payload.id || `00000000-0000-5000-8000-${String(++nextId).padStart(12, '0')}`;
      const row = { ...payload, id, revision: payload.revision || 1 };
      tables.set(table, [...(tables.get(table) || []), row]);
      return response([row], 201);
    }
    if (method === 'PATCH') {
      const rows = tables.get(table) || [];
      const row = rows.find(item => item.user_id === url.searchParams.get('user_id')?.replace(/^eq\./, '')
        && (!url.searchParams.has('local_book_id') || item.local_book_id === url.searchParams.get('local_book_id')?.replace(/^eq\./, ''))
        && (!url.searchParams.has('id') || item.id === url.searchParams.get('id')?.replace(/^eq\./, ''))
        && item.revision === Number(url.searchParams.get('revision')?.replace(/^eq\./, '')));
      if (!row) return response([]);
      Object.assign(row, payload);
      return response([row]);
    }
    return response({ message: 'unexpected request' }, 404);
  }) as typeof fetch;
  const priorNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
    const local = state(); local.customBooks = [book]; local.status[String(book.id)] = 'now'; local.notes[String(book.id)] = 'Saved note';
    local.highlights[String(book.id)] = [{ id: 'hl_a', text: 'Saved highlight', page: 12, timestamp: 4 }];
    const collections = [{ id: 'shelf-a', name: 'Favorites', kind: 'shelf' as const, bookIds: [String(book.id)] }];
    assert.equal(await syncLocalLibrary('user-a', { state: local, books: [book], collections, coverPicks: {} }), true);
    const cloudBook = tables.get('user_library_books')![0];
    assert.equal(cloudBook.user_id, 'user-a');
    assert.equal(cloudBook.local_book_id, 'ol__works_OL123W');
    assert.deepEqual(tables.get('user_book_annotations')!.map(row => row.annotation_type).sort(), ['highlight', 'note']);
    assert.equal(tables.get('user_book_annotations')![0].library_book_id, cloudBook.id);
    assert.equal(tables.get('user_shelves')![0].shelf_data.local_id, 'shelf-a');
    assert.equal(tables.get('user_shelf_books')![0].library_book_id, cloudBook.id);
    assert.equal(await syncLocalLibrary('user-b', { state: local, books: [book], collections: [], coverPicks: {} }), false);
    assert.ok(tables.get('user_library_books')!.every(row => row.user_id === 'user-a'));

    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
    assert.equal(await syncLocalLibrary('user-a', { state: local, books: [book], collections, coverPicks: {} }), false);
    assert.equal(hasPendingLibrarySync('user-a'), true);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
    assert.equal(await syncLocalLibrary('user-a', { state: local, books: [book], collections, coverPicks: {} }), true);
    assert.equal(hasPendingLibrarySync('user-a'), false);

    cloudBook.status = 'done'; cloudBook.revision += 1;
    const competingLocal = { ...local, status: { ...local.status, [String(book.id)]: 'next' as const } };
    assert.equal(await syncLocalLibrary('user-a', { state: competingLocal, books: [book], collections, coverPicks: {} }), true);
    assert.equal(hasLibrarySyncConflicts('user-a'), true);
    assert.equal(cloudBook.status, 'done'); // both edits are preserved until a person resolves the conflict
    resolveLibraryConflictsToLocal('user-a');
    assert.equal(await syncLocalLibrary('user-a', { state: competingLocal, books: [book], collections, coverPicks: {} }), true);
    assert.equal(cloudBook.status, 'next'); // explicit resolution permits this device's value
    assert.equal(hasLibrarySyncConflicts('user-a'), false);

    markPersonalBookDeleted(String(book.id));
    assert.equal(await syncLocalLibrary('user-a', { state: state(), books: [book], collections: [], coverPicks: {} }), true);
    assert.ok(tables.get('user_library_books')![0].deleted_at);
    assert.ok(tables.get('user_book_annotations')!.every(row => row.deleted_at));
    assert.ok(tables.get('user_shelf_books')![0].deleted_at);
  } finally {
    globalThis.fetch = oldFetch;
    if (priorNavigator) Object.defineProperty(globalThis, 'navigator', priorNavigator); else delete (globalThis as any).navigator;
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage); else delete (globalThis as any).localStorage;
  }
});
