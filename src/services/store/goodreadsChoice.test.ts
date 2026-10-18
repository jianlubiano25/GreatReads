import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS module with no type declarations
import { onRequestGet } from '../../../functions/api/goodreads-choice.js';

const page = (n: number) => Array.from({ length: n }, (_, i) => `<h4 class="category__copy">Best Category ${i}</h4><img class="category__winnerImage" alt="Title ${i} by Author ${i}">`).join('');
const html = (body: string) => ({ ok: true, status: 200, text: async () => body });

test('Goodreads Choice function: when /award cannot be read, the newest years are tried directly, with a browser user agent', async () => {
  const seen: { url: string; ua?: string }[] = [];
  const year = new Date().getUTCFullYear();
  (globalThis as any).fetch = async (url: string, init: any) => {
    seen.push({ url, ua: init?.headers?.['user-agent'] });
    if (url.endsWith('/award')) return { ok: false, status: 403, text: async () => '' };
    if (url.endsWith(`best-books-${year}`)) return { ok: false, status: 404, text: async () => '' }; // this year's winners are not out yet
    if (url.endsWith(`best-books-${year - 1}`)) return html(page(12));
    return { ok: false, status: 404, text: async () => '' };
  };
  const res = await (onRequestGet as any)();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.year, year - 1);
  assert.equal(body.books.length, 12);
  assert.ok(seen.every(s => /Mozilla/.test(s.ua || '')));
});

test('Goodreads Choice function: when Goodreads refuses everything it says why (status) and answers 502', async () => {
  (globalThis as any).fetch = async () => ({ ok: false, status: 403, text: async () => '' });
  const res = await (onRequestGet as any)();
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error, 'upstream_error');
  assert.equal(body.upstream, 403);
});
