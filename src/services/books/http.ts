/** The one place book APIs are called from: timeouts, cancellation, retry on server errors, and a small request pool. */

export interface GetOpts {
  timeout?: number;
  signal?: AbortSignal;
  retries?: number; // extra tries for 5xx / 429 / network trouble (not for 4xx)
}

export type FetchFailure = 'aborted' | 'network' | 'timeout' | 'http' | 'not-json';
export interface JsonResult {
  data: any | null;
  status: number; // HTTP status, 0 when there was no response at all
  failure?: FetchFailure;
}

/**
 * Like getJson, but says WHY it failed (status code, timeout, a page that wasn't JSON...). The status of the LAST attempt is
 * reported. Never throws. Lets callers tell "the key isn't set" from "rate limited" from "offline".
 */
export async function getJsonDetailed(url: string, { timeout = 6500, signal, retries = 0 }: GetOpts = {}): Promise<JsonResult> {
  let last: JsonResult = { data: null, status: 0, failure: 'network' };
  for (let i = 0; i <= retries; i++) {
    if (signal?.aborted) return { data: null, status: 0, failure: 'aborted' };
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (res.ok) {
        try {
          return { data: await res.json(), status: res.status };
        } catch {
          last = { data: null, status: res.status, failure: 'not-json' }; // e.g. a single-page-app fallback returned index.html
          return last; // retrying will not turn HTML into JSON
        }
      }
      last = { data: null, status: res.status, failure: 'http' };
      if (res.status < 500 && res.status !== 429) return last;
    } catch {
      last = { data: null, status: 0, failure: signal?.aborted ? 'aborted' : timedOut ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    if (i < retries) await new Promise(r => setTimeout(r, 700));
  }
  return last;
}

/** JSON from a URL, or null on any failure. Never throws. */
export async function getJson(url: string, opts: GetOpts = {}): Promise<any | null> {
  return (await getJsonDetailed(url, opts)).data;
}

/** At most `n` jobs run at once; the rest wait their turn. */
export function pool(n: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(job: () => Promise<T>): Promise<T> {
    if (active >= n) await new Promise<void>(r => waiting.push(r));
    active++;
    try {
      return await job();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

/** Many callers asking for the same thing at once share one request. */
export function dedupeInflight<T>(map: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  const running = map.get(key);
  if (running) return running;
  const p = make().finally(() => map.delete(key));
  map.set(key, p);
  return p;
}

/** Run `items` through `fn`, `n` at a time, calling `fn` for every item. */
export async function mapPool<T>(items: T[], n: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }));
}
