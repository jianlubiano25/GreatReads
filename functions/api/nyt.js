// Cloudflare Pages Function: GET /api/nyt?list=combined-print-and-e-book-fiction
// Keeps the New York Times API key on the server. Set it in Cloudflare Pages -> Settings -> Variables and Secrets as NYT_API_KEY
// (for the Production environment, then redeploy: variables only apply to NEW deployments).
//
// Only SUCCESSFUL answers are cached. Errors (a missing key, a 401 from a key that isn't enabled for the Books API yet, a 429
// rate limit) must never be cached, or one bad moment would hide the list for an hour. Errors come back as small JSON so the
// app can tell them apart: { "error": "not_configured" | "unauthorized" | "rate_limited" | "upstream_error" }.
const json = (body, status, cache = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } });

export async function onRequestGet({ request, env }) {
  const list = new URL(request.url).searchParams.get('list') || '';
  if (!/^[a-z0-9-]{3,60}$/.test(list)) return json({ error: 'bad_list' }, 400);
  if (!env.NYT_API_KEY) return json({ error: 'not_configured' }, 503);

  let res;
  try {
    res = await fetch(
      `https://api.nytimes.com/svc/books/v3/lists/current/${list}.json?api-key=${encodeURIComponent(env.NYT_API_KEY)}`,
      // Cache only 2xx at Cloudflare's edge. (cf.cacheTtl alone would cache EVERY status, including errors.)
      { cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 3600, '400-599': -1 } } },
    );
  } catch {
    return json({ error: 'upstream_error' }, 502);
  }
  if (res.ok) {
    return new Response(res.body, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=1800' } });
  }
  const error = res.status === 401 || res.status === 403 ? 'unauthorized' : res.status === 429 ? 'rate_limited' : 'upstream_error';
  return json({ error, upstream: res.status }, res.status === 429 ? 429 : 502);
}
