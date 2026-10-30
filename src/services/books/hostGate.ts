/**
 * A polite gate in front of one rate-limited website (Google Books). Found by the owner's iPad log (2026-10-30): 534 of 560 Google requests in
 * 5.6 minutes answered 429 "too many requests", because background lookups (ratings, book info) fired as fast as they could and kept the quota
 * empty, so Search, Discover and Hidden gems waited 10-15 minutes.
 *
 * - Requests start at least `minGapMs` apart (about 80 a minute), the user's own searches ('fg') before background lookups ('bg').
 * - Too many background requests waiting: the extra ones are refused at once (callers treat that as a temporary failure and retry later).
 * - After a 429 the gate closes (30 s, then 60 s, 2 min, 5 min while it keeps happening): nothing is sent, everything waiting is refused.
 * Measurement only for its own state; it never throws and never touches data.
 */
export type Priority = 'fg' | 'bg';

export interface GateOptions {
  minGapMs: number;
  maxBackground: number;
  backoffMs: number[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface Waiting { priority: Priority; resolve: (go: boolean) => void; signal?: AbortSignal }

export function createGate(o: GateOptions) {
  const now = o.now ?? (() => Date.now());
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  let nextAllowed = 0;
  let blockedUntil = 0;
  let step = 0;
  let pumping = false;
  const queue: Waiting[] = [];

  const refuseAll = () => { while (queue.length) queue.shift()!.resolve(false); };

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) {
        const wait = nextAllowed - now();
        if (wait > 0) await sleep(wait);
        if (now() < blockedUntil) { refuseAll(); break; }
        let i = queue.findIndex(w => w.priority === 'fg');
        if (i < 0) i = 0;
        const w = queue.splice(i, 1)[0];
        if (w.signal?.aborted) { w.resolve(false); continue; }
        nextAllowed = now() + o.minGapMs;
        w.resolve(true);
      }
    } finally { pumping = false; }
  }

  return {
    /** true = go ahead and send the request; false = do not send (gate closed, queue full or cancelled). */
    acquire(priority: Priority, signal?: AbortSignal): Promise<boolean> {
      if (now() < blockedUntil || signal?.aborted) return Promise.resolve(false);
      if (priority === 'bg' && queue.filter(w => w.priority === 'bg').length >= o.maxBackground) return Promise.resolve(false);
      return new Promise<boolean>(resolve => { queue.push({ priority, resolve, signal }); void pump(); });
    },
    /** The website answered 429: close the gate and refuse everything waiting. */
    tripped(retryAfterMs = 0): void {
      const wait = Math.max(retryAfterMs, o.backoffMs[Math.min(step, o.backoffMs.length - 1)]);
      step++;
      blockedUntil = now() + wait;
      refuseAll();
    },
    /** A good answer: the next 429 starts the back-off from the beginning again. */
    ok(): void { step = 0; },
    blockedForMs: (): number => Math.max(0, blockedUntil - now()),
    waiting: (): number => queue.length,
    reset(): void { nextAllowed = 0; blockedUntil = 0; step = 0; refuseAll(); },
  };
}
