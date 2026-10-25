import { useEffect, useRef } from 'react';
import type { Book, ReadingState } from '../types';
import { currentUser, subscribeLibraryRealtime } from '../services/supabase';
import { exportCoverPicks, restoreCoverPicks } from '../services/books/covers';
import { loadCollections, type Collection } from '../services/libraryCollections';
import { exportNookLook, restoreNookLook } from '../services/nookPrefs';
import { applyDeviceSettings } from '../services/deviceSettings';
import { acknowledgeCloudCopy, claimLibrarySyncAccount, hasPendingLibrarySync, librarySyncAccountAllowed, loadRemoteLibrary, markPersonalCollectionDeleted, markPersonalMembershipDeleted, mergeRemoteLibrary, pausedLibraryKeys, resolveLibraryConflictsToCloud, syncLocalLibrary } from '../services/librarySync';
import { resolveSettingTie, syncSettingsRecords, type SettingKey } from '../services/settingsRecordsSync';
import { settingsRecordsSyncEnabled } from '../services/settingsRecordsFlag';
import { keepDeviceDay, loadDailyTies, syncDailyPages, takeCloudDay } from '../services/dailyPagesSync';

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
  const daysRunning = useRef(false);
  const daysAgain = useRef(false);
  const settingsRunning = useRef(false);
  const settingsAgain = useRef(false);
  const retryDelay = useRef(1500);
  const ignoreState = useRef('');
  const ignoreCollections = useRef('');
  const previousCollections = useRef(args.collections);
  const lastDays = useRef<{ log: unknown; meta: unknown }>({ log: args.state.dailyLog, meta: args.state.dailyLogMeta });

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
      if (preferRemote) acknowledgeCloudCopy(userId, remote); // this device has now taken the cloud's copy: its next edit is not a conflict
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
      applyDeviceSettings(merged.deviceSettings); // store layout, fonts, nook toggles and name choices (touches only what differs)
      return merged;
    };

    /** Per-day pages: pull the cloud's days, apply the newer ones, upload this device's newer ones. Never runs twice at once; a request that arrives meanwhile runs once more after. */
    const syncDays = async (): Promise<boolean> => {
      if (stopped.current || ready.current !== userId || currentUser()?.id !== userId) return true;
      if (daysRunning.current) { daysAgain.current = true; return true; }
      daysRunning.current = true;
      try {
        let ok = true;
        do {
          daysAgain.current = false;
          ok = await syncDailyPages(userId, { getState: () => stateRef.current, apply: change => applyRef.current(change) }) && ok;
        } while (daysAgain.current && !stopped.current);
        return ok;
      } catch { return false; } finally { daysRunning.current = false; }
    };

    /** Phase 4 per-setting and per-word records. Does nothing (returns true) while the switch is off. Never runs twice at once; a request that arrives meanwhile runs once more after. */
    const syncSettings = async (): Promise<boolean> => {
      if (!settingsRecordsSyncEnabled()) return true;
      if (stopped.current || ready.current !== userId || currentUser()?.id !== userId) return true;
      if (settingsRunning.current) { settingsAgain.current = true; return true; }
      settingsRunning.current = true;
      try {
        let ok = true;
        do {
          settingsAgain.current = false;
          ok = await syncSettingsRecords(userId, { getState: () => stateRef.current, apply: change => applyRef.current(change) }) && ok;
        } while (settingsAgain.current && !stopped.current);
        return ok;
      } catch { return false; } finally { settingsRunning.current = false; }
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
        if (!await syncDays()) throw new Error('daily pages deferred');
        if (!await syncSettings()) setTimeout(() => void syncSettings(), retryDelay.current); // never blocks the rest of sync (for example while the two tables are not there yet)
        cancelRealtime = subscribeLibraryRealtime(userId, async table => {
          if (stopped.current || currentUser()?.id !== userId) return;
          if (table === 'user_daily_pages') { void syncDays(); return; }
          if (table === 'user_settings' || table === 'user_words') { void syncSettings(); return; }
          if (hasPendingLibrarySync(userId)) return;
          const latest = await loadRemoteLibrary(userId);
          if (latest) applyRemote(latest, true);
          if (table === 'resync') { void syncDays(); void syncSettings(); } // after a reconnect, anything may have changed
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
        const daysOk = await syncDays();
        const settingsOk = await syncSettings();
        if ((!ok || !daysOk || !settingsOk) && !stopped.current) {
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

    /** The owner chose a value for a day where two devices made different edits at the very same moment. */
    const onDailyTie = (event: Event) => {
      const { day, choice } = (event as CustomEvent<{ day: string; choice: 'device' | 'cloud' }>).detail || {};
      const tie = loadDailyTies(userId).find(item => item.day === day);
      if (!tie) return;
      applyRef.current(prev => choice === 'cloud' ? takeCloudDay(prev, tie) : keepDeviceDay(prev, day));
      setTimeout(() => void syncDays(), 0);
    };

    /** The owner chose a value for a setting where two devices made different edits at the very same moment. (No screen asks yet: see the Phase 4 report.) */
    const onSettingTie = (event: Event) => {
      const { key, choice } = (event as CustomEvent<{ key: SettingKey; choice: 'device' | 'cloud' }>).detail || {};
      resolveSettingTie(userId, key, choice);
      setTimeout(() => void syncSettings(), 0);
    };

    void bootstrap();
    const onOnline = () => { if (ready.current !== userId) void bootstrap(); else void flush(); };
    const onUseCloud = () => void useCloud();
    const onDaysRun = () => void syncDays();
    let localChangeTimer: ReturnType<typeof setTimeout> | undefined;
    const onLocalChange = () => { void syncSettings(); if (localChangeTimer) clearTimeout(localChangeTimer); localChangeTimer = setTimeout(() => void flush(), 800); };
    const onSettingsRun = () => void syncSettings();
    const onManualSync = () => void flush();
    const onHide = () => void flush();
    window.addEventListener('online', onOnline);
    window.addEventListener('greatreads-library-sync-request', onManualSync);
    window.addEventListener('greatreads-library-use-cloud', onUseCloud);
    window.addEventListener('greatreads-daily-tie', onDailyTie);
    window.addEventListener('greatreads-daily-pages-run', onDaysRun);
    window.addEventListener('greatreads-setting-tie', onSettingTie);
    window.addEventListener('greatreads-settings-records-run', onSettingsRun);
    window.addEventListener('greatreads-library-local-change', onLocalChange);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    const poll = setInterval(() => { if (ready.current === userId && hasPendingLibrarySync(userId)) void flush(); }, 20_000);
    return () => {
      stopped.current = true;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('greatreads-library-sync-request', onManualSync);
      window.removeEventListener('greatreads-library-use-cloud', onUseCloud);
      window.removeEventListener('greatreads-daily-tie', onDailyTie);
      window.removeEventListener('greatreads-daily-pages-run', onDaysRun);
      window.removeEventListener('greatreads-setting-tie', onSettingTie);
      window.removeEventListener('greatreads-settings-records-run', onSettingsRun);
      window.removeEventListener('greatreads-library-local-change', onLocalChange);
      if (localChangeTimer) clearTimeout(localChangeTimer);
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
    const daysChanged = lastDays.current.log !== args.state.dailyLog || lastDays.current.meta !== args.state.dailyLogMeta;
    lastDays.current = { log: args.state.dailyLog, meta: args.state.dailyLogMeta };
    // Day edits upload on their own short timer, so a quick page tap never waits for the slower library sync.
    const daysTimer = daysChanged ? setTimeout(() => window.dispatchEvent(new Event('greatreads-daily-pages-run')), 300) : undefined;
    const settingsTimer = settingsRecordsSyncEnabled() ? setTimeout(() => window.dispatchEvent(new Event('greatreads-settings-records-run')), 300) : undefined; // a goal, name, words... changed: upload it now as its own record
    if (ignoreState.current && ignoreState.current === current) { ignoreState.current = ''; return () => { if (daysTimer) clearTimeout(daysTimer); if (settingsTimer) clearTimeout(settingsTimer); }; }
    const timer = setTimeout(() => {
      if (currentUser()?.id === userId && ready.current === userId) void syncLocalLibrary(userId, { state: stateRef.current, books: booksRef.current, collections: collectionsRef.current, coverPicks: exportCoverPicks() });
    }, 500);
    return () => { clearTimeout(timer); if (daysTimer) clearTimeout(daysTimer); if (settingsTimer) clearTimeout(settingsTimer); };
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
