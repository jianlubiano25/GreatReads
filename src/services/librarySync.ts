import type { Book, ReadingState } from '../types';
import type { Collection } from './libraryCollections';
import { cleanPicks, type CoverPick } from './books/coverPicks';
import { coverKey } from './books/coverAnalysis';
import { currentUser, rest } from './supabase';
import { exportNookLook } from './nookPrefs';
import { dailyPagesSyncEnabled } from './dailyPagesSync';
import { maxTimes, mergeHiddenByTime, mergeWordsByTime, newer, timeKey, timeOf } from './editTimes';
import { mergeAnnotationFirstSync, mergeBookFirstSync, mergeGarden, mergeMembershipFirstSync, mergePreferencesFirstSync, mergeShelfFirstSync, sameFields, stableJson } from './librarySyncMerge';

export type LibraryBookRow = {
  id: string; user_id: string; local_book_id: string; catalog_work_id: string | null; catalog_edition_id: string | null;
  status: string | null; reading_progress: Record<string, unknown>; personal_cover: CoverPick | null;
  book_snapshot: Book; personal_data: Record<string, unknown>; revision: number; created_at?: string; updated_at?: string; deleted_at: string | null;
};
export type AnnotationRow = {
  id: string; user_id: string; library_book_id: string; annotation_type: 'note' | 'highlight' | 'quote' | 'bookmark';
  content: string; quote_text: string | null; page_reference: string | null; location_data: Record<string, unknown>;
  extra_data: Record<string, unknown>; revision: number; created_at?: string; updated_at?: string; deleted_at: string | null;
};
export type ShelfRow = {
  id: string; user_id: string; name: string; description: string | null; sort_order: number;
  shelf_data: Record<string, unknown>; revision: number; created_at?: string; updated_at?: string; deleted_at: string | null;
};
export type ShelfBookRow = {
  id: string; user_id: string; shelf_id: string; library_book_id: string; sort_order: number;
  membership_data: Record<string, unknown>; revision: number; created_at?: string; updated_at?: string; deleted_at: string | null;
};
export type LibraryPreferencesRow = { user_id: string; preferences: Record<string, unknown>; revision: number; updated_at?: string };

export interface LibrarySyncSnapshot {
  books: Omit<LibraryBookRow, 'id' | 'revision' | 'created_at' | 'updated_at'>[];
  annotations: Omit<AnnotationRow, 'revision' | 'created_at' | 'updated_at'>[];
  shelves: Omit<ShelfRow, 'revision' | 'created_at' | 'updated_at'>[];
  memberships: Omit<ShelfBookRow, 'revision' | 'created_at' | 'updated_at'>[];
  preferences: Record<string, unknown>;
}

/** When the user last edited this book's status and rating (only the ones that were ever edited), so a clear can win over an older value. */
const bookTimes = (state: ReadingState, id: string): { times?: Record<string, number> } => {
  const status = timeOf(state.editTimes, 'status', id), rating = timeOf(state.editTimes, 'rating', id);
  return status || rating ? { times: { ...(status ? { status } : {}), ...(rating ? { rating } : {}) } } : {};
};

/** When the user last edited a note or highlight (only if ever stamped); written into the annotation row's extra_data, so no schema change is needed. */
const annoTime = (state: ReadingState, kind: 'note' | 'highlight', id: string): { edited_at?: number } => { const at = timeOf(state.editTimes, kind, id); return at ? { edited_at: at } : {}; };

const hasOwnData = (state: ReadingState, id: string, collections: Collection[]) => !!(
  state.status[id] || state.currentPage[id] || state.totalPages[id] || state.notes[id] || state.highlights[id]?.length
  || state.history[id] || state.ratings[id] || state.customBooks.some(book => String(book.id) === id)
  || timeOf(state.editTimes, 'status', id) > 0 || timeOf(state.editTimes, 'rating', id) > 0
  || collections.some(collection => collection.bookIds.includes(id))
);

