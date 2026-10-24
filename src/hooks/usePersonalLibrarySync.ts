import { useEffect, useRef } from 'react';
import type { Book, ReadingState } from '../types';
import { currentUser, subscribeLibraryRealtime } from '../services/supabase';
import { exportCoverPicks, restoreCoverPicks } from '../services/books/covers';
import { loadCollections, type Collection } from '../services/libraryCollections';
import { exportNookLook, restoreNookLook } from '../services/nookPrefs';
import { claimLibrarySyncAccount, librarySyncAccountAllowed, loadRemoteLibrary, markPersonalCollectionDeleted, markPersonalMembershipDeleted, mergeRemoteLibrary, syncLocalLibraryDetailed } from '../services/librarySync';
import { createLibrarySyncController, type SyncController } from '../services/librarySyncController';

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
  const controller = useRef<SyncController | null>(null);
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
      const merged = mergeRemoteLibrary(stateRef.current, localCollections, remote, exportCoverPicks(), preferRemote);
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
        // the cloud was read a moment ago: no need to read it again before writing
        const sent = await syncLocalLibraryDetailed(userId, { state: merged.state, books: booksRef.current, collections: merged.collections, coverPicks: merged.coverPicks }, { maxAgeMs: 30_000 });
        if (!sent.ok) throw new Error('cloud write deferred');
        ready.current = userId;
        retryDelay.current = 1500;
        const sync = createLibrarySyncController({
          userId,
          getArgs: () => ({ state: stateRef.current, books: booksRef.current, collections: collectionsRef.current, coverPicks: exportCoverPicks() }),
          applyRemote: latest => void applyRemote(latest, true),
          isCurrentUser: () => !stopped.current && currentUser()?.id === userId,
        });
        controller.current = sync;
        sync.noteSynced();
        cancelRealtime = subscribeLibraryRealtime(userId, table => sync.realtime(table as Parameters<SyncController['realtime']>[0]), () => sync.connected());
      } catch {
        if (!stopped.current) {
          retryTimer = setTimeout(() => void bootstrap(), retryDelay.current);
          retryDelay.current = Math.min(60_000, retryDelay.current * 2);
        }
      } finally { running.current = false; }
    };

    void bootstrap();
    const onOnline = () => { if (ready.current !== userId) void bootstrap(); else controller.current?.resume(); };
    const onManualSync = () => controller.current?.manual();
    const onPageHide = () => controller.current?.hidden();
    const onVisibility = () => { if (document.visibilityState === 'hidden') controller.current?.hidden(); else controller.current?.resume(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('greatreads-library-sync-request', onManualSync);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    const poll = setInterval(() => { if (ready.current === userId) controller.current?.hidden(); }, 20_000); // sends anything still waiting
    return () => {
      stopped.current = true;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('greatreads-library-sync-request', onManualSync);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(poll);
      if (retryTimer) clearTimeout(retryTimer);
      cancelRealtime?.();
      controller.current?.dispose();
      controller.current = null;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || ready.current !== userId) return;
    const current = JSON.stringify(args.state);
    if (ignoreState.current && ignoreState.current === current) { ignoreState.current = ''; return; }
    controller.current?.edited(); // stamped now, sent after a short pause
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
    controller.current?.edited();
  }, [args.collections, userId]);
}
