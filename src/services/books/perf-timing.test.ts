import test from 'node:test';
import assert from 'node:assert/strict';
import { recordRequest, perfSnapshot, resetPerf, SLOW_MS } from './perf';

test('WP2a: request time is added up per host, and slow or empty requests are kept in the device log', () => {
  resetPerf();
  recordRequest('https://openlibrary.org/search.json?q=classics', 200, undefined, 1, 120);
  recordRequest('https://openlibrary.org/search.json?q=classics', 200, undefined, 1, SLOW_MS + 500); // slow but fine
  recordRequest('https://www.googleapis.com/books/v1/volumes?q=classics', 200, 'empty', 1, 800); // an empty answer (H1)
  recordRequest('https://openlibrary.org/x', 0, 'aborted', 1, 9000); // superseded: not timed, not logged
  const snap = perfSnapshot();
  assert.equal(snap.counters['net.ms.openlibrary.org'], 3620);
  assert.equal(snap.counters['net.slow.openlibrary.org'], 1);
  assert.deepEqual(snap.failures.map(f => f.failure), ['slow', 'empty']);
  assert.equal(snap.failures[0].ms, 3500);
});

test('diagnostics text is valid JSON with per-host totals and no query strings', async () => {
  const { diagnosticsText } = await import('./perf');
  resetPerf();
  recordRequest('https://openlibrary.org/search.json?q=secret+title', 200, undefined, 1, 100);
  const text = diagnosticsText();
  const parsed = JSON.parse(text);
  assert.match(parsed.hosts[0], /^openlibrary\.org: 100 ms total over 1 requests$/);
  assert.equal(text.includes('secret'), false);
});

test('Copy diagnostics: every copy is a new reading (own time, live counters), not a kept one', async () => {
  const { diagnosticsText } = await import('./perf');
  resetPerf();
  const a = JSON.parse(diagnosticsText());
  recordRequest('https://openlibrary.org/search.json?q=x', 200, undefined, 1, 50);
  const b = JSON.parse(diagnosticsText());
  assert.equal(a.hosts.length, 0);
  assert.equal(b.hosts.length, 1, 'the second copy sees what happened after the first');
  assert.match(b.generated.local, /^\d{1,2}:\d{2}\s?(AM|PM)$/i, '12-hour clock');
  assert.ok(typeof b.generated.appOpenMin === 'number');
});