/** Shape personal data for the existing Supabase tables without changing GreatReads' text Book.id values. */
export function buildLibrarySyncSnapshot(args: {
  userId: string; state: ReadingState; books: Book[]; collections: Collection[]; coverPicks: Record<string, CoverPick>;
  libraryIds: ReadonlyMap<string, string>; shelfIds: ReadonlyMap<string, string>;
}): LibrarySyncSnapshot {
  const { userId, state, books, collections, coverPicks, libraryIds, shelfIds } = args;
  const bookById = new Map(books.map(book => [String(book.id), book]));
  const customById = new Map(state.customBooks.map(book => [String(book.id), book]));
  const candidateIds = new Set([
    ...Object.keys(state.status), ...Object.keys(state.currentPage), ...Object.keys(state.totalPages), ...Object.keys(state.notes),
    ...Object.keys(state.highlights), ...Object.keys(state.history), ...Object.keys(state.ratings),
    ...Object.keys(state.editTimes || {}).filter(key => key.startsWith('status:') || key.startsWith('rating:')).map(key => key.slice(key.indexOf(':') + 1)),
    ...state.customBooks.map(book => String(book.id)),
    ...collections.flatMap(collection => collection.bookIds),
  ]);
  for (const book of books) if (coverPicks[coverKey(book)]) candidateIds.add(String(book.id));
  const booksOut: LibrarySyncSnapshot['books'] = [];
  for (const localId of candidateIds) {
    if (state.hiddenBookIds[localId]) continue;
    const book = customById.get(localId) || bookById.get(localId);
    if (!book) continue;
    if (!hasOwnData(state, localId, collections) && !coverPicks[coverKey(book)]) continue;
    booksOut.push({
      user_id: userId,
      local_book_id: localId,
      catalog_work_id: null,
      catalog_edition_id: null,
      status: state.status[localId] || null,
      reading_progress: { currentPage: state.currentPage[localId] || 0, totalPages: state.totalPages[localId] || 0, history: state.history[localId] || null },
      personal_cover: coverPicks[coverKey(book)] || null,
      book_snapshot: customById.get(localId) || book,
      // "On this device" (downloaded for offline) is device-local and never synced; writeRemoteLibrary keeps whatever the cloud already holds here.
      personal_data: { rating: state.ratings[localId] || null, onDevice: null, isCustomBook: customById.has(localId), ...bookTimes(state, localId) },
      deleted_at: null,
    });
  }

  const libraryIdByLocal = new Map<string, string>(libraryIds);
  const annotations: LibrarySyncSnapshot['annotations'] = [];
  for (const localId of candidateIds) {
    const libraryBookId = libraryIdByLocal.get(localId) || '';
    if (state.hiddenBookIds[localId]) continue;
    const note = state.notes[localId];
    if (note?.trim()) annotations.push({ id: annotationUuid(userId, localId, 'note', 'note'), user_id: userId, library_book_id: libraryBookId, annotation_type: 'note', content: note, quote_text: null, page_reference: null, location_data: {}, extra_data: { local_book_id: localId, local_annotation_id: 'note', ...annoTime(state, 'note', localId) }, deleted_at: null });
    for (const highlight of state.highlights[localId] || []) annotations.push({ id: annotationUuid(userId, localId, 'highlight', highlight.id), user_id: userId, library_book_id: libraryBookId, annotation_type: 'highlight', content: highlight.text, quote_text: highlight.text, page_reference: highlight.page == null ? null : String(highlight.page), location_data: highlight.page == null ? {} : { page: highlight.page }, extra_data: { local_book_id: localId, local_annotation_id: highlight.id, timestamp: highlight.timestamp, ...annoTime(state, 'highlight', `${localId}:${highlight.id}`) }, deleted_at: null });
  }

  const activeCollections = collections.filter(item => !isDeletedLocally(userId, `collection:${item.id}`));
  const shelves: LibrarySyncSnapshot['shelves'] = activeCollections.map((collection, index) => ({
    id: shelfIds.get(collection.id) || deterministicUuid(userId, 'shelf', collection.id), user_id: userId,
    name: collection.name, description: null, sort_order: index,
    shelf_data: { local_id: collection.id, kind: collection.kind }, deleted_at: null,
  }));
  const membershipRows: LibrarySyncSnapshot['memberships'] = [];
  for (const collection of activeCollections) {
    const shelfId = shelfIds.get(collection.id) || deterministicUuid(userId, 'shelf', collection.id);
    collection.bookIds.forEach((localBookId, index) => {
      const libraryBookId = libraryIdByLocal.get(localBookId) || '';
      const localMembershipId = `${collection.id}|${localBookId}`;
      if (isDeletedLocally(userId, `membership:${collection.id}:${localBookId}`)) return;
      membershipRows.push({ id: deterministicUuid(userId, 'membership', localMembershipId), user_id: userId, shelf_id: shelfId, library_book_id: libraryBookId, sort_order: index, membership_data: { local_id: localMembershipId, local_shelf_id: collection.id, local_book_id: localBookId }, deleted_at: null });
    });
  }

  // Keep every non-book-scoped backup field recoverable. Book-scoped fields are normalized into their own records above.
  const preferences = {
    goal: state.goal, readingIntention: state.readingIntention, profile: state.profile, dailyLog: state.dailyLog,
    words: state.words, garden: state.garden, hiddenBookIds: state.hiddenBookIds, onDeviceOverrides: {},
    coverPicks, nookLook: exportNookLook() || null,
    // Phase 3: when words / hidden books were last edited, and which words were deleted (written only once something has been stamped)
    ...(Object.keys(maxTimes(state.editTimes, undefined, ['word:', 'hidden:'])).length ? { editTimes: maxTimes(state.editTimes, undefined, ['word:', 'hidden:']) } : {}),
    ...(state.deletedWords && Object.keys(state.deletedWords).length ? { deletedWords: state.deletedWords } : {}),
  };
  return { books: booksOut, annotations, shelves, memberships: membershipRows, preferences };
}

/** Merge a fully fetched initial cloud snapshot without dropping local entries or replacing populated local values with blanks. */
export function mergeInitialLibrarySnapshot(local: ReadingState, rows: LibraryBookRow[], preferRemote = false): ReadingState {
  const next: ReadingState = { ...local, status: { ...local.status }, currentPage: { ...local.currentPage }, totalPages: { ...local.totalPages }, notes: { ...local.notes }, highlights: { ...local.highlights }, history: { ...local.history }, ratings: { ...local.ratings }, customBooks: [...local.customBooks] };
  const custom = new Map(next.customBooks.map(book => [String(book.id), book]));
  for (const row of rows) {
    if (row.deleted_at || !row.local_book_id) continue;
    const id = row.local_book_id;
    const snapshot = row.book_snapshot;
    if (snapshot?.id != null && String(snapshot.id) === id && row.personal_data?.isCustomBook && (!custom.has(id) || preferRemote)) {
      custom.set(id, snapshot);
    }
    const rowTimes = (row.personal_data?.times && typeof row.personal_data.times === 'object' ? row.personal_data.times : {}) as Record<string, number>;
    const statusSide = newer(timeOf(next.editTimes, 'status', id), Number(rowTimes.status) || 0);
    if (statusSide === 'remote') {
      if (row.status) next.status[id] = row.status as ReadingState['status'][string]; else delete next.status[id]; // the cloud's clear is a real, newer edit
      next.editTimes = { ...(next.editTimes || {}), [timeKey('status', id)]: Number(rowTimes.status) };
    } else if (statusSide === 'same' && row.status && (preferRemote || !next.status[id])) next.status[id] = row.status as ReadingState['status'][string];
    const progress = row.reading_progress || {};
    if (preferRemote && progress.currentPage !== undefined) next.currentPage[id] = Number(progress.currentPage) || 0;
    else if (Number(progress.currentPage) > Number(next.currentPage[id] || 0)) next.currentPage[id] = Number(progress.currentPage);
    if (Number(progress.totalPages) > 0 && (preferRemote || !next.totalPages[id])) next.totalPages[id] = Number(progress.totalPages);
    if (progress.history && typeof progress.history === 'object' && (preferRemote || !next.history[id])) next.history[id] = progress.history as ReadingState['history'][string];
    const rating = Number(row.personal_data?.rating);
    const ratingSide = newer(timeOf(next.editTimes, 'rating', id), Number(rowTimes.rating) || 0);
    if (ratingSide === 'remote') {
      if (Number.isFinite(rating) && rating > 0) next.ratings[id] = rating; else delete next.ratings[id];
      next.editTimes = { ...(next.editTimes || {}), [timeKey('rating', id)]: Number(rowTimes.rating) };
    } else if (ratingSide === 'same' && (preferRemote || !next.ratings[id]) && Number.isFinite(rating) && rating > 0) next.ratings[id] = rating;
  }
  next.customBooks = [...custom.values()];
  return next;
}

