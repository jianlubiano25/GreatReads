// Decides WHEN this device sends its changes to the cloud and WHEN it reads the cloud's. No React in here, so it can be tested with fake timers.
//  - one cycle at a time; anything that arrives meanwhile is folded into one more cycle (a burst of cloud events is one read, not one per event)
//  - the person's changes are sent first; the cloud copy is applied only when nothing unsent is waiting (it would overwrite it otherwise)
//  - sending an edit does not read the cloud back: other devices' changes arrive through events, on return to the app, on reconnecting, or when a send finds newer cloud values
//  - failures retry later with growing gaps, and not at all while offline (coming back online starts it again)
import { hasPendingLibrarySync, loadRemoteLibrary, markLibraryDirty, syncLocalLibraryDetailed, type RemoteLibrarySnapshot, type RemoteTable, type SyncArgs } from './librarySync';

export type SyncControllerDeps = {
  userId: string;
  getArgs: () => SyncArgs;
  /** Bring the cloud copy into the app (the cloud's values win where this device has nothing unsent). */
  applyRemote: (remote: RemoteLibrarySnapshot) => void;
  isCurrentUser?: () => boolean;
  online?: () => boolean;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  pushDelayMs?: number; pullDelayMs?: number; resumeGapMs?: number; warmMs?: number; retryBaseMs?: number; retryMaxMs?: number;
};
export type SyncController = {
  /** The person changed something. */ edited(): void;
  /** The cloud reported a change (optionally naming the table). */ realtime(table?: RemoteTable): void;
  /** The app came back to the foreground, or the network came back. */ resume(): void;
  /** The live connection (re)opened: anything missed while it was down is read now (unless the cloud was read a moment ago). */ connected(): void;
  /** The cloud was just read and applied elsewhere (the first sync after signing in). */ noteSynced(): void;
  /** The app is being hidden: send what is waiting. */ hidden(): void;
  /** "Sync now": send, then re-read everything. */ manual(): void;
  dispose(): void;
  /** Resolves when no cycle is running (tests). */ whenIdle(): Promise<void>;
};

export function createLibrarySyncController(d: SyncControllerDeps): SyncController {
  const now = d.now ?? Date.now;
  const online = d.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const setTimer = d.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = d.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const pushDelay = d.pushDelayMs ?? 500, pullDelay = d.pullDelayMs ?? 400, resumeGap = d.resumeGapMs ?? 15_000, warm = d.warmMs ?? 30_000;
  const retryBase = d.retryBaseMs ?? 1500, retryMax = d.retryMaxMs ?? 60_000;
  const isCurrent = d.isCurrentUser ?? (() => true);

  let disposed = false, running = false, again = false;
  let wantPull = false, wantFull = false; let wantTables: Set<RemoteTable> | 'all' = new Set();
  let timer: unknown, retryTimer: unknown, retryDelay = retryBase, lastPullAt = 0, current: Promise<void> = Promise.resolve();

  const schedule = (ms: number) => { if (disposed) return; if (timer) clearTimer(timer); timer = setTimer(() => { timer = undefined; void run(); }, ms); };
  const want = (table?: RemoteTable) => { wantPull = true; if (!table) wantTables = 'all'; else if (wantTables !== 'all') wantTables.add(table); };
  const retry = () => {
    if (disposed || !online()) return; // the 'online' event starts it again
    if (retryTimer) clearTimer(retryTimer);
    retryTimer = setTimer(() => { retryTimer = undefined; void run(); }, retryDelay);
    retryDelay = Math.min(retryMax, retryDelay * 2);
  };

  const cycle = async (): Promise<void> => {
    do {
      again = false;
      if (disposed || !isCurrent() || !online()) return;
      const pull = wantPull, full = wantFull, tables = wantTables;
      wantPull = false; wantFull = false; wantTables = new Set();
      const restore = () => { if (pull) { wantPull = true; wantFull = wantFull || full; if (tables === 'all' || wantTables === 'all') wantTables = 'all'; else tables.forEach(t => (wantTables as Set<RemoteTable>).add(t)); } };
      let stale = false;
      if (hasPendingLibrarySync(d.userId)) {
        const sent = await syncLocalLibraryDetailed(d.userId, d.getArgs(), { maxAgeMs: warm });
        if (!sent.ok) { restore(); retry(); return; }
        retryDelay = retryBase; stale = sent.stale;
      }
      if (!pull && !stale) continue;
      const latest = await loadRemoteLibrary(d.userId, { full, tables: stale || tables === 'all' || tables.size === 0 ? undefined : [...tables] });
      if (!latest) { wantPull = true; wantTables = 'all'; retry(); return; }
      lastPullAt = now(); retryDelay = retryBase;
      if (disposed || !isCurrent()) return;
      // the person changed something while the cloud was being read: send it first (applying now would overwrite it), then read again
      if (hasPendingLibrarySync(d.userId)) { wantPull = true; wantTables = 'all'; again = true; continue; }
      d.applyRemote(latest);
    } while (again && !disposed);
  };
  async function run(): Promise<void> {
    if (disposed) return;
    if (running) { again = true; return; }
    running = true;
    current = (async () => { try { await cycle(); } finally { running = false; } })();
    await current;
    // a request that arrived while the cycle was finishing is not lost (unless a retry is already waiting its turn)
    if (again && !disposed && !retryTimer) { again = false; schedule(0); }
  }

  return {
    edited() { if (disposed) return; markLibraryDirty(d.userId); schedule(pushDelay); },
    realtime(table) { if (disposed) return; want(table); schedule(pullDelay); },
    resume() { if (disposed) return; if (now() - lastPullAt >= resumeGap || hasPendingLibrarySync(d.userId)) { want(); schedule(0); } },
    connected() { if (disposed) return; if (now() - lastPullAt < 3000 && !hasPendingLibrarySync(d.userId)) return; want(); schedule(0); },
    noteSynced() { lastPullAt = now(); },
    hidden() { if (disposed) return; if (hasPendingLibrarySync(d.userId)) schedule(0); },
    manual() { if (disposed) return; want(); wantFull = true; schedule(0); },
    dispose() { disposed = true; if (timer) clearTimer(timer); if (retryTimer) clearTimer(retryTimer); },
    whenIdle: async () => { await current; },
  };
}
