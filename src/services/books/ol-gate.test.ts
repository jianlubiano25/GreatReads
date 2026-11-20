import test from 'node:test';
import assert from 'node:assert/strict';
import { createGate } from './hostGate';
import { searchOpenLibrary, setOlGateForTests, olGate } from './sources/openLibrary';

const make = (over: Partial<Parameters<typeof createGate>[0]> = {}) =>
  createGate({ minGapMs: 0, maxBackground: 5, maxConcurrent: 2, fgBypassesBlock: true, backoffMs: [30_000], sleep: async () => {}, ...over });

test('at most maxConcurrent requests are in flight; the next one starts when one finishes', async () => {
  const gate = make();
  assert.equal(await gate.acquire('bg'), true);
  assert.equal(await gate.acquire('bg'), true);
  let third = false;
  const p = gate.acquire('bg').then(v => { third = v; });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(third, false, 'third waits');
  assert.equal(gate.inFlight(), 2);
  gate.release();
  await p;
  assert.equal(third, true);
});

test('after trouble the gate closes for background lookups only: the user search still goes', async () => {
  const gate = make();
  await gate.acquire('bg'); gate.release();
  gate.tripped();
  assert.equal(await gate.acquire('bg'), false);
  assert.equal(await gate.acquire('fg'), true);
});

test('a waiting background lookup is refused when the gate closes, a waiting user search is kept', async () => {
  const gate = make({ maxConcurrent: 1 });
  await gate.acquire('fg');
  const bg = gate.acquire('bg');
  const fg = gate.acquire('fg');
  gate.tripped();
  assert.equal(await bg, false);
  gate.release();
  assert.equal(await fg, true);
});

test('Open Library: three timeouts in a row close the gate for background lookups, the user search still goes, nothing is saved as "no book"', async () => {
  setOlGateForTests(true);
  const realFetch = globalThis.fetch;
  let calls = 0;
  let timeoutNow = true;
  globalThis.fetch = (async (_u: any, init?: any) => {
    calls++;
    if (timeoutNow) return new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('abort'))));
    return new Response(JSON.stringify({ numFound: 1, docs: [{ key: '/works/OL1W', title: 'Dune', author_name: ['Frank Herbert'] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as any;
  try {
    for (let i = 0; i < 3; i++) await searchOpenLibrary({ q: 'a' + i }, 5, { timeout: 20 });
    assert.equal(calls, 3);
    let failed = 0;
    const hits = await searchOpenLibrary({ q: 'b' }, 5, { timeout: 20, onFailure: () => { failed++; } });
    assert.deepEqual(hits, []);
    assert.equal(calls, 3, 'closed: background lookup not sent');
    assert.equal(failed, 1, 'reported as a failure, not as an empty answer');
    timeoutNow = false;
    const fg = await searchOpenLibrary({ q: 'dune' }, 5, { priority: 'fg' });
    assert.equal(fg.length, 1, 'the typed search still goes');
    assert.equal(calls, 4);
  } finally { globalThis.fetch = realFetch; setOlGateForTests(null); }
});

test('Open Library: without a browser (scripts, tests) nothing is paced', async () => {
  assert.equal(olGate.inFlight(), 0);
});