export type RemoteLibrarySnapshot = { books: LibraryBookRow[]; annotations: AnnotationRow[]; shelves: ShelfRow[]; memberships: ShelfBookRow[]; preferences: LibraryPreferencesRow[]; sessions: Record<string, unknown>[] };
const PAGE_SIZE = 500;
async function readOwned<T>(table: string, userId: string, order = 'id.asc'): Promise<T[] | null> {
  const all: T[] = [];
  for (let offset = 0; offset < 10000; offset += PAGE_SIZE) {
    const r = await rest<T[]>(`${table}?user_id=eq.${encodeURIComponent(userId)}&select=*&order=${order}&limit=${PAGE_SIZE}&offset=${offset}`);
    if (!r.ok || !Array.isArray(r.data)) return null;
    all.push(...r.data);
    if (r.data.length < PAGE_SIZE) return all;
  }
  return null;
}

export async function loadRemoteLibrary(userId: string): Promise<RemoteLibrarySnapshot | null> {
  const [books, annotations, shelves, memberships, preferences, sessions] = await Promise.all([
    readOwned<LibraryBookRow>('user_library_books', userId), readOwned<AnnotationRow>('user_book_annotations', userId),
    readOwned<ShelfRow>('user_shelves', userId), readOwned<ShelfBookRow>('user_shelf_books', userId),
    readOwned<LibraryPreferencesRow>('user_library_preferences', userId, 'user_id.asc'),
    // Reading sessions are read for a complete bootstrap, but not synthesized from daily page totals.
    readOwned<Record<string, unknown>>('user_reading_sessions', userId),
  ]);
  if (!books || !annotations || !shelves || !memberships || !preferences || !sessions) return null;
  return { books, annotations, shelves, memberships, preferences, sessions };
}

