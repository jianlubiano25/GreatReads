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
