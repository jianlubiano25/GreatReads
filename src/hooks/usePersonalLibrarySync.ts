import { useEffect, useRef } from 'react';
import type { Book, ReadingState } from '../types';
import { currentUser, subscribeLibraryRealtime } from '../services/supabase';
import { exportCoverPicks, restoreCoverPicks } from '../services/books/covers';
import { loadCollections, type Collection } from '../services/libraryCollections';
import { exportNookLook, restoreNookLook } from '../services/nookPrefs';
import { claimLibrarySyncAccount, hasPendingLibrarySync, librarySyncAccountAllowed, loadRemoteLibrary, markPersonalCollectionDeleted, markPersonalMembershipDeleted, mergeRemoteLibrary, pausedLibraryKeys, resolveLibraryConflictsToCloud, syncLocalLibrary } from '../services/librarySync';

export function usePersonalLibrarySync(args: {
  state: ReadingState; books: Book[]; collections: Collection[];
  applyState: (change: (state: ReadingState) => ReadingState) => void;
  replaceCollections: (collections: Collection[]) => void;
}): void {
  const stateRef = useRef(args.state); stateRef.current = args.state;
  const booksRef = useRef(args.books); booksRef.current = args.books;
  const collectionsRef = useRef(args.collections); collectionsRef.current = args.collections;
  const applyRef = useRef(args.applyState); applyRef.current = args.applyState;
  const collectionsFnRef = useRef(args.replaceCollections); collectionsFnRef.current = args.replaceCollections;
  const userId = currentUser()?.id;
  const ready = useRef('');
  const stopped = useRef(false);
  const running = useRef(false);
  const retryDelay = useRef(1500);
  const ignoreState = useRef('');
  const ignoreCollections = useRef('');
  const previousCollections = useRef(args.collections);

  useEffect(() => {
    stopped.current = false;
    ready.current = '';
    if (!userId) return () => { stopped.current = true; };
    let cancelRealtime: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const applyRemote = (remote: Awaited<ReturnType<typeof loadRemoteLibrary>>, preferRemote: boolean) => {
      if (!remote) return null;
      const localCollections = loadCollections();
      // Records paused by a conflict stay exactly as they are here; everything else keeps refreshing.
      const merged = mergeRemoteLibrary(stateRef.current, localCollections, remote, exportCoverPicks(), preferRemote, pausedLibraryKeys(userId));
      const stateJson = JSON.stringify(merged.state);
      if (stateJson !== JSON.stringify(stateRef.current)) {
        ignoreState.current = stateJson;
        applyRef.current(() => merged.state);
      }
      const collectionJson = JSON.stringify(merged.collections);
      if (collectionJson !== JSON.stringify(localCollections)) {
        ignoreCollections.current = collectionJson;
        collectionsFnRef.current(merged.collections);
      }
      if (JSON.stringify(merged.coverPicks) !== JSON.stringify(exportCoverPicks())) restoreCoverPicks(merged.coverPicks);
      if (merged.nookLook && JSON.stringify(merged.nookLook) !== JSON.stringify(exportNookLook() || null)) restoreNookLook(JSON.stringify({ nookLook: merged.nookLook }));
      return merged;
    };

    const bootstrap = async () => {
      if (stopped.current || running.current || !librarySyncAccountAllowed(userId) || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
      claimLibrarySyncAccount(userId);
      running.current = true;
      try {
        const remote = await loadRemoteLibrary(userId);
        if (stopped.current || currentUser()?.id !== userId) return;
        if (!remote) throw new Error('incomplete cloud snapshot');
        const merged = applyRemote(remote, false);
        if (!merged) throw new Error('incomplete cloud snapshot');
        const ok = await syncLocalLibrary(userId, { state: merged.state, books: booksRef.current, collections: merged.collections, coverPicks: merged.coverPicks });
        if (!ok) throw new Error('cloud write deferred');
        ready.current = userId;
        retryDelay.current = 1500;
        cancelRealtime = subscribeLibraryRealtime(userId, async () => {
          if (stopped.current || currentUser()?.id !== userId || hasPendingLibrarySync(userId)) return;
          const latest = await loadRemoteLibrary(userId);
          if (latest) applyRemote(latest, true);
        });
      } catch {
        if (!stopped.current) {
          retryTimer = setTimeout(() => void bootstrap(), retryDelay.current);
          retryDelay.current = Math.min(60_000, retryDelay.current * 2);
        }
      } finally { running.current = false; }
    };

    const flush = async () => {
      if (stopped.current || ready.current !== userId || running.current || currentUser()?.id !== userId) return;
      running.current = true;
      try {
        const ok = await syncLocalLibrary(userId, { state: stateRef.current, books: booksRef.current, collections: collectionsRef.current, coverPicks: exportCoverPicks() });
        if (!ok && !stopped.current) {
          retryTimer = setTimeout(() => void flush(), retryDelay.current);
          retryDelay.current = Math.min(60_000, retryDelay.current * 2);
        } else {
          retryDelay.current = 1500;
          if (ok) {
            const latest = await loadRemoteLibrary(userId);
            if (latest && !stopped.current && currentUser()?.id === userId) applyRemote(latest, true);
          }
        }
      } finally { running.current = false; }
    };

    /** "Use cloud": push this device's unconflicted edits first, then take the cloud copy of the paused records only. */
    const useCloud = async () => {
      if (stopped.current || ready.current !== userId || running.current || currentUser()?.id !== userId) return;
      running.current = true;
      try {
        await syncLocalLibrary(userId, { state: stateRef.current, books: booksRef.current, collections: collectionsRef.current, coverPicks: exportCoverPicks() });
        const remote = await loadRemoteLibrary(userId);
        if (!remote || stopped.current || currentUser()?.id !== userId) return;
        resolveLibraryConflictsToCloud(userId, remote);
        applyRemote(remote, true);
      } finally { running.current = false; }
    };

    void bootstrap();
    const onOnline = () => { if (ready.current !== userId) void bootstrap(); else void flush(); };
    const onUseCloud = () => void useCloud();
    const onManualSync = () => void flush();
    const onHide = () => void flush();
    window.addEventListener('online', onOnline);
    window.addEventListener('greatreads-library-sync-request', onManualSync);
    window.addEventListener('greatreads-library-use-cloud', onUseCloud);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    const poll = setInterval(() => { if (ready.current === userId && hasPendingLibrarySync(userId)) void flush(); }, 20_000);
    return () => {
      stopped.current = true;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('greatreads-library-sync-request', onManualSync);
      window.removeEventListener('greatreads-library-use-cloud', onUseCloud);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      clearInterval(poll);
      if (retryTimer) clearTimeout(retryTimer);
      cancelRealtime?.();
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || ready.current !== userId) return;
    const current = JSON.stringify(args.state);
    if (ignoreState.current && ignoreState.current === current) { ignoreState.current = ''; return; }
    const timer = setTimeout(() => {
      if (currentUser()?.id === userId && ready.current === userId) void syncLocalLibrary(userId, { state: stateRef.current, books: booksRef.current, collections: collectionsRef.current, coverPicks: exportCoverPicks() });
    }, 500);
    return () => clearTimeout(timer);
  }, [args.state, userId]);

  useEffect(() => {
    if (!userId || ready.current !== userId) return;
    const current = JSON.stringify(args.collections);
    if (ignoreCollections.current && ignoreCollections.current === current) { ignoreCollections.current = ''; previousCollections.current = args.collections; return; }
    const currentById = new Map(args.collections.map(collection => [collection.id, collection]));
    for (const collection of previousCollections.current) {
      const next = currentById.get(collection.id);
      if (!next) markPersonalCollectionDeleted(collection.id, userId);
      else for (const bookId of collection.bookIds) if (!next.bookIds.includes(bookId)) markPersonalMembershipDeleted(collection.id, bookId, userId);
    }
    previousCollections.current = args.collections;
    const timer = setTimeout(() => {
      if (currentUser()?.id === userId && ready.current === userId) void syncLocalLibrary(userId, { state: stateRef.current, books: booksRef.current, collections: collectionsRef.current, coverPicks: exportCoverPicks() });
    }, 500);
    return () => clearTimeout(timer);
  }, [args.collections, userId]);
}