/** Fill empty local fields from cloud during bootstrap; local values and IDs always survive. Records named in `paused` (conflicted, awaiting the user's choice) are left exactly as they are on this device. */
export function mergeRemoteLibrary(local: ReadingState, collections: Collection[], remote: RemoteLibrarySnapshot, localCoverPicks: Record<string, CoverPick> = {}, preferRemote = false, paused: ReadonlySet<string> = new Set()): { state: ReadingState; collections: Collection[]; coverPicks: Record<string, CoverPick>; nookLook: unknown } {
  const userId = remote.preferences[0]?.user_id || remote.books[0]?.user_id || '';
  const deleted = userId ? localDeletionSet(userId) : new Set<string>();
  const applyBooks = remote.books.filter(row => !paused.has(`book:${row.local_book_id}`));
  const acceptedBooks = applyBooks.filter(row => !deleted.has(row.local_book_id));
  const state = mergeInitialLibrarySnapshot(local, acceptedBooks, preferRemote);
  if (preferRemote) for (const row of applyBooks) if (row.deleted_at) {
    const id = row.local_book_id;
    state.customBooks = state.customBooks.filter(book => String(book.id) !== id);
    for (const field of ['status', 'currentPage', 'totalPages', 'notes', 'highlights', 'history', 'ratings', 'onDeviceOverrides'] as const) {
      const { [id]: _removed, ...rest } = state[field];
      state[field] = rest as never;
    }
    state.hiddenBookIds[id] = true;
  }
  const bookIdByCloud = new Map(remote.books.map(row => [row.id, row.local_book_id]));
  const annotationsByBook = new Map<string, AnnotationRow[]>();
  for (const row of remote.annotations) {
    const bookId = String(row.extra_data?.local_book_id || bookIdByCloud.get(row.library_book_id) || '');
    const annotationId = String(row.extra_data?.local_annotation_id || (row.annotation_type === 'note' ? 'note' : row.id));
    if (paused.has(`annotation:${row.id}`) || deleted.has(bookId) || deleted.has(`annotation:${bookId}:${annotationId}`)) continue;
    if (row.deleted_at) {
      // A delete applies only if this device has no LATER edit of the same note/highlight (a later edit brings it back instead)
      const at = Number(row.extra_data?.edited_at) || 0;
      if (preferRemote && row.annotation_type === 'note' && newer(timeOf(state.editTimes, 'note', bookId), at) !== 'local') delete state.notes[bookId];
      if (preferRemote && (row.annotation_type === 'highlight' || row.annotation_type === 'quote') && newer(timeOf(state.editTimes, 'highlight', `${bookId}:${annotationId}`), at) !== 'local') state.highlights[bookId] = (state.highlights[bookId] || []).filter(item => item.id !== annotationId);
      continue;
    }
    const id = bookIdByCloud.get(row.library_book_id);
    if (!id) continue;
    const list = annotationsByBook.get(id) || [];
    list.push(row);
    annotationsByBook.set(id, list);
  }
  const stampLocal = (kind: 'note' | 'highlight', key: string, at: number) => { if (at > 0) state.editTimes = { ...(state.editTimes || {}), [timeKey(kind, key)]: at }; };
  for (const [id, entries] of annotationsByBook) {
    for (const row of entries) {
      const at = Number(row.extra_data?.edited_at) || 0;
      if (row.annotation_type === 'note') {
        const side = newer(timeOf(state.editTimes, 'note', id), at);
        if (side === 'remote') { state.notes[id] = row.content; stampLocal('note', id, at); }
        else if (side === 'same' && (preferRemote || !state.notes[id])) state.notes[id] = row.content;
        continue;
      }
      if (row.annotation_type !== 'highlight' && row.annotation_type !== 'quote') continue;
      const localId = String(row.extra_data?.local_annotation_id || row.id);
      const highlight = { id: localId, text: row.content, page: Number(row.page_reference) || undefined, timestamp: Number(row.extra_data?.timestamp) || 0 };
      const current = state.highlights[id] || [];
      const side = newer(timeOf(state.editTimes, 'highlight', `${id}:${localId}`), at);
      if (!current.some(item => item.id === localId)) { if (side !== 'local') { state.highlights[id] = [...current, highlight]; stampLocal('highlight', `${id}:${localId}`, at); } }
      else if (side === 'remote' || (side === 'same' && preferRemote)) { state.highlights[id] = current.map(item => item.id === localId ? highlight : item); stampLocal('highlight', `${id}:${localId}`, at); }
    }
  }
  const mergedCollections = new Map(collections.map(item => [item.id, { ...item, bookIds: [...item.bookIds] }]));
  // Applying the cloud copy removes only what the cloud explicitly marks as removed; entries it has no record of stay (they are not deletions).
  if (preferRemote) {
    const removed = new Set(remote.memberships.filter(row => row.deleted_at && !paused.has(`membership:${row.id}`)).map(row => `${String(row.membership_data?.local_shelf_id || '')}|${String(row.membership_data?.local_book_id || bookIdByCloud.get(row.library_book_id) || '')}`));
    for (const collection of mergedCollections.values()) collection.bookIds = collection.bookIds.filter(id => !removed.has(`${collection.id}|${id}`));
  }
  const coverPicks = { ...localCoverPicks };
  for (const row of applyBooks) {
    if (row.deleted_at || !row.personal_cover || !row.book_snapshot) continue;
    const key = coverKey(row.book_snapshot);
    if (key && (preferRemote || !coverPicks[key])) coverPicks[key] = row.personal_cover;
  }
  const localByShelf = new Map(remote.shelves.filter(row => !row.deleted_at).map(row => [row.id, String(row.shelf_data?.local_id || row.id)]));
  for (const row of remote.shelves) {
    const id = String(row.shelf_data?.local_id || '');
    if (!id || deleted.has(`collection:${id}`) || paused.has(`shelf:${id}`)) continue;
    if (row.deleted_at) { if (preferRemote) mergedCollections.delete(id); continue; }
    const existing = mergedCollections.get(id);
    if (!existing || preferRemote) mergedCollections.set(id, { id, name: row.name, kind: row.shelf_data?.kind === 'tag' ? 'tag' : 'shelf', bookIds: existing?.bookIds || [] });
  }
  const collectionById = mergedCollections;
  for (const row of remote.memberships) {
    if (row.deleted_at || paused.has(`membership:${row.id}`)) continue;
    const collectionId = localByShelf.get(row.shelf_id);
    if (collectionId && deleted.has(`collection:${collectionId}`)) continue;
    const localBookId = bookIdByCloud.get(row.library_book_id);
    const collection = collectionId && collectionById.get(collectionId);
    if (collection && localBookId && !collection.bookIds.includes(localBookId)) collection.bookIds.push(localBookId);
  }
  const pref = paused.has('preferences') ? undefined : remote.preferences.find(row => row.user_id && row.preferences && typeof row.preferences === 'object')?.preferences;
  let nookLook: unknown = exportNookLook() || null;
  if (pref) {
    if (pref.coverPicks && typeof pref.coverPicks === 'object') {
      const remotePicks = cleanPicks(pref.coverPicks);
      if (preferRemote) { for (const key of Object.keys(coverPicks)) delete coverPicks[key]; Object.assign(coverPicks, remotePicks); }
      else Object.assign(coverPicks, Object.fromEntries(Object.entries(remotePicks).filter(([key]) => !coverPicks[key])));
    }
    if (pref.nookLook && (preferRemote || !nookLook)) nookLook = pref.nookLook;
    if (pref.dailyLog && typeof pref.dailyLog === 'object') {
      const remoteLog = pref.dailyLog as ReadingState['dailyLog'];
      if (dailyPagesSyncEnabled()) {
        // Per-day records own the days now. This old copy is only a one-time import: it fills days this device has none for, or raises a day nobody
        // has ever edited (no stamp), as dailyLog has always merged. It never overwrites a stamped day, so a stale copy cannot undo an edit.
        state.dailyLog = { ...state.dailyLog };
        for (const [day, pages] of Object.entries(remoteLog)) {
          const mine = state.dailyLog[day];
          if (mine === undefined || (!state.dailyLogMeta?.[day] && Number(pages) > mine)) state.dailyLog[day] = Number(pages) || 0;
        }
      } else for (const [day, pages] of Object.entries(remoteLog)) state.dailyLog[day] = preferRemote ? pages : Math.max(state.dailyLog[day] || 0, pages || 0);
    }
    if ((preferRemote || state.goal === 10) && Number(pref.goal) > 0) state.goal = Number(pref.goal);
    if ((preferRemote || !state.readingIntention) && typeof pref.readingIntention === 'string') state.readingIntention = pref.readingIntention;
    if (pref.profile && typeof pref.profile === 'object') {
      const profile = pref.profile as ReadingState['profile'];
      state.profile = { name: preferRemote || !state.profile.name ? profile.name : state.profile.name, photo: preferRemote || !state.profile.photo ? profile.photo : state.profile.photo, theme: preferRemote || state.profile.theme === 'auto' ? profile.theme : state.profile.theme };
    }
    {
      const remoteTimes = (pref.editTimes && typeof pref.editTimes === 'object' ? pref.editTimes : {}) as Record<string, number>;
      const remoteDeleted = (pref.deletedWords && typeof pref.deletedWords === 'object' ? pref.deletedWords : {}) as Record<string, number>;
      if (Array.isArray(pref.words) || Object.keys(remoteDeleted).length) {
        const merged = mergeWordsByTime({ words: state.words, times: state.editTimes, deleted: state.deletedWords }, { words: Array.isArray(pref.words) ? pref.words as ReadingState['words'] : [], times: remoteTimes, deleted: remoteDeleted });
        state.words = merged.words;
        state.deletedWords = merged.deleted;
        state.editTimes = { ...(state.editTimes || {}), ...Object.fromEntries(Object.entries(state.editTimes || {}).filter(([k]) => !k.startsWith('word:'))), ...merged.times };
      }
      if ((pref.hiddenBookIds && typeof pref.hiddenBookIds === 'object') || Object.keys(remoteTimes).some(k => k.startsWith('hidden:'))) {
        const merged = mergeHiddenByTime({ hidden: state.hiddenBookIds, times: state.editTimes }, { hidden: (pref.hiddenBookIds || {}) as ReadingState['hiddenBookIds'], times: remoteTimes });
        state.hiddenBookIds = merged.hidden;
        state.editTimes = { ...Object.fromEntries(Object.entries(state.editTimes || {}).filter(([k]) => !k.startsWith('hidden:'))), ...merged.times };
      }
    }
    if (pref.garden && typeof pref.garden === 'object') state.garden = mergeGarden(state.garden, pref.garden as ReadingState['garden']);
  }
  return { state, collections: [...mergedCollections.values()], coverPicks, nookLook };
}

