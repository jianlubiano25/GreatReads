import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunGate } from './runGate';
import { createLinkHealth } from './linkHealth';
import { createProbeWatcher, probeFingerprint, type ProbeRest } from './changeProbe';

test('run gate: one run at a time, and a finished run frees the lock', () => {
  let t = 0; const gate = createRunGate(1000, () => t);
  const a = gate.enter(); assert.ok(a > 0);
  assert.equal(gate.enter(), 0);
  gate.leave(a);
  assert.ok(gate.enter() > 0);
});

test('run gate: a run that hangs forever does not block sync forever, and its late leave cannot free a newer run', () => {
  let t = 0; const gate = createRunGate(1000, () => t);
  const hung = gate.enter();
  t = 999; assert.equal(gate.enter(), 0, 'still within the hold time');
  t = 1001;
  const fresh = gate.enter(); assert.ok(fresh > 0 && fresh !== hung, 'a stuck holder is given up on');
  gate.leave(hung);                  // the hung request finally ends
  assert.equal(gate.busy(), true, 'the newer run keeps its lock');
  assert.equal(gate.enter(), 0);
  gate.leave(fresh);
  assert.equal(gate.busy(), false);
});

test('link health: silence, a closed socket or a failed channel means rebuild; any message keeps it alive', () => {
  const h = createLinkHealth(60_000);
  h.opened(0);
  assert.equal(h.shouldRebuild(30_000, true), false);
  assert.equal(h.shouldRebuild(61_000, true), true, 'nothing heard for over a minute');
  h.heard(61_000);
  assert.equal(h.shouldRebuild(100_000, true), false);
  assert.equal(h.shouldRebuild(100_000, false), true, 'socket is not open');
  h.channelFailed();
  assert.equal(h.shouldRebuild(100_000, true), true, 'server refused the channel');
  h.opened(120_000);
  assert.equal(h.shouldRebuild(121_000, true), false, 'a new connection starts healthy');
});

const fakeRest = (db: Record<string, unknown[] | null>): ProbeRest => async <T,>(path: string) => {
  const table = path.split('?')[0];
  const rows = db[table];
  return rows ? { ok: true, data: rows as T } : { ok: false };
};

test('probe: the first reading is only a baseline; a changed revision is a change; unreadable is never a change', async () => {
  const db: Record<string, unknown[] | null> = { user_library_preferences: [{ revision: 3 }], user_settings: [{ key: 'theme', revision: 1 }], user_words: [], user_daily_pages: [{ day: '2026-10-25', revision: 2 }], user_library_books: [], user_book_annotations: [], user_shelves: [], user_shelf_books: [] };
  const rest = fakeRest(db); const watcher = createProbeWatcher();
  assert.equal(watcher.changed(await probeFingerprint('u', rest)), false);
  assert.equal(watcher.changed(await probeFingerprint('u', rest)), false, 'nothing changed');
  db.user_settings = [{ key: 'theme', revision: 2 }];
  assert.equal(watcher.changed(await probeFingerprint('u', rest)), true);
  assert.equal(watcher.changed(await probeFingerprint('u', rest)), false, 'seen once, not again');
  db.user_daily_pages = [{ day: '2026-10-25', revision: 3 }];
  assert.equal(watcher.changed(await probeFingerprint('u', rest)), true, 'a new page count is noticed');
  assert.equal(watcher.changed(null), false);
});

test('probe: a table that does not exist yet does not break the probe', async () => {
  const db: Record<string, unknown[] | null> = { user_library_preferences: [{ revision: 1 }], user_settings: null, user_words: null, user_daily_pages: [], user_library_books: [], user_book_annotations: [], user_shelves: [], user_shelf_books: [] };
  const fp = await probeFingerprint('u', fakeRest(db));
  assert.ok(fp && fp.includes('user_settings:x'));
});

import { rest, setRequestTimeoutMs } from './supabase';

test('a request that never answers gives up instead of freezing sync', async () => {
  const realFetch = globalThis.fetch;
  const realStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 } });
  globalThis.fetch = ((_url: unknown, init: RequestInit = {}) => new Promise((_resolve, reject) => { init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); })) as typeof fetch; // a hung request
  setRequestTimeoutMs(60);
  try {
    const started = Date.now();
    const r = await rest('user_settings?select=key');
    assert.equal(r.ok, false);
    assert.ok(Date.now() - started < 1500, 'it returned promptly');
  } finally {
    setRequestTimeoutMs(25_000);
    globalThis.fetch = realFetch;
    if (realStorage) Object.defineProperty(globalThis, 'localStorage', realStorage); else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
