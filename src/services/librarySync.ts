import type { Book, ReadingState } from '../types';
import type { Collection } from './libraryCollections';
import { cleanPicks, type CoverPick } from './books/coverPicks';
import { coverKey } from './books/coverAnalysis';
import { currentUser, rest } from './supabase';
import { exportNookLook } from './nookPrefs';

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

const hasOwnData = (state: ReadingState, id: string, collections: Collection[]) => !!(
  state.status[id] || state.currentPage[id] || state.totalPages[id] || state.notes[id] || state.highlights[id]?.length
  || state.history[id] || state.ratings[id] || state.customBooks.some(book => String(book.id) === id)
  || collections.some(collection => collection.bookIds.includes(id))
  || Object.prototype.hasOwnProperty.call(state.onDeviceOverrides, id)
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
    ...Object.keys(state.highlights), ...Object.keys(state.history), ...Object.keys(state.ratings), ...Object.keys(state.onDeviceOverrides),
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
      personal_data: { rating: state.ratings[localId] || null, onDevice: state.onDeviceOverrides[localId] ?? null, isCustomBook: customById.has(localId) },
      deleted_at: null,
    });
  }

  const libraryIdByLocal = new Map<string, string>(libraryIds);
  const annotations: LibrarySyncSnapshot['annotations'] = [];
  for (const localId of candidateIds) {
    const libraryBookId = libraryIdByLocal.get(localId) || '';
    if (state.hiddenBookIds[localId]) continue;
    const note = state.notes[localId];
    if (note?.trim()) annotations.push({ id: annotationUuid(userId, localId, 'note', 'note'), user_id: userId, library_book_id: libraryBookId, annotation_type: 'note', content: note, quote_text: null, page_reference: null, location_data: {}, extra_data: { local_book_id: localId, local_annotation_id: 'note' }, deleted_at: null });
    for (const highlight of state.highlights[localId] || []) annotations.push({ id: annotationUuid(userId, localId, 'highlight', highlight.id), user_id: userId, library_book_id: libraryBookId, annotation_type: 'highlight', content: highlight.text, quote_text: highlight.text, page_reference: highlight.page == null ? null : String(highlight.page), location_data: highlight.page == null ? {} : { page: highlight.page }, extra_data: { local_book_id: localId, local_annotation_id: highlight.id, timestamp: highlight.timestamp }, deleted_at: null });
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
    words: state.words, garden: state.garden, hiddenBookIds: state.hiddenBookIds, onDeviceOverrides: state.onDeviceOverrides,
    coverPicks, nookLook: exportNookLook() || null,
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
    if (row.status && (preferRemote || !next.status[id])) next.status[id] = row.status as ReadingState['status'][string];
    const progress = row.reading_progress || {};
    if (preferRemote && progress.currentPage !== undefined) next.currentPage[id] = Number(progress.currentPage) || 0;
    else if (Number(progress.currentPage) > Number(next.currentPage[id] || 0)) next.currentPage[id] = Number(progress.currentPage);
    if (Number(progress.totalPages) > 0 && (preferRemote || !next.totalPages[id])) next.totalPages[id] = Number(progress.totalPages);
    if (progress.history && typeof progress.history === 'object' && (preferRemote || !next.history[id])) next.history[id] = progress.history as ReadingState['history'][string];
    const rating = Number(row.personal_data?.rating);
    if ((preferRemote || !next.ratings[id]) && Number.isFinite(rating) && rating > 0) next.ratings[id] = rating;
    const onDevice = row.personal_data?.onDevice;
    if ((preferRemote || next.onDeviceOverrides[id] === undefined) && typeof onDevice === 'boolean') next.onDeviceOverrides[id] = onDevice;
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

/** Fill empty local fields from cloud during bootstrap; local values and IDs always survive. */
export function mergeRemoteLibrary(local: ReadingState, collections: Collection[], remote: RemoteLibrarySnapshot, localCoverPicks: Record<string, CoverPick> = {}, preferRemote = false): { state: ReadingState; collections: Collection[]; coverPicks: Record<string, CoverPick>; nookLook: unknown } {
  const userId = remote.preferences[0]?.user_id || remote.books[0]?.user_id || '';
  const deleted = userId ? localDeletionSet(userId) : new Set<string>();
  const acceptedBooks = remote.books.filter(row => !deleted.has(row.local_book_id));
  const state = mergeInitialLibrarySnapshot(local, acceptedBooks, preferRemote);
  if (preferRemote) for (const row of remote.books) if (row.deleted_at) {
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
    if (deleted.has(bookId) || deleted.has(`annotation:${bookId}:${annotationId}`)) continue;
    if (row.deleted_at) {
      if (preferRemote && row.annotation_type === 'note') delete state.notes[bookId];
      if (preferRemote && (row.annotation_type === 'highlight' || row.annotation_type === 'quote')) state.highlights[bookId] = (state.highlights[bookId] || []).filter(item => item.id !== annotationId);
      continue;
    }
    const id = bookIdByCloud.get(row.library_book_id);
    if (!id) continue;
    const list = annotationsByBook.get(id) || [];
    list.push(row);
    annotationsByBook.set(id, list);
  }
  for (const [id, entries] of annotationsByBook) {
    for (const row of entries) {
      if (row.annotation_type === 'note' && (preferRemote || !state.notes[id])) state.notes[id] = row.content;
      if (row.annotation_type !== 'highlight' && row.annotation_type !== 'quote') continue;
      const localId = String(row.extra_data?.local_annotation_id || row.id);
      const highlight = { id: localId, text: row.content, page: Number(row.page_reference) || undefined, timestamp: Number(row.extra_data?.timestamp) || 0 };
      const current = state.highlights[id] || [];
      if (!current.some(item => item.id === localId)) state.highlights[id] = [...current, highlight];
      else if (preferRemote) state.highlights[id] = current.map(item => item.id === localId ? highlight : item);
    }
  }
  const mergedCollections = new Map(collections.map(item => [item.id, { ...item, bookIds: [...item.bookIds] }]));
  // Applying the cloud copy removes only what the cloud explicitly marks as removed; entries it has no record of stay (they are not deletions).
  if (preferRemote) {
    const removed = new Set(remote.memberships.filter(row => row.deleted_at).map(row => `${String(row.membership_data?.local_shelf_id || '')}|${String(row.membership_data?.local_book_id || bookIdByCloud.get(row.library_book_id) || '')}`));
    for (const collection of mergedCollections.values()) collection.bookIds = collection.bookIds.filter(id => !removed.has(`${collection.id}|${id}`));
  }
  const coverPicks = { ...localCoverPicks };
  for (const row of remote.books) {
    if (row.deleted_at || !row.personal_cover || !row.book_snapshot) continue;
    const key = coverKey(row.book_snapshot);
    if (key && (preferRemote || !coverPicks[key])) coverPicks[key] = row.personal_cover;
  }
  const localByShelf = new Map(remote.shelves.filter(row => !row.deleted_at).map(row => [row.id, String(row.shelf_data?.local_id || row.id)]));
  for (const row of remote.shelves) {
    const id = String(row.shelf_data?.local_id || '');
    if (!id || deleted.has(`collection:${id}`)) continue;
    if (row.deleted_at) { if (preferRemote) mergedCollections.delete(id); continue; }
    const existing = mergedCollections.get(id);
    if (!existing || preferRemote) mergedCollections.set(id, { id, name: row.name, kind: row.shelf_data?.kind === 'tag' ? 'tag' : 'shelf', bookIds: existing?.bookIds || [] });
  }
  const collectionById = mergedCollections;
  for (const row of remote.memberships) {
    if (row.deleted_at) continue;
    const collectionId = localByShelf.get(row.shelf_id);
    if (collectionId && deleted.has(`collection:${collectionId}`)) continue;
    const localBookId = bookIdByCloud.get(row.library_book_id);
    const collection = collectionId && collectionById.get(collectionId);
    if (collection && localBookId && !collection.bookIds.includes(localBookId)) collection.bookIds.push(localBookId);
  }
  const pref = remote.preferences.find(row => row.user_id && row.preferences && typeof row.preferences === 'object')?.preferences;
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
      for (const [day, pages] of Object.entries(remoteLog)) state.dailyLog[day] = preferRemote ? pages : Math.max(state.dailyLog[day] || 0, pages || 0);
    }
    if ((preferRemote || state.goal === 10) && Number(pref.goal) > 0) state.goal = Number(pref.goal);
    if ((preferRemote || !state.readingIntention) && typeof pref.readingIntention === 'string') state.readingIntention = pref.readingIntention;
    if (pref.profile && typeof pref.profile === 'object') {
      const profile = pref.profile as ReadingState['profile'];
      state.profile = { name: preferRemote || !state.profile.name ? profile.name : state.profile.name, photo: preferRemote || !state.profile.photo ? profile.photo : state.profile.photo, theme: preferRemote || state.profile.theme === 'auto' ? profile.theme : state.profile.theme };
    }
    if (Array.isArray(pref.words)) {
      const words = new Map(state.words.map(word => [word.id, word]));
      for (const word of pref.words as ReadingState['words']) if (!words.has(word.id)) words.set(word.id, word);
      state.words = [...words.values()];
    }
    if (pref.garden && typeof pref.garden === 'object') state.garden = mergeGarden(state.garden, pref.garden as ReadingState['garden']);
    if (pref.hiddenBookIds && typeof pref.hiddenBookIds === 'object') state.hiddenBookIds = { ...(pref.hiddenBookIds as ReadingState['hiddenBookIds']), ...state.hiddenBookIds };
    if (pref.onDeviceOverrides && typeof pref.onDeviceOverrides === 'object') state.onDeviceOverrides = { ...(pref.onDeviceOverrides as ReadingState['onDeviceOverrides']), ...state.onDeviceOverrides };
  }
  return { state, collections: [...mergedCollections.values()], coverPicks, nookLook };
}