const qUser = (userId: string) => `user_id=eq.${encodeURIComponent(userId)}`;
const PENDING_PREFIX = 'readlife.librarySyncPending1.';
const OWNER_KEY = 'readlife.librarySyncOwner1';
export function librarySyncAccountAllowed(userId: string): boolean { try { const owner = localStorage.getItem(OWNER_KEY); return !owner || owner === userId; } catch { return false; } }
export function claimLibrarySyncAccount(userId: string): void { try { if (!localStorage.getItem(OWNER_KEY)) localStorage.setItem(OWNER_KEY, userId); } catch {} }
const VERSION_PREFIX = 'readlife.librarySyncVersions1.';
type SyncVersions = { revisions: Record<string, number>; conflicts: string[] };
const versionsKey = (userId: string) => `${VERSION_PREFIX}${encodeURIComponent(userId)}`;
function getVersions(userId: string): SyncVersions {
  try { const raw = JSON.parse(localStorage.getItem(versionsKey(userId)) || 'null'); return { revisions: raw?.revisions || {}, conflicts: Array.isArray(raw?.conflicts) ? raw.conflicts : [] }; } catch { return { revisions: {}, conflicts: [] }; }
}
function saveVersions(userId: string, versions: SyncVersions) {
  try { localStorage.setItem(versionsKey(userId), JSON.stringify(versions)); } catch {}
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('greatreads-library-sync-status'));
}
export function hasLibrarySyncConflicts(userId: string): boolean { return getVersions(userId).conflicts.length > 0; }
/** Record keys paused on this device (they changed on both sides). Cloud refreshes must leave these alone. */
export function pausedLibraryKeys(userId: string): Set<string> { return new Set(getVersions(userId).conflicts); }
function cloudRevisionOfKey(remote: RemoteLibrarySnapshot, key: string): number | undefined {
  const [kind, ...rest] = key.split(':'); const id = rest.join(':');
  if (kind === 'preferences') return remote.preferences[0]?.revision;
  if (kind === 'book') return remote.books.find(row => row.local_book_id === id)?.revision;
  if (kind === 'shelf') return remote.shelves.find(row => String(row.shelf_data?.local_id || '') === id)?.revision;
  if (kind === 'annotation') return remote.annotations.find(row => row.id === id)?.revision;
  if (kind === 'membership') return remote.memberships.find(row => row.id === id)?.revision;
  return undefined;
}
/**
 * After this device has taken the cloud's copy of what changed (a refresh with the cloud winning), its baseline for each record it
 * has synced before moves to the cloud's current revision. Without this, the next edit of such a record would look like a change on
 * both sides and be paused as a conflict, although this device had already seen the cloud's change. Only records that already have a
 * baseline move (a never-synced record is first merged and written, never assumed equal), and paused records are never touched.
 */
export function acknowledgeCloudCopy(userId: string, remote: RemoteLibrarySnapshot): void {
  if (currentUser()?.id !== userId) return;
  const versions = getVersions(userId);
  const paused = new Set(versions.conflicts);
  let changed = false;
  const move = (key: string, revision: number | undefined) => {
    if (revision === undefined || paused.has(key) || versions.revisions[key] === undefined || versions.revisions[key] === revision) return;
    versions.revisions[key] = revision; changed = true;
  };
  for (const row of remote.books) move(`book:${row.local_book_id}`, row.revision);
  for (const row of remote.annotations) move(`annotation:${row.id}`, row.revision);
  for (const row of remote.shelves) move(`shelf:${String(row.shelf_data?.local_id || '')}`, row.revision);
  for (const row of remote.memberships) move(`membership:${row.id}`, row.revision);
  move('preferences', remote.preferences[0]?.revision);
  if (changed) saveVersions(userId, versions);
}
/**
 * "Use cloud": accept the cloud copy of every paused record. Each paused record's baseline becomes the cloud revision it now matches,
 * so nothing is re-flagged. The caller then applies the cloud copy to this device (and should save a JSON backup before this).
 */
export function resolveLibraryConflictsToCloud(userId: string, remote: RemoteLibrarySnapshot): void {
  if (currentUser()?.id !== userId) return;
  const versions = getVersions(userId);
  for (const key of versions.conflicts) {
    const revision = cloudRevisionOfKey(remote, key);
    if (revision === undefined) delete versions.revisions[key]; else versions.revisions[key] = revision;
  }
  versions.conflicts = [];
  saveVersions(userId, versions);
}
export function requestLibraryUseCloud(userId: string): void {
  if (currentUser()?.id !== userId || typeof window === 'undefined') return;
  window.dispatchEvent(new Event('greatreads-library-use-cloud'));
}
export function resolveLibraryConflictsToLocal(userId: string): void {
  if (currentUser()?.id !== userId) return;
  const versions = getVersions(userId);
  versions.conflicts = [];
  saveVersions(userId, versions);
  setPendingLibrarySync(userId, true);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('greatreads-library-sync-request'));
}
const DELETED_PREFIX = 'readlife.librarySyncDeleted1.';
const deletedKey = (userId: string) => `${DELETED_PREFIX}${encodeURIComponent(userId)}`;
function localDeletionSet(userId: string): Set<string> {
  try { const raw = JSON.parse(localStorage.getItem(deletedKey(userId)) || '[]'); return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []); } catch { return new Set(); }
}
function saveDeletionSet(userId: string, set: Set<string>) { try { set.size ? localStorage.setItem(deletedKey(userId), JSON.stringify([...set])) : localStorage.removeItem(deletedKey(userId)); } catch {} }
export function markPersonalBookDeleted(localId: string): void {
  const userId = currentUser()?.id; if (!userId) return;
  const deleted = localDeletionSet(userId); deleted.add(localId); saveDeletionSet(userId, deleted);
}
export function markPersonalAnnotationDeleted(localBookId: string, localAnnotationId: string): void {
  const userId = currentUser()?.id; if (!userId) return;
  const deleted = localDeletionSet(userId); deleted.add(`annotation:${localBookId}:${localAnnotationId}`); saveDeletionSet(userId, deleted);
}
export function unmarkPersonalAnnotationDeleted(localBookId: string, localAnnotationId: string): void {
  const userId = currentUser()?.id; if (!userId) return;
  const deleted = localDeletionSet(userId); if (deleted.delete(`annotation:${localBookId}:${localAnnotationId}`)) saveDeletionSet(userId, deleted);
}
export function markPersonalCollectionDeleted(localId: string, userId = currentUser()?.id): void {
  if (!userId) return;
  const deleted = localDeletionSet(userId); deleted.add(`collection:${localId}`); saveDeletionSet(userId, deleted);
}
export function markPersonalMembershipDeleted(localCollectionId: string, localBookId: string, userId = currentUser()?.id): void {
  if (!userId) return;
  const deleted = localDeletionSet(userId); deleted.add(`membership:${localCollectionId}:${localBookId}`); saveDeletionSet(userId, deleted);
}
export function clearPersonalDeletionMarkers(userId: string): void { saveDeletionSet(userId, new Set()); }
const isDeletedLocally = (userId: string, localId: string) => localDeletionSet(userId).has(localId);

