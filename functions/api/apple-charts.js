// Cloudflare Pages Function: GET /api/apple-charts?feed=top-free  (or top-paid)
// Apple's public Books charts, fetched server-side so the browser never has to deal with cross-origin rules. No key needed.
// Successful answers are cached for 30 minutes; errors are never cached.
export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const feed = url.searchParams.get('feed') === 'top-paid' ? 'top-paid' : 'top-free';
  const limit = Math.min(100, Math.max(10, Number(url.searchParams.get('limit')) || 50));
  try {
    const res = await fetch(`https://rss.applemarketingtools.com/api/v2/us/books/${feed}/${limit}/books.json`, {
      cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 1800, '400-599': -1 } },
    });
    if (!res.ok) return new Response(JSON.stringify({ error: 'upstream_error', upstream: res.status }), { status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    return new Response(res.body, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=900' } });
  } catch {
    return new Response(JSON.stringify({ error: 'upstream_error' }), { status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
}
