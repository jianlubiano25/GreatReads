// Cloudflare Pages Function: GET /api/nyt?list=combined-print-and-e-book-fiction
// Keeps the New York Times API key on the server. Set it in Cloudflare Pages -> Settings -> Variables and Secrets as NYT_API_KEY.
export async function onRequestGet({ request, env }) {
  const list = new URL(request.url).searchParams.get('list') || '';
  if (!/^[a-z0-9-]{3,60}$/.test(list)) return new Response('Bad list name', { status: 400 });
  if (!env.NYT_API_KEY) return new Response('NYT_API_KEY is not set', { status: 503 });
  const res = await fetch(
    `https://api.nytimes.com/svc/books/v3/lists/current/${list}.json?api-key=${encodeURIComponent(env.NYT_API_KEY)}`,
    { cf: { cacheTtl: 3600, cacheEverything: true } },
  );
  return new Response(res.body, {
    status: res.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=1800' },
  });
}