function mergeGarden(local: ReadingState['garden'], remote: ReadingState['garden']): ReadingState['garden'] {
  const peaks = { ...local.peaks };
  for (const key of Object.keys(peaks) as (keyof typeof peaks)[]) peaks[key] = Math.max(peaks[key], remote.peaks?.[key] || 0);
  const plants = { ...remote.plants, ...local.plants };
  for (const [id, cloud] of Object.entries(remote.plants || {})) {
    const mine = local.plants[id];
    if (mine) plants[id] = { ...cloud, ...mine, earnedAt: Math.min(cloud.earnedAt, mine.earnedAt), growth: Math.max(cloud.growth, mine.growth), completedAt: mine.completedAt || cloud.completedAt };
  }
  return {
    ...remote, ...local, v: 1, peaks, plants,
    achievements: { ...remote.achievements, ...local.achievements },
    placements: { ...remote.placements, ...local.placements },
    celebrated: { ...remote.celebrated, ...local.celebrated },
    vine: Math.max(local.vine || 0, remote.vine || 0),
  };
}

const qUser = (userId: string) => `user_id=eq.${encodeURIComponent(userId)}`;
const PENDING_PREFIX = 'readlife.librarySyncPending1.';
const OWNER_KEY = 'readlife.librarySyncOwner1';
export function librarySyncAccountAllowed(userId: string): boolean { try { const owner = localStorage.getItem(OWNER_KEY); return !owner || owner === userId; } catch { return false; } }
export function claimLibrarySyncAccount(userId: string): void { try { if (!localStorage.getItem(OWNER_KEY)) localStorage.setItem(OWNER_KEY, userId); } catch {} }
const VERSION_PREFIX = 'readlife.librarySyncVersions1.';
type SyncVersions = { revisions: Record<string, number>; hashes: Record<string, string>; conflicts: string[] };
const versionsKey = (userId: string) => `${VERSION_PREFIX}${encodeURIComponent(userId)}`;
function getVersions(userId: string): SyncVersions {
  try { const raw = JSON.parse(localStorage.getItem(versionsKey(userId)) || 'null'); return { revisions: raw?.revisions || {}, hashes: raw?.hashes || {}, conflicts: Array.isArray(raw?.conflicts) ? raw.conflicts : [] }; } catch { return { revisions: {}, hashes: {}, conflicts: [] }; }
}
function saveVersions(userId: string, versions: SyncVersions) {
  try { localStorage.setItem(versionsKey(userId), JSON.stringify(versions)); } catch {}
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('greatreads-library-sync-status'));
}
export function hasLibrarySyncConflicts(userId: string): boolean { return getVersions(userId).conflicts.length > 0; }
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

