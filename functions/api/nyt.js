// Cloudflare Pages Function: GET /api/nyt?list=combined-print-and-e-book-fiction
// Keeps the New York Times API key on the server. Set it in Cloudflare Pages -> Settings -> Variables and Secrets as NYT_API_KEY
// (for the Production environment, then redeploy: variables only apply to NEW deployments).
//
// Only SUCCESSFUL answers are cached. Errors (a missing key, a 401 from a key that isn't enabled for the Books API yet, a 429
// rate limit) must never be cached, or one bad moment would hide the list for an hour. Errors come back as small JSON so the
// app can tell them apart: { "error": "not_configured" | "unauthorized" | "rate_limited" | "list_not_found" | "upstream_error" }.
// "list_not_found" (HTTP 404, published: false) = the NYT does not publish that list name (any more); "upstream_error" with upstream: 404 and
// published: true = the name is published but the request still failed.
const json = (body, status, cache = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } });

// The last good answer for each list is also kept (Cloudflare's Cache API), for up to 10 days. The NYT publishes weekly but allows
// only a few requests a minute for the whole site, so a 429 or an outage serves that copy instead of an error. Not for 401/403/503:
// those are setup mistakes and must stay visible.
const KEEP_MS = 10 * 24 * 60 * 60 * 1000;
const savedKey = list => new Request(`https://greatreads-nyt-saved.invalid/${list}`);
const savedStore = () => { try { return typeof caches !== 'undefined' ? caches.default : null; } catch { return null; } };

/** The list names the NYT currently publishes (list_name_encoded), or null when they cannot be read. Only a successful answer is cached at the edge. */
async function publishedNames(key) {
  try {
    const res = await fetch(`https://api.nytimes.com/svc/books/v3/lists/names.json?api-key=${encodeURIComponent(key)}`, { cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 21600, '400-599': -1 } } });
    if (!res.ok) return null;
    const names = ((await res.json())?.results || []).map(n => n && n.list_name_encoded).filter(Boolean);
    return names.length ? names : null;
  } catch {
    return null;
  }
}

export async function onRequestGet({ request, env, waitUntil }) {
  const list = new URL(request.url).searchParams.get('list') || '';
  if (!/^[a-z0-9-]{3,60}$/.test(list)) return json({ error: 'bad_list' }, 400);
  if (!env.NYT_API_KEY) return json({ error: 'not_configured' }, 503);

  const kept = savedStore();
  const stale = async () => {
    try {
      const old = kept && (await kept.match(savedKey(list)));
      const at = old ? Number(old.headers.get('x-saved-at')) : 0;
      if (!old || !at || Date.now() - at > KEEP_MS) return null;
      return new Response(await old.text(), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300', 'x-nyt-stale': '1' } });
    } catch {
      return null;
    }
  };

  let res;
  try {
    res = await fetch(
      `https://api.nytimes.com/svc/books/v3/lists/current/${list}.json?api-key=${encodeURIComponent(env.NYT_API_KEY)}`,
      // Cache only 2xx at Cloudflare's edge. (cf.cacheTtl alone would cache EVERY status, including errors.)
      { cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 21600, '400-599': -1 } } },
    );
  } catch {
    return (await stale()) || json({ error: 'upstream_error' }, 502);
  }
  if (res.ok) {
    const text = await res.text();
    if (kept) {
      const put = kept.put(savedKey(list), new Response(text, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=864000', 'x-saved-at': String(Date.now()) } })).catch(() => {});
      if (waitUntil) waitUntil(put); else await put;
    }
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
  }
  if (res.status === 429 || res.status >= 500) {
    const old = await stale();
    if (old) return old;
  }
  // A 404 means the NYT has no list under this name. Ask its own list of names whether the name is published: if it is not, the list was removed or
  // renamed (the shelf should hide, not retry); if it is, the 404 is something else (a routing or upstream fault). The key never appears in a response.
  if (res.status === 404) {
    const names = await publishedNames(env.NYT_API_KEY);
    if (names && !names.includes(list)) {
      const words = list.split('-').filter(w => w.length > 3);
      const suggestions = names.filter(n => words.some(w => n.includes(w))).slice(0, 8);
      return json({ error: 'list_not_found', upstream: 404, published: false, suggestions }, 404);
    }
    return json({ error: 'upstream_error', upstream: 404, published: names ? true : null }, 502);
  }
  const error = res.status === 401 || res.status === 403 ? 'unauthorized' : res.status === 429 ? 'rate_limited' : 'upstream_error';
  return json({ error, upstream: res.status }, res.status === 429 ? 429 : 502);
}
