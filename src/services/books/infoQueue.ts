import type { Book } from '../../types';
import { transientFailureCount } from './http';
import { ensureBookInfo, infoKey, missingFields } from './infoStore';

/**
 * Background enrichment: fills in what Book Info lacks (ratings, pages, year, synopsis, author bio) for books nobody has opened yet, so their
 * sheets already hold it. It runs only while the app is open and online, a few books at a time, and never blocks the screen:
 *  - priority 0 = books on screen (Store shelves that scrolled into view) and your Library; priority 1 = everything else, in small batches;
 *  - at most `concurrency` books at once, with a pause between starts, a longer pause between batches of low-priority books, and a cool-down
 *    after a rate limit or an outage (a failed lookup is retried later by the cache's own backoff, see infoStore.ts);
 *  - the same book is never queued or fetched twice, and a book whose fields are all known (or waiting out a "no data" / backoff) costs nothing;
 *  - it pauses while the app is hidden or offline and carries on when it is back.
 */

export interface QueueEnv {
  online: () => boolean;
  visible: () => boolean;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export interface QueueOptions {
  concurrency: number;
  /** pause before starting the next book */
  gapMs: number;
  /** low-priority books are taken this many at a time ... */
  batchSize: number;
  /** ... with this pause after each batch */
  batchPauseMs: number;
  /** after a lookup hit a rate limit / outage, nothing new starts for this long */
  cooldownMs: number;
  /** a book that was just run may be queued again after this long (it still costs nothing unless a field is due) */
  rerunAfterMs: number;
}

export const QUEUE_DEFAULTS: QueueOptions = { concurrency: 2, gapMs: 500, batchSize: 5, batchPauseMs: 6000, cooldownMs: 45000, rerunAfterMs: 5 * 60 * 1000 };

type Item = { key: string; book: Book; priority: number };

export function createInfoQueue(run: (book: Book) => Promise<void>, env: QueueEnv, options: Partial<QueueOptions> = {}) {
  const o = { ...QUEUE_DEFAULTS, ...options };
  const waiting = new Map<string, Item>(); // by book key: a book is queued once, at its best priority
  const active = new Set<string>();
  const doneAt = new Map<string, number>(); // a book that was just run is not queued again for a while (the cache decides what is still due: a failure waits out its own backoff)
  const justDone = (key: string) => { const t = doneAt.get(key); return t !== undefined && env.now() - t < o.rerunAfterMs; };
  let cooldownUntil = 0;
  let sinceBatchPause = 0;
  let pumping = false;
  let idleWaiters: Array<() => void> = [];
  let started = 0; // total books started (tests)

  const canRun = () => env.online() && env.visible();
  const next = (): Item | undefined => {
    let best: Item | undefined;
    for (const it of waiting.values()) if (!best || it.priority < best.priority) best = it; // map order = arrival order within a priority
    return best;
  };
  const settleIdle = () => { if (!waiting.size && !active.size) { idleWaiters.forEach(r => r()); idleWaiters = []; } };

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (waiting.size) {
        if (!canRun()) break; // resume() starts it again
        if (active.size >= o.concurrency) { await Promise.race([...active].map(k => inflight.get(k)!)); continue; }
        const wait = cooldownUntil - env.now();
        if (wait > 0) { await env.sleep(wait); continue; }
        const it = next()!;
        waiting.delete(it.key);
        if (justDone(it.key) || active.has(it.key)) continue;
        // low-priority books go in small batches, with a longer rest between them
        if (it.priority > 0 && sinceBatchPause >= o.batchSize) { sinceBatchPause = 0; waiting.set(it.key, it); await env.sleep(o.batchPauseMs); continue; }
        if (it.priority > 0) sinceBatchPause++;
        start(it);
        await env.sleep(o.gapMs);
      }
    } finally {
      pumping = false;
      settleIdle();
    }
  }

  const inflight = new Map<string, Promise<void>>();
  function start(it: Item) {
    active.add(it.key);
    doneAt.set(it.key, env.now());
    started++;
    const before = transientFailureCount();
    const p = run(it.book)
      .catch(() => {})
      .then(() => { if (transientFailureCount() > before) cooldownUntil = Math.max(cooldownUntil, env.now() + o.cooldownMs); })
      .finally(() => { active.delete(it.key); inflight.delete(it.key); if (!pumping && waiting.size) void pump(); settleIdle(); });
    inflight.set(it.key, p);
  }

  return {
    /** Queue books (skipping any that need nothing). A book already queued moves up if it now has a better priority. */
    enqueue(books: readonly Book[], priority: 0 | 1) {
      for (const book of books) {
        const key = infoKey(book);
        if (justDone(key) || active.has(key)) continue;
        const queued = waiting.get(key);
        if (queued) { if (priority < queued.priority) queued.priority = priority; continue; }
        if (!missingFields(book).length) continue;
        waiting.set(key, { key, book, priority });
      }
      void pump();
    },
    /** Call when the app becomes visible or comes back online. */
    resume() { void pump(); },
    /** Forget which books were just run (tests). */
    reset() { doneAt.clear(); },
    size: () => waiting.size,
    activeCount: () => active.size,
    startedCount: () => started,
    /** Resolves when nothing is waiting or running (it may stay unresolved while paused offline / hidden). */
    idle: () => (!waiting.size && !active.size ? Promise.resolve() : new Promise<void>(r => idleWaiters.push(r))),
  };
}

// ---- the app's one queue ----
const browserEnv: QueueEnv = {
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  visible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  now: () => Date.now(),
  sleep: ms => new Promise<void>(r => setTimeout(r, ms)),
};

let shared: ReturnType<typeof createInfoQueue> | undefined;
let wired = false;
export function infoQueue() {
  shared ??= createInfoQueue(async book => { await ensureBookInfo(book); }, browserEnv);
  if (!wired && typeof window !== 'undefined') {
    wired = true;
    const go = () => shared?.resume();
    document.addEventListener('visibilitychange', go);
    window.addEventListener('online', go);
  }
  return shared;
}

/** Ask for books to be enriched in the background. Cheap to call often (each render pass): books that need nothing are skipped. */
export const enrichInBackground = (books: readonly Book[], priority: 0 | 1 = 0) => infoQueue().enqueue(books, priority);