const pendingKey = (userId: string) => `${PENDING_PREFIX}${encodeURIComponent(userId)}`;
export const hasPendingLibrarySync = (userId: string): boolean => { try { return !!localStorage.getItem(pendingKey(userId)); } catch { return false; } };
/** When this device's oldest unsynced change was made (the flag stores the time; an older build stored "1", read as "long ago"). */
const pendingSince = (userId: string): number => { try { const n = Number(localStorage.getItem(pendingKey(userId))); return Number.isFinite(n) && n > 0 ? n : Date.now(); } catch { return Date.now(); } };
const setPendingLibrarySync = (userId: string, pending: boolean) => {
  try {
    if (!pending) localStorage.removeItem(pendingKey(userId));
    else if (!localStorage.getItem(pendingKey(userId))) localStorage.setItem(pendingKey(userId), String(Date.now())); // keeps the OLDEST unsynced change
  } catch {}
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('greatreads-library-sync-status'));
};
/** Call the moment the person changes something, so the time of the change is known and a pull cannot overwrite it before it is pushed. */
export const markLibraryDirty = (userId: string): void => setPendingLibrarySync(userId, true);

type SyncArgs = { state: ReadingState; books: Book[]; collections: Collection[]; coverPicks: Record<string, CoverPick> };
/** `stale`: the cloud holds newer values for some rows this device did not change; they were left alone and should be pulled. */
export async function syncLocalLibraryDetailed(userId: string, args: SyncArgs): Promise<{ ok: boolean; stale: boolean }> {
  if (currentUser()?.id !== userId || !librarySyncAccountAllowed(userId) || (typeof navigator !== 'undefined' && navigator.onLine === false)) { setPendingLibrarySync(userId, true); return { ok: false, stale: false }; }
  setPendingLibrarySync(userId, true);
  const remote = await loadRemoteLibrary(userId);
  if (!remote || currentUser()?.id !== userId) return { ok: false, stale: false };
  const libraryIds = new Map(remote.books.map(row => [row.local_book_id, row.id]));
  const shelfIds = new Map(remote.shelves.map(row => [String(row.shelf_data?.local_id || ''), row.id]));
  const safeState = { ...args.state, customBooks: args.state.customBooks.filter(book => !isDeletedLocally(userId, String(book.id))) };
  const snapshot = buildLibrarySyncSnapshot({ userId, ...args, state: safeState, libraryIds, shelfIds });
  const result = await writeRemoteLibrary(userId, snapshot, remote);
  setPendingLibrarySync(userId, !result.ok);
  if (result.ok && !result.conflict) clearPersonalDeletionMarkers(userId);
  if (result.ok) claimLibrarySyncAccount(userId);
  return { ok: result.ok, stale: !!result.stale };
}
export async function syncLocalLibrary(userId: string, args: SyncArgs): Promise<boolean> { return (await syncLocalLibraryDetailed(userId, args)).ok; }

