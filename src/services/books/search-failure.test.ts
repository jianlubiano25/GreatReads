import test from 'node:test';
import assert from 'node:assert/strict';
import { searchBooksLive } from './search';

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('Search distinguishes a provider failure from a successful no-results answer', async () => {
  const original = globalThis.fetch;
  let olFailed: string[] = [];
  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return url.hostname === 'openlibrary.org'
        ? jsonResponse(503, { error: 'unavailable' })
        : jsonResponse(200, { totalItems: 0, items: [] });
    }) as typeof fetch;
    await searchBooksLive('a book that is not here', { local: false, final: true, onUpdate: (_books, p) => { if (p.done) olFailed = p.failedSources || []; } });
    assert.deepEqual(olFailed, ['Open Library']);

    let noResultsFailures: string[] | undefined;
    globalThis.fetch = (async () => jsonResponse(200, { docs: [], numFound: 0, totalItems: 0, items: [] })) as unknown as typeof fetch;
    await searchBooksLive('a different nonexistent book', { local: false, final: true, onUpdate: (_books, p) => { if (p.done) noResultsFailures = p.failedSources; } });
    assert.deepEqual(noResultsFailures, []);
  } finally {
    globalThis.fetch = original;
  }
});
