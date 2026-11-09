// Tests the Cloudflare Pages Function that proxies Hardcover (functions/api/hardcover.js) with a scripted upstream.
import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS module with no type declarations
import { onRequestGet as hc, shapeBook, shapeDoc } from '../../../functions/api/hardcover.js';

const call = (path: string, env: Record<string, string> = {}) => hc({ request: new Request(`https://greatreads.pages.dev${path}`), env });
function upstream(status: number, body: unknown) {
  const seen: { url: string; init: any }[] = [];
  (globalThis as any).fetch = async (url: string, init: any) => { seen.push({ url: String(url), init }); return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); };
  return seen;
}

test('Hardcover function: no token -> 503 not_configured, nothing is sent', async () => {
  const seen = upstream(200, {});
  const res = await call('/api/hardcover?op=books&q=dune');
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'not_configured' });
  assert.equal(seen.length, 0);
});

test('Hardcover function: bad requests are refused before the upstream is called', async () => {
  const seen = upstream(200, {});
  assert.equal((await call('/api/hardcover?op=other&q=dune', { HARDCOVER_TOKEN: 't' })).status, 400);
  assert.equal((await call('/api/hardcover?op=books&q=a', { HARDCOVER_TOKEN: 't' })).status, 400);
  assert.equal(seen.length, 0);
});

const hit = (document: any) => ({ document });
const search = (...docs: any[]) => ({ data: { search: { results: { hits: docs.map(hit) } } } });

test('Hardcover function: sends one fixed search query (no _ilike: Hardcover blocks it with a 403) with the words as variables, the token only in the header, and never returns the token', async () => {
  const seen = upstream(200, search(
    { id: 1, slug: 'dune', title: 'Dune', rating: 4.27123, ratings_count: 5000, users_count: 9000, release_year: 1965, image: { url: 'https://assets.hardcover.app/x.jpg' }, author_names: ['Frank Herbert'], genres: ['Science fiction'] },
    { id: 2, title: 'Dune Cookbook', rating: 3, ratings_count: 5, author_names: ['Someone Else'] }));
  const res = await call('/api/hardcover?op=books&q=Dune&author=Frank%20Herbert', { HARDCOVER_TOKEN: 'Bearer SECRETTOKEN' });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes('SECRETTOKEN'));
  const body = JSON.parse(text);
  assert.equal(body.books.length, 1, 'filtered to the asked author');
  assert.deepEqual([body.books[0].rating, body.books[0].ratingsCount, body.books[0].year, body.books[0].cover, body.books[0].readers], [4.27, 5000, 1965, 'https://assets.hardcover.app/x.jpg', 9000]);
  assert.deepEqual(body.books[0].genres, ['Science fiction']);
  assert.equal(seen[0].init.headers.authorization, 'Bearer SECRETTOKEN');
  const sent = JSON.parse(seen[0].init.body);
  assert.ok(!/_ilike|_like|_regex|_similar/.test(sent.query), 'no blocked operator');
  assert.deepEqual(sent.variables, { q: 'Dune frank herbert', type: 'Book', per: 10 });
});

test('Hardcover function: a rejected token, a rate limit and a GraphQL error each come back as a small error', async () => {
  upstream(401, {});
  assert.equal((await (await call('/api/hardcover?op=books&q=zzzz1', { HARDCOVER_TOKEN: 't' })).json()).error, 'unauthorized');
  upstream(429, {});
  assert.equal((await call('/api/hardcover?op=books&q=zzzz2', { HARDCOVER_TOKEN: 't' })).status, 429);
  upstream(200, { errors: [{ message: 'Invalid or expired token' }] });
  assert.equal((await (await call('/api/hardcover?op=books&q=zzzz3', { HARDCOVER_TOKEN: 't' })).json()).error, 'unauthorized');
  upstream(200, { errors: [{ message: "field 'search' not found in type: 'query_root'" }] });
  const bad = await (await call('/api/hardcover?op=books&q=zzzz4', { HARDCOVER_TOKEN: 't' })).json();
  assert.equal(bad.error, 'upstream_error', 'a wrong field name is not blamed on the token');
  assert.match(bad.detail, /search/);
  upstream(403, { error: 'User does not have access to the requested resource or query' });
  const forbidden = await (await call('/api/hardcover?op=books&q=zzzz5', { HARDCOVER_TOKEN: 't' })).json();
  assert.equal(forbidden.error, 'forbidden', 'a 403 is not blamed on the token either');
  assert.match(forbidden.detail, /access to the requested/);
});

test('shapeBook leaves out a rating without a count and non-https covers', () => {
  const b: any = shapeBook({ id: 3, title: 'X', rating: 4.5, ratings_count: 0, cached_image: { url: 'http://x/y.jpg' } });
  assert.equal(b.rating, undefined);
  assert.equal(b.cover, undefined);
});

test('shapeBook keeps Hardcover\'s genres (most voted first, no moods), pages and release date; a bad date is dropped', () => {
  const b: any = shapeBook({ id: 4, title: 'Dune', pages: 412, release_date: '1965-08-01', subtitle: 'Book One', cached_tags: { Genre: [{ tag: 'Classics', count: 5 }, { tag: 'Science fiction', count: 90 }], Mood: [{ tag: 'Adventurous', count: 300 }] } });
  assert.deepEqual(b.genres, ['Science fiction', 'Classics']);
  assert.equal(b.pages, 412);
  assert.equal(b.releaseDate, '1965-08-01');
  assert.equal(b.subtitle, 'Book One');
  assert.equal((shapeBook({ id: 5, title: 'X', release_date: 'soon', pages: 0 }) as any).releaseDate, undefined);
});

test('shapeDoc: a search hit becomes the app shape; results may also arrive as a JSON string', async () => {
  const d: any = shapeDoc({ id: '7', slug: 'x', title: 'X', author_names: ['A B'], rating: 4, ratings_count: 3, image: 'https://a/b.jpg', genres: ['Fantasy', 'Adventure'], pages: 300, release_date: '2001-05-01', description: 'd' });
  assert.deepEqual([d.authors, d.cover, d.genres, d.pages, d.releaseDate], [['A B'], 'https://a/b.jpg', ['Fantasy', 'Adventure'], 300, '2001-05-01']);
  upstream(200, { data: { search: { results: JSON.stringify({ hits: [{ document: { id: 9, title: 'Emma', author_names: ['Jane Austen'], rating: 4, ratings_count: 20 } }] }) } } });
  const body: any = await (await call('/api/hardcover?op=books&q=emma-string-test', { HARDCOVER_TOKEN: 't' })).json();
  assert.equal(body.books[0].title, 'Emma');
});