async function casUpdate(table: string, userId: string, filter: string, revision: number, body: Record<string, unknown>): Promise<boolean> {
  const extra = filter ? `&${filter}` : '';
  const r = await rest<unknown[]>(`${table}?${qUser(userId)}${extra}&revision=eq.${revision}`, { method: 'PATCH', prefer: 'return=representation', body: { ...body, revision: revision + 1 } });
  return r.ok && Array.isArray(r.data) && r.data.length === 1;
}

/** Write one complete, already-reconciled local snapshot. CAS revisions prevent silently overwriting a simultaneous device edit. */
export async function writeRemoteLibrary(userId: string, snapshot: LibrarySyncSnapshot, remote: RemoteLibrarySnapshot): Promise<{ ok: boolean; conflict?: boolean; stale?: boolean; libraryIds?: Map<string, string>; shelfIds?: Map<string, string> }> {
  if (currentUser()?.id !== userId || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { ok: false };
  const versions = getVersions(userId);
  versions.conflicts = []; // earlier builds parked rows as "conflicts" and then stopped applying cloud changes; nothing is parked any more
  let stale = false;
  /**
   * Whether this device may write a row that differs from the cloud's. `revision` is the cloud row's current revision, `hash` fingerprints this device's values.
   *  - never seen before (the sign-in merge already folded the cloud copy into this device) or the cloud row is the one this device last saw: an ordinary edit, write it;
   *  - the cloud row moved on and this device's values are exactly what it last synced: the other device's newer values must not be overwritten, so skip and report `stale`;
   *  - both moved: whichever was saved last wins. A cloud value saved after this device's unsynced change began is kept (and pulled); an older one is overwritten
   *    (compare-and-set on the cloud row's current revision). Syncing is never blocked. A cloud row with no timestamp counts as older.
   */
  const editedSince = pendingSince(userId);
  const mayWrite = (key: string, revision: number, equal: boolean, hash: string, cloudSavedAt?: string | null): boolean => {
    if (equal) { versions.revisions[key] = revision; versions.hashes[key] = hash; return false; }
    const baseline = versions.revisions[key];
    if (baseline === undefined || baseline === revision) return true;
    if (versions.hashes[key] === hash) { stale = true; return false; }
    const cloudTime = cloudSavedAt ? Date.parse(cloudSavedAt) : NaN;
    if (Number.isFinite(cloudTime) && cloudTime > editedSince) { stale = true; return false; }
    return true;
  };
  const markWritten = (key: string, revision: number, hash: string) => { versions.revisions[key] = revision; versions.hashes[key] = hash; saveVersions(userId, versions); };
  const bookRows = new Map(remote.books.map(row => [row.local_book_id, row]));
  const libraryIds = new Map(remote.books.map(row => [row.local_book_id, row.id]));
  for (const item of snapshot.books) {
    const old = bookRows.get(item.local_book_id);
    if (!old) {
      const key = `book:${item.local_book_id}`;
      const made = await rest<LibraryBookRow[]>('user_library_books', { method: 'POST', prefer: 'return=representation', body: { ...item, revision: 1 } });
      if (!made.ok) return { ok: false, conflict: made.status === 409 };
      if (!made.data?.[0]) return { ok: false, conflict: true };
      libraryIds.set(item.local_book_id, made.data[0].id);
      markWritten(key, Number(made.data[0].revision) || 1, fieldsHash(item as unknown as Record<string, unknown>, BOOK_FIELDS));
      continue;
    }
    libraryIds.set(item.local_book_id, old.id);
    const body = { ...item, id: old.id, catalog_work_id: old.catalog_work_id, catalog_edition_id: old.catalog_edition_id } as Record<string, unknown>;
    const key = `book:${item.local_book_id}`;
    const hash = fieldsHash(body, BOOK_FIELDS);
    if (!mayWrite(key, old.revision, equalSyncRecord(old, body), hash, old.updated_at)) continue;
    const ok = await casUpdate('user_library_books', userId, `local_book_id=eq.${encodeURIComponent(item.local_book_id)}`, old.revision, body);
    if (!ok) return { ok: false, conflict: true };
    markWritten(key, old.revision + 1, hash);
  }
  const shelfRows = new Map(remote.shelves.map(row => [String(row.shelf_data?.local_id || ''), row]));
  const shelfIds = new Map(remote.shelves.map(row => [String(row.shelf_data?.local_id || ''), row.id]));
  for (const item of snapshot.shelves) {
    const localId = String(item.shelf_data.local_id || '');
    const old = shelfRows.get(localId);
    if (!old) {
      const key = `shelf:${localId}`;
      const made = await rest<ShelfRow[]>('user_shelves', { method: 'POST', prefer: 'return=representation', body: { ...item, revision: 1 } });
      if (!made.ok) return { ok: false, conflict: made.status === 409 };
      if (!made.data?.[0]) return { ok: false, conflict: true };
      shelfIds.set(localId, made.data[0].id);
      markWritten(key, Number(made.data[0].revision) || 1, fieldsHash(item as unknown as Record<string, unknown>, SHELF_FIELDS));
    } else {
      shelfIds.set(localId, old.id);
      const key = `shelf:${localId}`;
      const body = { name: item.name, description: item.description, sort_order: item.sort_order, shelf_data: item.shelf_data, deleted_at: null };
      const equal = old.name === item.name && old.description === item.description && old.sort_order === item.sort_order && stableJson(old.shelf_data) === stableJson(item.shelf_data) && !old.deleted_at;
      const hash = fieldsHash(body, SHELF_FIELDS);
      if (mayWrite(key, old.revision, equal, hash, old.updated_at)) {
        if (!await casUpdate('user_shelves', userId, `id=eq.${old.id}`, old.revision, body)) return { ok: false, conflict: true };
        markWritten(key, old.revision + 1, hash);
      }
    }
  }
  const snapshotWithIds = buildSnapshotWithIds(snapshot, libraryIds, shelfIds);
  // Annotation and membership rows carry stable UUIDs; the table PK makes network retries idempotent.
  for (const row of snapshotWithIds.annotations) {
    const old = remote.annotations.find(item => item.id === row.id);
    if (!old) {
      const key = `annotation:${row.id}`;
      const made = await rest('user_book_annotations', { method: 'POST', prefer: 'return=representation', body: { ...row, revision: 1 } });
      if (!made.ok) return { ok: false, conflict: made.status === 409 };
      markWritten(key, 1, fieldsHash(row as unknown as Record<string, unknown>, ANNOTATION_FIELDS));
    } else {
      const key = `annotation:${row.id}`;
      const equal = old.content === row.content && old.quote_text === row.quote_text && old.page_reference === row.page_reference && old.deleted_at === row.deleted_at && stableJson(old.location_data) === stableJson(row.location_data) && stableJson(old.extra_data) === stableJson(row.extra_data);
      const hash = fieldsHash(row as unknown as Record<string, unknown>, ANNOTATION_FIELDS);
      if (mayWrite(key, old.revision, equal, hash, old.updated_at)) {
        if (!await casUpdate('user_book_annotations', userId, `id=eq.${row.id}`, old.revision, row as unknown as Record<string, unknown>)) return { ok: false, conflict: true };
        markWritten(key, old.revision + 1, hash);
      }
    }
  }
  const desiredAnnotations = new Set(snapshotWithIds.annotations.map(row => row.id));
  for (const old of remote.annotations) if (!old.deleted_at && !desiredAnnotations.has(old.id)) {
    const localBookId = String(old.extra_data?.local_book_id || '');
    const localAnnotationId = String(old.extra_data?.local_annotation_id || (old.annotation_type === 'note' ? 'note' : old.id));
    if (!isDeletedLocally(userId, localBookId) && !isDeletedLocally(userId, `annotation:${localBookId}:${localAnnotationId}`)) continue;
    if (!await casUpdate('user_book_annotations', userId, `id=eq.${old.id}`, old.revision, { deleted_at: new Date().toISOString() })) return { ok: false, conflict: true };
    markWritten(`annotation:${old.id}`, old.revision + 1, DELETED_HASH);
  }
  for (const row of snapshotWithIds.memberships) {
    const old = remote.memberships.find(item => item.id === row.id);
    if (!old) {
      const key = `membership:${row.id}`;
      const made = await rest('user_shelf_books', { method: 'POST', prefer: 'return=representation', body: { ...row, revision: 1 } });
      if (!made.ok) return { ok: false, conflict: made.status === 409 };
      markWritten(key, 1, fieldsHash(row as unknown as Record<string, unknown>, MEMBERSHIP_FIELDS));
    } else {
      const key = `membership:${row.id}`;
      const equal = old.deleted_at === row.deleted_at && old.sort_order === row.sort_order && old.shelf_id === row.shelf_id && old.library_book_id === row.library_book_id && stableJson(old.membership_data) === stableJson(row.membership_data);
      const hash = fieldsHash(row as unknown as Record<string, unknown>, MEMBERSHIP_FIELDS);
      if (mayWrite(key, old.revision, equal, hash, old.updated_at)) {
        if (!await casUpdate('user_shelf_books', userId, `id=eq.${row.id}`, old.revision, row as unknown as Record<string, unknown>)) return { ok: false, conflict: true };
        markWritten(key, old.revision + 1, hash);
      }
    }
  }
  const desiredMemberships = new Set(snapshotWithIds.memberships.map(row => row.id));
  for (const old of remote.memberships) if (!old.deleted_at && !desiredMemberships.has(old.id)) {
    const localId = String(old.membership_data?.local_id || '');
    const [localCollectionId, localBookId] = localId.split('|');
    if (!isDeletedLocally(userId, `collection:${localCollectionId}`) && !isDeletedLocally(userId, `membership:${localCollectionId}:${localBookId}`) && !isDeletedLocally(userId, localBookId)) continue;
    if (!await casUpdate('user_shelf_books', userId, `id=eq.${old.id}`, old.revision, { deleted_at: new Date().toISOString() })) return { ok: false, conflict: true };
    markWritten(`membership:${old.id}`, old.revision + 1, DELETED_HASH);
  }
  const desiredShelves = new Set(snapshotWithIds.shelves.map(row => String(row.shelf_data.local_id || '')));
  for (const old of remote.shelves) if (!old.deleted_at && !desiredShelves.has(String(old.shelf_data?.local_id || ''))) {
    const localId = String(old.shelf_data?.local_id || '');
    if (!isDeletedLocally(userId, `collection:${localId}`)) continue;
    if (!await casUpdate('user_shelves', userId, `id=eq.${old.id}`, old.revision, { deleted_at: new Date().toISOString() })) return { ok: false, conflict: true };
    markWritten(`shelf:${localId}`, old.revision + 1, DELETED_HASH);
  }
  const desiredBooks = new Set(snapshot.books.map(row => row.local_book_id));
  for (const old of remote.books) if (!old.deleted_at && !desiredBooks.has(old.local_book_id)) {
    if (!isDeletedLocally(userId, old.local_book_id)) continue;
    if (!await casUpdate('user_library_books', userId, `local_book_id=eq.${encodeURIComponent(old.local_book_id)}`, old.revision, { deleted_at: new Date().toISOString() })) return { ok: false, conflict: true };
    markWritten(`book:${old.local_book_id}`, old.revision + 1, DELETED_HASH);
  }
  const currentPrefs = remote.preferences[0];
  const pref = { user_id: userId, preferences: snapshot.preferences };
  if (!currentPrefs) {
    const made = await rest('user_library_preferences', { method: 'POST', prefer: 'return=representation', body: { ...pref, revision: 1 } });
    if (!made.ok) return { ok: false, conflict: made.status === 409 };
    markWritten('preferences', 1, fnv(stableJson(pref.preferences)));
  } else if (mayWrite('preferences', currentPrefs.revision, stableJson(currentPrefs.preferences) === stableJson(pref.preferences), fnv(stableJson(pref.preferences)), currentPrefs.updated_at)) {
    if (!await casUpdate('user_library_preferences', userId, '', currentPrefs.revision, pref)) return { ok: false, conflict: true };
    markWritten('preferences', currentPrefs.revision + 1, fnv(stableJson(pref.preferences)));
  }
  saveVersions(userId, versions);
  return { ok: true, conflict: false, stale, libraryIds, shelfIds };
}

function equalSyncRecord(old: LibraryBookRow, next: Record<string, unknown>): boolean {
  const fields: (keyof LibraryBookRow)[] = ['status', 'reading_progress', 'personal_cover', 'book_snapshot', 'personal_data', 'deleted_at'];
  return fields.every(field => stableJson(old[field] ?? null) === stableJson(next[field] ?? null));
}

/** A short fingerprint of the values this device last synced for a row (to tell "this device did not change it" from "it did"). Not a security hash. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const BOOK_FIELDS = ['status', 'reading_progress', 'personal_cover', 'book_snapshot', 'personal_data', 'deleted_at'];
const SHELF_FIELDS = ['name', 'description', 'sort_order', 'shelf_data'];
const ANNOTATION_FIELDS = ['content', 'quote_text', 'page_reference', 'deleted_at', 'location_data', 'extra_data'];
const MEMBERSHIP_FIELDS = ['deleted_at', 'sort_order', 'shelf_id', 'library_book_id', 'membership_data'];
const DELETED_HASH = fnv('deleted');
const fieldsHash = (row: Record<string, unknown>, fields: string[]): string => fnv(stableJson(fields.map(field => row[field] ?? null)));

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
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
