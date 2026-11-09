// Cloudflare Pages Function: GET /api/hardcover?op=books&q=<title words>[&author=<name>]
// Keeps the Hardcover API token on the server (Cloudflare Pages -> Settings -> Variables and Secrets -> HARDCOVER_TOKEN, Production, then redeploy).
// Hardcover says its API is for a code backend only (never a browser), 60 requests a minute, 30 s per query, tokens expire each January 1.
// Only ONE fixed read-only query shape is sent (the caller's words go in as GraphQL variables, never into the query text), results are cached at the edge for a day,
// and the token never appears in any response. Errors are small JSON: { error: 'not_configured' | 'bad_request' | 'unauthorized' | 'rate_limited' | 'upstream_error' }.
const json = (body, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } });

const ENDPOINT = 'https://api.hardcover.app/v1/graphql';
// Hardcover blocks the text-match operators (_like, _ilike, _regex, _similar) on its GraphQL API with a 403, so a title is looked up through its documented `search` query
// (query_type Book): ONE fixed query, the caller's words go in as variables. The answer's `results` is JSON: { hits: [{ document: {...} }] }.
const QUERY = `query Search($q: String!, $type: String!, $per: Int!) {
  search(query: $q, query_type: $type, per_page: $per, page: 1) {
    results
  }
}`;

const clean = s => String(s || '').replace(/[\u0000-\u001f%_\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const norm = s => clean(s).toLowerCase().replace(/[^a-z0-9 ]/g, '');

/** Hardcover's reader-voted genre tags (cached_tags.Genre = [{ tag, count }]), most voted first, at most 8. Moods and content warnings are not genres. */
export function genresOf(tags) {
  const list = tags && typeof tags === 'object' && Array.isArray(tags.Genre) ? tags.Genre : [];
  return list.filter(t => t && typeof t.tag === 'string' && t.tag.trim()).sort((x, y) => Number(y.count || 0) - Number(x.count || 0)).slice(0, 8).map(t => t.tag.trim().slice(0, 60));
}

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
  if (b?.subtitle) out.subtitle = String(b.subtitle).slice(0, 200);
  if (Number(b?.pages) > 0 && Number(b.pages) < 20000) out.pages = Number(b.pages);
  if (typeof b?.release_date === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(b.release_date)) out.releaseDate = b.release_date;
  const genres = genresOf(b?.cached_tags);
  if (genres.length) out.genres = genres;
  return out;
}

/** One search hit's `document` in the same shape: a field Hardcover does not send is simply left out. */
export function shapeDoc(d) {
  const image = d?.image && (typeof d.image === 'string' ? d.image : d.image.url);
  const authors = Array.isArray(d?.author_names) ? d.author_names.filter(a => typeof a === 'string' && a.trim()) : Array.isArray(d?.contributions) ? d.contributions.map(c => c?.author?.name).filter(Boolean) : [];
  const out = { id: d?.id !== undefined ? Number(d.id) || String(d.id) : undefined, slug: d?.slug, title: d?.title, authors };
  if (Number(d?.rating) > 0 && Number(d?.ratings_count) > 0) { out.rating = Math.round(Number(d.rating) * 100) / 100; out.ratingsCount = Number(d.ratings_count); }
  const readers = Number(d?.users_read_count ?? d?.users_count);
  if (readers > 0) out.readers = readers;
  if (Number(d?.release_year) > 0) out.year = Number(d.release_year);
  if (typeof image === 'string' && /^https:\/\//.test(image)) out.cover = image;
  if (d?.description) out.description = String(d.description).slice(0, 1500);
  if (d?.subtitle) out.subtitle = String(d.subtitle).slice(0, 200);
  if (Number(d?.pages) > 0 && Number(d.pages) < 20000) out.pages = Number(d.pages);
  if (typeof d?.release_date === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(d.release_date)) out.releaseDate = d.release_date;
  const genres = Array.isArray(d?.genres) ? d.genres.filter(g => typeof g === 'string' && g.trim()).slice(0, 8).map(g => g.trim().slice(0, 60)) : genresOf(d?.cached_tags);
  if (genres.length) out.genres = genres;
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

  let data;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000); // a slow Hardcover query must end as a small JSON answer, never a page that hangs
  let res;
  try {
    res = await fetch(ENDPOINT, {
      signal: ctl.signal,
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'user-agent': 'GreatReads/1.0 (book discovery app)' },
      body: JSON.stringify({ query: QUERY, variables: { q: author ? `${q} ${author}`.slice(0, 160) : q, type: 'Book', per: 10 } }),
    });
  } catch (e) {
    return json({ error: ctl.signal.aborted ? 'timeout' : 'upstream_error', detail: String(e?.message || e).slice(0, 200) }, ctl.signal.aborted ? 504 : 502);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) return json({ error: 'unauthorized', upstream: 401 }, 502);
  // 403 is NOT a bad token: Hardcover says it means "no access to the requested resource or query" (a blocked operator, a query too deep), so it is reported as it is, with Hardcover's words
  if (res.status === 403) { let detail = ''; try { detail = String(await res.text()).slice(0, 300); } catch {} return json({ error: 'forbidden', upstream: 403, detail }, 502); }
  if (res.status === 429) return json({ error: 'rate_limited' }, 429);
  if (!res.ok) { let detail = ''; try { detail = String(await res.text()).slice(0, 300); } catch {} return json({ error: 'upstream_error', upstream: res.status, detail }, 502); }
  try { data = await res.json(); } catch { return json({ error: 'upstream_error' }, 502); }
  // GraphQL reports problems inside a 200 answer. Only a message that is clearly about the token says "unauthorized"; anything else is an upstream_error with Hardcover's own message (`detail`, never the token).
  if (data?.errors?.length) {
    const first = String(data.errors[0]?.message || '').slice(0, 300);
    const tokenProblem = /jwt|invalid token|token (?:is )?(?:invalid|expired)|expired token|unauthori[sz]ed|not authenticated|missing authorization|invalid authorization|unable to verify token/i.test(first);
    return json({ error: tokenProblem ? 'unauthorized' : 'upstream_error', detail: first }, 502);
  }
  let results = data?.data?.search?.results;
  if (typeof results === 'string') { try { results = JSON.parse(results); } catch { results = null; } }
  const hits = Array.isArray(results?.hits) ? results.hits : [];
  let books = hits.map(h => shapeDoc(h?.document || h)).filter(b => b.title);
  if (author) books = books.filter(b => b.authors.some(a => { const n = norm(a); return n.includes(author) || author.includes(n); }));
  const resp = json({ books }, 200, 'public, max-age=3600');
  if (cache && books.length) { try { await cache.put(key, new Response(JSON.stringify({ books }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=86400' } })); } catch {} }
  return resp;
}
