// Cloudflare Pages Function: GET /api/hardcover?op=books&q=<title words>[&author=<name>]
// Keeps the Hardcover API token on the server (Cloudflare Pages -> Settings -> Variables and Secrets -> HARDCOVER_TOKEN, Production, then redeploy).
// Hardcover says its API is for a code backend only (never a browser), 60 requests a minute, 30 s per query, tokens expire each January 1.
// Only ONE fixed read-only query shape is sent (the caller's words go in as GraphQL variables, never into the query text), results are cached at the edge for a day,
// and the token never appears in any response. Errors are small JSON: { error: 'not_configured' | 'bad_request' | 'unauthorized' | 'rate_limited' | 'upstream_error' }.
const json = (body, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } });

const ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const QUERY = `query Books($title: String!, $limit: Int!) {
  books(where: { title: { _ilike: $title } }, order_by: { users_read_count: desc }, limit: $limit) {
    id slug title rating ratings_count users_read_count release_year cached_image description cached_contributors
  }
}`;

const clean = s => String(s || '').replace(/[\u0000-\u001f%_\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const norm = s => clean(s).toLowerCase().replace(/[^a-z0-9 ]/g, '');

/** One book in the shape the app uses; a field Hardcover does not send is simply left out. */
export function shapeBook(b) {
  const image = b?.cached_image && (b.cached_image.url || (typeof b.cached_image === 'string' ? b.cached_image : ''));
  const authors = Array.isArray(b?.cached_contributors) ? b.cached_contributors.map(c => c?.author?.name || c?.name).filter(Boolean) : [];
  const out = { id: b?.id, slug: b?.slug, title: b?.title, authors };
  if (Number(b?.rating) > 0 && Number(b?.ratings_count) > 0) { out.rating = Math.round(Number(b.rating) * 100) / 100; out.ratingsCount = Number(b.ratings_count); }
  if (b?.users_read_count) out.readers = Number(b.users_read_count);
  if (b?.release_year) out.year = Number(b.release_year);
  if (typeof image === 'string' && /^https:\/\//.test(image)) out.cover = image;
  if (b?.description) out.description = String(b.description).slice(0, 1500);
  return out;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = clean(url.searchParams.get('q'));
  const author = norm(url.searchParams.get('author'));
  if (url.searchParams.get('op') !== 'books' || q.length < 2) return json({ error: 'bad_request' }, 400);
  const token = String(env.HARDCOVER_TOKEN || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'not_configured' }, 503);

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(`https://greatreads-hardcover.invalid/books?q=${encodeURIComponent(q.toLowerCase())}&a=${encodeURIComponent(author)}`);
  try { const hit = cache && (await cache.match(key)); if (hit) return hit; } catch {}

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'user-agent': 'GreatReads/1.0 (book discovery app)' },
      body: JSON.stringify({ query: QUERY, variables: { title: q, limit: 10 } }),
    });
  } catch {
    return json({ error: 'upstream_error' }, 502);
  }
  if (res.status === 401 || res.status === 403) return json({ error: 'unauthorized' }, 502);
  if (res.status === 429) return json({ error: 'rate_limited' }, 429);
  if (!res.ok) return json({ error: 'upstream_error', upstream: res.status }, 502);
  let data;
  try { data = await res.json(); } catch { return json({ error: 'upstream_error' }, 502); }
  // GraphQL reports a bad token or a schema problem inside a 200 answer
  if (data?.errors?.length) {
    const msg = JSON.stringify(data.errors).toLowerCase();
    return json({ error: /jwt|token|auth|expired|invalid/.test(msg) ? 'unauthorized' : 'upstream_error' }, 502);
  }
  let books = (data?.data?.books || []).map(shapeBook);
  if (author) books = books.filter(b => b.authors.some(a => { const n = norm(a); return n.includes(author) || author.includes(n); }));
  const resp = json({ books }, 200, 'public, max-age=3600');
  if (cache && books.length) { try { await cache.put(key, new Response(JSON.stringify({ books }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=86400' } })); } catch {} }
  return resp;
}
