import test from 'node:test';
import assert from 'node:assert/strict';
import { createGate } from './hostGate';
import { searchGoogle, setGoogleGateForTests, setGoogleModeForTests, setBrowserForTests } from './sources/googleBooks';

const make = (over: Partial<Parameters<typeof createGate>[0]> = {}) => {
  let t = 1_000;
  const sleeps: number[] = [];
  const gate = createGate({ minGapMs: 750, maxBackground: 2, backoffMs: [30_000, 60_000], now: () => t, sleep: async ms => { sleeps.push(ms); t += ms; }, ...over });
  return { gate, sleeps, advance: (ms: number) => { t += ms; } };
};

test('requests start at least minGapMs apart', async () => {
  const { gate, sleeps } = make();
  assert.equal(await gate.acquire('fg'), true);
  assert.equal(await gate.acquire('fg'), true);
  assert.deepEqual(sleeps, [750]);
});

test('a waiting user search goes before waiting background lookups', async () => {
  const { gate } = make();
  await gate.acquire('fg');
  const order: string[] = [];
  const bg = gate.acquire('bg').then(() => order.push('bg'));
  const fg = gate.acquire('fg').then(() => order.push('fg'));
  await Promise.all([bg, fg]);
  assert.deepEqual(order, ['fg', 'bg']);
});

test('too many waiting background lookups are refused at once, user searches are not', async () => {
  const { gate } = make();
  await gate.acquire('fg');
  const a = gate.acquire('bg'); const b = gate.acquire('bg');
  assert.equal(await gate.acquire('bg'), false);
  assert.equal(await gate.acquire('fg'), true);
  await Promise.all([a, b]);
});

test('after a 429 the gate closes, refuses what waits, backs off longer each time, and a good answer resets it', async () => {
  const { gate, advance } = make();
  await gate.acquire('fg');
  const waiting = gate.acquire('bg');
  gate.tripped();
  assert.equal(await waiting, false);
  assert.equal(await gate.acquire('fg'), false);
  advance(30_001);
  assert.equal(await gate.acquire('fg'), true);
  gate.tripped();
  assert.ok(gate.blockedForMs() > 59_000, 'second 429 waits 60 s');
  advance(60_001);
  assert.equal(await gate.acquire('fg'), true);
  gate.ok();
  gate.tripped();
  assert.ok(gate.blockedForMs() <= 30_000, 'a good answer restarts the back-off at 30 s');
});

test('Google: after one 429 no more Google requests are sent until the gate reopens (the owner iPad log, 534 of 560 were 429)', async () => {
  setBrowserForTests(true); setGoogleModeForTests('proxy'); setGoogleGateForTests(true);
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{"error":"rate_limited"}', { status: 429, headers: { 'content-type': 'application/json' } }); };
  try {
    await searchGoogle('classics', 10);
    await searchGoogle('classics', 10);
    await searchGoogle('poetry', 10);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch; setGoogleGateForTests(null); setGoogleModeForTests(null); setBrowserForTests(null);
  }
});
