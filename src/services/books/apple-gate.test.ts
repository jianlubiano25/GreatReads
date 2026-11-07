import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupApple, setAppleGateForTests, appleGate } from './sources/appleBooks';

const answer = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const dune = { results: [{ trackId: 1, trackName: 'Dune', artistName: 'Frank Herbert', artworkUrl100: 'https://x.test/100x100bb.jpg', languageCodesISO2A: ['EN'], averageUserRating: 4.6, userRatingCount: 500, releaseDate: '1965-08-01T00:00:00Z' }] };

test('Apple: a 403 closes the gate; the next lookups send nothing and say "could not ask", never "Apple has no such book"', async () => {
  setAppleGateForTests(true, { minGapMs: 0 });
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return answer(403); }) as any;
  try {
    const a = await lookupApple({ title: 'Dune', author: 'Frank Herbert' });
    assert.equal(a.failed, true, 'a 403 is Apple\'s rate limit: a failure, never "Apple has none"');
    const before = calls;
    const b = await lookupApple({ title: 'Emma', author: 'Jane Austen' });
    assert.equal(calls, before, 'nothing sent while the gate is closed');
    assert.equal(b.failed, true, 'a refused lookup is a temporary failure');
    assert.ok(appleGate.blockedForMs() > 0);
  } finally { globalThis.fetch = real; setAppleGateForTests(null); }
});

test('Apple: three lost requests in a row close the gate; a good answer keeps it open', async () => {
  setAppleGateForTests(true, { minGapMs: 0 });
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async () => { n++; if (n <= 3) throw new TypeError('Failed to fetch'); return answer(200, dune); }) as any;
  try {
    for (const t of ['A one', 'B two', 'C three']) await lookupApple({ title: t, author: 'X Y' });
    assert.ok(appleGate.blockedForMs() > 0, 'closed after 3 network failures');
    setAppleGateForTests(true, { minGapMs: 0 });
    const ok = await lookupApple({ title: 'Dune', author: 'Frank Herbert' });
    assert.equal(ok.hit?.book.title, 'Dune');
    assert.equal(appleGate.blockedForMs(), 0);
  } finally { globalThis.fetch = real; setAppleGateForTests(null); }
});

test('Apple: without a browser (scripts, tests) nothing is paced', async () => {
  setAppleGateForTests(null);
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async () => { n++; return answer(200, dune); }) as any;
  try {
    await lookupApple({ title: 'Dune', author: 'Frank Herbert' });
    await lookupApple({ title: 'Dune', author: 'Frank Herbert' });
    assert.equal(n, 2);
  } finally { globalThis.fetch = real; }
});