export const hasPendingLibrarySync = (userId: string): boolean => { try { return localStorage.getItem(`${PENDING_PREFIX}${encodeURIComponent(userId)}`) === '1'; } catch { return false; } };
const setPendingLibrarySync = (userId: string, pending: boolean) => {
  try { pending ? localStorage.setItem(`${PENDING_PREFIX}${encodeURIComponent(userId)}`, '1') : localStorage.removeItem(`${PENDING_PREFIX}${encodeURIComponent(userId)}`); } catch {}
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('greatreads-library-sync-status'));
};

export async function syncLocalLibrary(userId: string, args: { state: ReadingState; books: Book[]; collections: Collection[]; coverPicks: Record<string, CoverPick> }): Promise<boolean> {
  if (currentUser()?.id !== userId || !librarySyncAccountAllowed(userId) || (typeof navigator !== 'undefined' && navigator.onLine === false)) { setPendingLibrarySync(userId, true); return false; }
  setPendingLibrarySync(userId, true);
  const remote = await loadRemoteLibrary(userId);
  if (!remote || currentUser()?.id !== userId) return false;
  const libraryIds = new Map(remote.books.map(row => [row.local_book_id, row.id]));
  const shelfIds = new Map(remote.shelves.map(row => [String(row.shelf_data?.local_id || ''), row.id]));
  const safeState = { ...args.state, customBooks: args.state.customBooks.filter(book => !isDeletedLocally(userId, String(book.id))) };
  const snapshot = buildLibrarySyncSnapshot({ userId, ...args, state: safeState, libraryIds, shelfIds });
  const result = await writeRemoteLibrary(userId, snapshot, remote, args.state.editTimes);
  setPendingLibrarySync(userId, !result.ok);
  if (result.ok && !result.conflict) clearPersonalDeletionMarkers(userId);
  if (result.ok) claimLibrarySyncAccount(userId);
  return result.ok;
}

async function casUpdate(table: string, userId: string, filter: string, revision: number, body: Record<string, unknown>): Promise<boolean> {
  const extra = filter ? `&${filter}` : '';
  const r = await rest<unknown[]>(`${table}?${qUser(userId)}${extra}&revision=eq.${revision}`, { method: 'PATCH', prefer: 'return=representation', body: { ...body, revision: revision + 1 } });
  return r.ok && Array.isArray(r.data) && r.data.length === 1;
}

