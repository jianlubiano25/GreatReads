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
import { createRunGate } from '../services/runGate';
import { reportSync } from '../services/syncStatus';
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
  const daysAgain = useRef(false);
  const settingsAgain = useRef(false);
  // One-at-a-time locks that give up on a request that never answers (a suspended phone), so sync can never freeze
  const running = useRef(createRunGate(90_000));
  const daysRunning = useRef(createRunGate(60_000));
  const settingsRunning = useRef(createRunGate(60_000));
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
    // Daily pages and settings retry on their own timers, so one failing category never holds back another.
    const categoryRetry: Record<string, { timer?: ReturnType<typeof setTimeout>; delay: number }> = {};
    const retryCategory = (name: string, run: () => Promise<boolean>) => {
      const r = categoryRetry[name] || (categoryRetry[name] = { delay: 1500 });
      if (stopped.current || r.timer) return;
      r.timer = setTimeout(async () => {
        r.timer = undefined;
        if (stopped.current) return;
        if (await run()) r.delay = 1500; else { r.delay = Math.min(60_000, r.delay * 2); retryCategory(name, run); }
      }, r.delay);
    };

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
      const ticket = daysRunning.current.enter();
      if (!ticket) { daysAgain.current = true; return true; }
      try {
        let ok = true;
        do {
          daysAgain.current = false;
          ok = await syncDailyPages(userId, { getState: () => stateRef.current, apply: change => applyRef.current(change) }) && ok;
        } while (daysAgain.current && !stopped.current);
        reportSync('daily-pages', ok, ok ? undefined : 'daily pages round failed');
        return ok;
      } catch (e) { reportSync('daily-pages', false, e instanceof Error ? e.message : 'failed'); return false; } finally { daysRunning.current.leave(ticket); }
    };

    /** Phase 4 per-setting and per-word records. Does nothing (returns true) while the switch is off. Never runs twice at once; a request that arrives meanwhile runs once more after. */
    const syncSettings = async (): Promise<boolean> => {
      if (!settingsRecordsSyncEnabled()) return true;
      if (stopped.current || ready.current !== userId || currentUser()?.id !== userId) return true;
      const ticket = settingsRunning.current.enter();
      if (!ticket) { settingsAgain.current = true; return true; }
      try {
        let ok = true;
        do {
          settingsAgain.current = false;
          ok = await syncSettingsRecords(userId, { getState: () => stateRef.current, apply: change => applyRef.current(change) }) && ok;
        } while (settingsAgain.current && !stopped.current);
        reportSync('settings', ok, ok ? undefined : 'settings round failed');
        return ok;
      } catch (e) { reportSync('settings', false, e instanceof Error ? e.message : 'failed'); return false; } finally { settingsRunning.current.leave(ticket); }
    };

    /** Live updates start once the cloud copy has been merged in, and never wait for the daily pages, settings or the upload to succeed. */
    const startLive = () => {
      if (cancelRealtime || stopped.current) return;
        cancelRealtime = subscribeLibraryRealtime(userId, async table => {
          if (stopped.current || currentUser()?.id !== userId) return;
          if (table === 'user_daily_pages') { void syncDays(); return; }
          if (table === 'user_settings' || table === 'user_words') { void syncSettings(); return; }
          // After a reconnect or a "something changed" check, anything may have changed: days and settings are always refreshed, even
          // while this device has its own change waiting to upload (they never wait on the shared library record).
          if (table === 'resync') { void syncDays(); void syncSettings(); }
          // Always pull cloud changes: a pending upload must not hide the other device's edits (it used to, until the upload queue cleared).
          // While this device still has something to upload, only the cloud's NEWER STAMPED edits are applied (status, rating, page, notes,
          // words...); things with no edit time (custom book details, cover picks, removals) wait until the upload is done, so an unsent edit can never be overwritten.
          const pending = hasPendingLibrarySync(userId);
          const latest = await loadRemoteLibrary(userId);
          if (latest) { applyRemote(latest, !pending && !hasPendingLibrarySync(userId)); reportSync('library-pull', true); } else reportSync('library-pull', false, 'could not read the cloud library');
          if (pending) void flush();
        });
    };

    const bootstrap = async () => {
      if (stopped.current || !librarySyncAccountAllowed(userId) || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
      const ticket = running.current.enter();
      if (!ticket) return;
      claimLibrarySyncAccount(userId);
      try {
        const remote = await loadRemoteLibrary(userId);
        if (stopped.current || currentUser()?.id !== userId) return;
        if (!remote) throw new Error('incomplete cloud snapshot');
        const merged = applyRemote(remote, false);
        if (!merged) throw new Error('incomplete cloud snapshot');
        reportSync('library-pull', true);
        const ok = await syncLocalLibrary(userId, { state: merged.state, books: booksRef.current, collections: merged.collections, coverPicks: merged.coverPicks });
        // The cloud copy is merged in, so this device is ready and live updates start now. Each category then succeeds or retries on its own:
        // a library upload that fails, or a daily-pages or settings round that fails, never stops the others and never stops live updates.
        ready.current = userId;
        retryDelay.current = 1500;
        reportSync('library', ok, ok ? undefined : 'upload failed, will retry');
        startLive();
        if (!ok) retryTimer = setTimeout(() => void flush(), retryDelay.current);
        void (async () => {
          if (!await syncDays()) retryCategory('days', syncDays);
          if (!await syncSettings()) retryCategory('settings', syncSettings);
        })();
      } catch {
        if (!stopped.current) {
          retryTimer = setTimeout(() => void bootstrap(), retryDelay.current);
          retryDelay.current = Math.min(60_000, retryDelay.current * 2);
        }
      } finally { running.current.leave(ticket); }
    };

    const flush = async () => {
      if (stopped.current || ready.current !== userId || currentUser()?.id !== userId) return;
      const ticket = running.current.enter();
      if (!ticket) return;
      try {
        const ok = await syncLocalLibrary(userId, { state: stateRef.current, books: booksRef.current, collections: collectionsRef.current, coverPicks: exportCoverPicks() });
        reportSync('library-push', ok, ok ? undefined : 'upload failed, will retry');
        const daysOk = await syncDays();
        const settingsOk = await syncSettings();
        if ((!ok || !daysOk || !settingsOk) && !stopped.current) {
          retryTimer = setTimeout(() => void flush(), retryDelay.current);
          retryDelay.current = Math.min(60_000, retryDelay.current * 2);
        } else {
          retryDelay.current = 1500;
          if (ok) {
            const latest = await loadRemoteLibrary(userId);
            if (latest && !stopped.current && currentUser()?.id === userId) { applyRemote(latest, true); reportSync('library-pull', true); }
          }
        }
      } finally { running.current.leave(ticket); }
    };

    /** "Use cloud": push this device's unconflicted edits first, then take the cloud copy of the paused records only. */
    const useCloud = async () => {
      if (stopped.current || ready.current !== userId || currentUser()?.id !== userId) return;
      const ticket = running.current.enter();
      if (!ticket) return;
      try {
        await syncLocalLibrary(userId, { state: stateRef.current, books: booksRef.current, collections: collectionsRef.current, coverPicks: exportCoverPicks() });
        const remote = await loadRemoteLibrary(userId);
        if (!remote || stopped.current || currentUser()?.id !== userId) return;
        resolveLibraryConflictsToCloud(userId, remote);
        applyRemote(remote, true);
      } finally { running.current.leave(ticket); }
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
    // Short debounce so the other device sees library edits almost immediately without spamming every keystroke.
    const onLocalChange = () => { void syncSettings(); if (localChangeTimer) clearTimeout(localChangeTimer); localChangeTimer = setTimeout(() => void flush(), 250); };
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
    const poll = setInterval(() => { if (ready.current === userId && hasPendingLibrarySync(userId)) void flush(); }, 5_000);
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
      for (const r of Object.values(categoryRetry)) if (r.timer) clearTimeout(r.timer);
      cancelRealtime?.();
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || ready.current !== userId) return;
    const current = JSON.stringify(args.state);
    const daysChanged = lastDays.current.log !== args.state.dailyLog || lastDays.current.meta !== args.state.dailyLogMeta;
    lastDays.current = { log: args.state.dailyLog, meta: args.state.dailyLogMeta };
    // Day edits upload on their own short timer, so a quick page tap never waits for the slower library sync.
    const daysTimer = daysChanged ? setTimeout(() => window.dispatchEvent(new Event('greatreads-daily-pages-run')), 150) : undefined;
    const settingsTimer = settingsRecordsSyncEnabled() ? setTimeout(() => window.dispatchEvent(new Event('greatreads-settings-records-run')), 150) : undefined; // a goal, name, words... changed: upload it now as its own record
    if (ignoreState.current && ignoreState.current === current) { ignoreState.current = ''; return () => { if (daysTimer) clearTimeout(daysTimer); if (settingsTimer) clearTimeout(settingsTimer); }; }
    const timer = setTimeout(() => {
      if (currentUser()?.id === userId && ready.current === userId) void syncLocalLibrary(userId, { state: stateRef.current, books: booksRef.current, collections: collectionsRef.current, coverPicks: exportCoverPicks() }).then(ok => reportSync('library-push', ok, ok ? undefined : 'upload failed, will retry'));
    }, 250);
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
      if (currentUser()?.id === userId && ready.current === userId) void syncLocalLibrary(userId, { state: stateRef.current, books: booksRef.current, collections: collectionsRef.current, coverPicks: exportCoverPicks() }).then(ok => reportSync('library-push', ok, ok ? undefined : 'upload failed, will retry'));
    }, 250);
    return () => clearTimeout(timer);
  }, [args.collections, userId]);
}