/** Write one complete, already-reconciled local snapshot. CAS revisions prevent silently overwriting a simultaneous device edit. */
export async function writeRemoteLibrary(userId: string, snapshot: LibrarySyncSnapshot, remote: RemoteLibrarySnapshot, editTimes?: Record<string, number>): Promise<{ ok: boolean; conflict?: boolean; libraryIds?: Map<string, string>; shelfIds?: Map<string, string> }> {
  if (currentUser()?.id !== userId || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { ok: false };
  const versions = getVersions(userId);
  /**
   * Decides whether a record is written. A record this device has never synced (no baseline) is merged field by field with the
   * cloud copy instead of being flagged: only two different non-empty values in the same field are a real conflict, and
   * then just this record pauses. A record that changed in the cloud after this device's baseline is still a conflict.
   */
  const gate = (key: string, revision: number, equal: boolean, merge?: () => Record<string, unknown> | null, sameAsCloud?: (merged: Record<string, unknown>) => boolean): { write: boolean; merged?: Record<string, unknown> } => {
    if (versions.conflicts.includes(key)) return { write: false };
    if (equal) { versions.revisions[key] = revision; return { write: false }; }
    const baseline = versions.revisions[key];
    if (baseline === revision) return { write: true };
    if (baseline === undefined && merge) {
      const merged = merge();
      if (merged) {
        versions.revisions[key] = revision; // the write below is a compare-and-swap against exactly this revision
        return sameAsCloud?.(merged) ? { write: false } : { write: true, merged };
      }
    }
    versions.revisions[key] = revision;
    versions.conflicts.push(key);
    return { write: false };
  };
  const markWritten = (key: string, revision: number) => { versions.revisions[key] = revision; saveVersions(userId, versions); };
  const bookRows = new Map(remote.books.map(row => [row.local_book_id, row]));
  const libraryIds = new Map(remote.books.map(row => [row.local_book_id, row.id]));
  for (const item of snapshot.books) {
    const old = bookRows.get(item.local_book_id);
    if (!old) {
      const key = `book:${item.local_book_id}`;
      if (versions.revisions[key] !== undefined || versions.conflicts.includes(key)) { versions.conflicts.push(key); saveVersions(userId, versions); continue; }
      const made = await rest<LibraryBookRow[]>('user_library_books', { method: 'POST', prefer: 'return=representation', body: { ...item, revision: 1 } });
      if (!made.ok) return { ok: false, conflict: made.status === 409 };
      if (!made.data?.[0]) return { ok: false, conflict: true };
      libraryIds.set(item.local_book_id, made.data[0].id);
      markWritten(key, Number(made.data[0].revision) || 1);
      continue;
    }
    libraryIds.set(item.local_book_id, old.id);
    const body = { ...item, id: old.id, catalog_work_id: old.catalog_work_id, catalog_edition_id: old.catalog_edition_id, personal_data: { ...item.personal_data, onDevice: old.personal_data?.onDevice ?? null } } as Record<string, unknown>;
    const key = `book:${item.local_book_id}`;
    const gated = gate(key, old.revision, equalSyncRecord(old, body), () => mergeBookFirstSync(old, item), merged => equalSyncRecord(old, { ...body, ...merged }));
    if (!gated.write) continue;
    const ok = await casUpdate('user_library_books', userId, `local_book_id=eq.${encodeURIComponent(item.local_book_id)}`, old.revision, gated.merged ? { ...body, ...gated.merged } : body);
    if (!ok) return { ok: false, conflict: true };
    markWritten(key, old.revision + 1);
  }
  const shelfRows = new Map(remote.shelves.map(row => [String(row.shelf_data?.local_id || ''), row]));
  const shelfIds = new Map(remote.shelves.map(row => [String(row.shelf_data?.local_id || ''), row.id]));
  for (const item of snapshot.shelves) {
    const localId = String(item.shelf_data.local_id || '');
    const old = shelfRows.get(localId);
    if (!old) {
      const key = `shelf:${localId}`;
      if (versions.revisions[key] !== undefined || versions.conflicts.includes(key)) { versions.conflicts.push(key); saveVersions(userId, versions); continue; }
      const made = await rest<ShelfRow[]>('user_shelves', { method: 'POST', prefer: 'return=representation', body: { ...item, revision: 1 } });
      if (!made.ok) return { ok: false, conflict: made.status === 409 };
      if (!made.data?.[0]) return { ok: false, conflict: true };
      shelfIds.set(localId, made.data[0].id);
      markWritten(key, Number(made.data[0].revision) || 1);
    } else {
      shelfIds.set(localId, old.id);
      const key = `shelf:${localId}`;
      const body = { name: item.name, description: item.description, sort_order: item.sort_order, shelf_data: item.shelf_data, deleted_at: null };
      const equal = old.name === item.name && old.description === item.description && old.sort_order === item.sort_order && stableJson(old.shelf_data) === stableJson(item.shelf_data) && !old.deleted_at;
      const gated = gate(key, old.revision, equal, () => mergeShelfFirstSync(old, item), merged => sameFields(old, merged, SHELF_FIELDS));
      if (gated.write) {
        if (!await casUpdate('user_shelves', userId, `id=eq.${old.id}`, old.revision, gated.merged ? { ...body, ...gated.merged } : body)) return { ok: false, conflict: true };
        markWritten(key, old.revision + 1);
      }
    }
  }
  const snapshotWithIds = buildSnapshotWithIds(snapshot, libraryIds, shelfIds);
  // Annotation and membership rows carry stable UUIDs; the table PK makes network retries idempotent.
  for (const row of snapshotWithIds.annotations) {
    const old = remote.annotations.find(item => item.id === row.id);
    if (!old) {
      const key = `annotation:${row.id}`;
      if (versions.revisions[key] !== undefined || versions.conflicts.includes(key)) { versions.conflicts.push(key); saveVersions(userId, versions); continue; }
      const made = await rest('user_book_annotations', { method: 'POST', prefer: 'return=representation', body: { ...row, revision: 1 } });
      if (!made.ok) return { ok: false, conflict: made.status === 409 };
      markWritten(key, 1);
    } else {
      const key = `annotation:${row.id}`;
      const equal = old.content === row.content && old.quote_text === row.quote_text && old.page_reference === row.page_reference && old.deleted_at === row.deleted_at && stableJson(old.location_data) === stableJson(row.location_data) && stableJson(old.extra_data) === stableJson(row.extra_data);
      const gated = gate(key, old.revision, equal, () => mergeAnnotationFirstSync(old, row), merged => sameFields(old, merged, ANNOTATION_FIELDS));
      if (gated.write) {
        if (!await casUpdate('user_book_annotations', userId, `id=eq.${row.id}`, old.revision, gated.merged ?? row as unknown as Record<string, unknown>)) return { ok: false, conflict: true };
        markWritten(key, old.revision + 1);
      }
    }
  }
  const desiredAnnotations = new Set(snapshotWithIds.annotations.map(row => row.id));
  for (const old of remote.annotations) if (!old.deleted_at && !desiredAnnotations.has(old.id)) {
    const localBookId = String(old.extra_data?.local_book_id || '');
    const localAnnotationId = String(old.extra_data?.local_annotation_id || (old.annotation_type === 'note' ? 'note' : old.id));
    if (!isDeletedLocally(userId, localBookId) && !isDeletedLocally(userId, `annotation:${localBookId}:${localAnnotationId}`)) continue;
    const deletedAt = timeOf(editTimes, old.annotation_type === 'note' ? 'note' : 'highlight', old.annotation_type === 'note' ? localBookId : `${localBookId}:${localAnnotationId}`);
    if (!await casUpdate('user_book_annotations', userId, `id=eq.${old.id}`, old.revision, { deleted_at: new Date().toISOString(), ...(deletedAt ? { extra_data: { ...(old.extra_data || {}), edited_at: deletedAt } } : {}) })) return { ok: false, conflict: true };
    markWritten(`annotation:${old.id}`, old.revision + 1);
  }
  for (const row of snapshotWithIds.memberships) {
    const old = remote.memberships.find(item => item.id === row.id);
    if (!old) {
      const key = `membership:${row.id}`;
      if (versions.revisions[key] !== undefined || versions.conflicts.includes(key)) { versions.conflicts.push(key); saveVersions(userId, versions); continue; }
      const made = await rest('user_shelf_books', { method: 'POST', prefer: 'return=representation', body: { ...row, revision: 1 } });
      if (!made.ok) return { ok: false, conflict: made.status === 409 };
      markWritten(key, 1);
    } else {
      const key = `membership:${row.id}`;
      const equal = old.deleted_at === row.deleted_at && old.sort_order === row.sort_order && old.shelf_id === row.shelf_id && old.library_book_id === row.library_book_id && stableJson(old.membership_data) === stableJson(row.membership_data);
      const gated = gate(key, old.revision, equal, () => mergeMembershipFirstSync(old, row), merged => sameFields(old, merged, MEMBERSHIP_FIELDS));
      if (gated.write) {
        if (!await casUpdate('user_shelf_books', userId, `id=eq.${row.id}`, old.revision, gated.merged ?? row as unknown as Record<string, unknown>)) return { ok: false, conflict: true };
        markWritten(key, old.revision + 1);
      }
    }
  }
  const desiredMemberships = new Set(snapshotWithIds.memberships.map(row => row.id));
  for (const old of remote.memberships) if (!old.deleted_at && !desiredMemberships.has(old.id)) {
    const localId = String(old.membership_data?.local_id || '');
    const [localCollectionId, localBookId] = localId.split('|');
    if (!isDeletedLocally(userId, `collection:${localCollectionId}`) && !isDeletedLocally(userId, `membership:${localCollectionId}:${localBookId}`) && !isDeletedLocally(userId, localBookId)) continue;
    if (!await casUpdate('user_shelf_books', userId, `id=eq.${old.id}`, old.revision, { deleted_at: new Date().toISOString() })) return { ok: false, conflict: true };
    markWritten(`membership:${old.id}`, old.revision + 1);
  }
  const desiredShelves = new Set(snapshotWithIds.shelves.map(row => String(row.shelf_data.local_id || '')));
  for (const old of remote.shelves) if (!old.deleted_at && !desiredShelves.has(String(old.shelf_data?.local_id || ''))) {
    const localId = String(old.shelf_data?.local_id || '');
    if (!isDeletedLocally(userId, `collection:${localId}`)) continue;
    if (!await casUpdate('user_shelves', userId, `id=eq.${old.id}`, old.revision, { deleted_at: new Date().toISOString() })) return { ok: false, conflict: true };
    markWritten(`shelf:${localId}`, old.revision + 1);
  }
  const desiredBooks = new Set(snapshot.books.map(row => row.local_book_id));
  for (const old of remote.books) if (!old.deleted_at && !desiredBooks.has(old.local_book_id)) {
    if (!isDeletedLocally(userId, old.local_book_id)) continue;
    if (!await casUpdate('user_library_books', userId, `local_book_id=eq.${encodeURIComponent(old.local_book_id)}`, old.revision, { deleted_at: new Date().toISOString() })) return { ok: false, conflict: true };
    markWritten(`book:${old.local_book_id}`, old.revision + 1);
  }
  const currentPrefs = remote.preferences[0];
  // Device-local state never leaves the device, and (with per-day pages on) the old dailyLog copy is left exactly as the cloud has it.
  const outgoing: Record<string, unknown> = { ...snapshot.preferences };
  if (currentPrefs) {
    if ('onDeviceOverrides' in currentPrefs.preferences) outgoing.onDeviceOverrides = currentPrefs.preferences.onDeviceOverrides;
    if (dailyPagesSyncEnabled() && 'dailyLog' in currentPrefs.preferences) outgoing.dailyLog = currentPrefs.preferences.dailyLog;
  } else if (dailyPagesSyncEnabled()) outgoing.dailyLog = {};
  const pref = { user_id: userId, preferences: outgoing };
  if (!currentPrefs) {
    if (versions.revisions.preferences !== undefined || versions.conflicts.includes('preferences')) { versions.conflicts.push('preferences'); saveVersions(userId, versions); return { ok: true, conflict: true, libraryIds, shelfIds }; }
    const made = await rest('user_library_preferences', { method: 'POST', prefer: 'return=representation', body: { ...pref, revision: 1 } });
    if (!made.ok) return { ok: false, conflict: made.status === 409 };
    markWritten('preferences', 1);
  } else {
    const gated = gate('preferences', currentPrefs.revision, stableJson(currentPrefs.preferences) === stableJson(pref.preferences),
      () => mergePreferencesFirstSync(currentPrefs.preferences, pref.preferences), merged => stableJson(currentPrefs.preferences) === stableJson(merged));
    if (gated.write) {
    if (!await casUpdate('user_library_preferences', userId, '', currentPrefs.revision, gated.merged ? { ...pref, preferences: gated.merged } : pref)) return { ok: false, conflict: true };
    markWritten('preferences', currentPrefs.revision + 1);
    }
  }
  saveVersions(userId, versions);
  return { ok: true, conflict: versions.conflicts.length > 0, libraryIds, shelfIds };
}

const SHELF_FIELDS = ['name', 'description', 'sort_order', 'shelf_data', 'deleted_at'];
const ANNOTATION_FIELDS = ['content', 'quote_text', 'page_reference', 'location_data', 'extra_data', 'deleted_at'];
const MEMBERSHIP_FIELDS = ['deleted_at', 'sort_order', 'shelf_id', 'library_book_id', 'membership_data'];

function equalSyncRecord(old: LibraryBookRow, next: Record<string, unknown>): boolean {
  const fields: (keyof LibraryBookRow)[] = ['status', 'reading_progress', 'personal_cover', 'book_snapshot', 'personal_data', 'deleted_at'];
  return fields.every(field => stableJson(old[field] ?? null) === stableJson(next[field] ?? null));
}

function buildSnapshotWithIds(snapshot: LibrarySyncSnapshot, libraryIds: Map<string, string>, shelfIds: Map<string, string>): LibrarySyncSnapshot {
  // A note or shelf entry for a book that has no cloud row (hidden or removed from the library) cannot be filed: the database requires a real book id,
  // and one such row would make the whole sync fail every time. It is skipped; everything else still syncs.
  const annotations = snapshot.annotations.map(row => ({ ...row, library_book_id: libraryIds.get(String(row.extra_data.local_book_id)) || row.library_book_id })).filter(row => !!row.library_book_id);
  const memberships = snapshot.memberships.map(row => ({ ...row, library_book_id: libraryIds.get(String(row.membership_data.local_book_id)) || row.library_book_id, shelf_id: shelfIds.get(String(row.membership_data.local_shelf_id)) || row.shelf_id })).filter(row => !!row.library_book_id && !!row.shelf_id);
  return { ...snapshot, annotations, memberships };
}

function annotationUuid(userId: string, localBookId: string, type: string, localId: string): string {
  return deterministicUuid(userId, 'annotation', `${localBookId}|${type}|${localId}`);
}
function deterministicUuid(userId: string, kind: string, localId: string): string {
  // UUIDv5-shaped deterministic keys make inserts idempotent across retries and devices.
  const bytes = new TextEncoder().encode(`${userId}|greatreads|${kind}|${localId}`);
  const bitLength = bytes.length * 8;
  const padded = [...bytes, 0x80];
  while (padded.length % 64 !== 56) padded.push(0);
  for (let i = 7; i >= 0; i--) padded.push(i < 4 ? (bitLength >>> (i * 8)) & 255 : 0);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  for (let offset = 0; offset < padded.length; offset += 64) {
    const w = new Uint32Array(80);
    for (let i = 0; i < 16; i++) w[i] = ((padded[offset + i * 4] << 24) | (padded[offset + i * 4 + 1] << 16) | (padded[offset + i * 4 + 2] << 8) | padded[offset + i * 4 + 3]) >>> 0;
    for (let i = 16; i < 80; i++) w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]) << 1 | (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]) >>> 31;
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const rot = (a << 5) | (a >>> 27);
      const temp = (rot + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = temp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const hex = [h0, h1, h2, h3, h4].map(x => x.toString(16).padStart(8, '0')).join('').slice(0, 32);
  const raw = hex.split(''); raw[12] = '5'; raw[16] = ((parseInt(raw[16], 16) & 3) | 8).toString(16);
  const s = raw.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
