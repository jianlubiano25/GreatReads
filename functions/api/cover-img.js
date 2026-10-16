// Cloudflare Pages Function: GET /api/cover-img?u=<https picture address>
// Hands a book cover back with CORS headers, ONLY so the app can read its pixels (to tell a flat front cover from a 3D render of a book with its spine showing).
// The app tries the picture's own host first and asks here only when that host sends no CORS headers. Not an open proxy: https only, a short list of
// cover hosts (checked again after redirects), images only, at most 2 MB, and the answer is cached for a week.
const HOSTS = /(^|\.)(mzstatic\.com|openlibrary\.org|archive\.org|books\.google\.com|googleusercontent\.com|gstatic\.com|storage\.googleapis\.com)$/i;
const MAX_BYTES = 2_000_000;

const fail = (status, error) => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function onRequestGet({ request }) {
  const raw = new URL(request.url).searchParams.get('u') || '';
  let target;
  try { target = new URL(raw); } catch { return fail(400, 'bad_url'); }
  if (target.protocol !== 'https:' || !HOSTS.test(target.hostname)) return fail(400, 'host_not_allowed');
  let res;
  try { res = await fetch(target.toString(), { redirect: 'follow', cf: { cacheTtl: 604800, cacheEverything: true } }); } catch { return fail(502, 'upstream_unreachable'); }
  let finalHost = '';
  try { finalHost = new URL(res.url || target.toString()).hostname; } catch {}
  if (!HOSTS.test(finalHost)) return fail(400, 'redirect_not_allowed');
  if (!res.ok) return fail(res.status === 404 ? 404 : 502, 'upstream_error');
  const type = res.headers.get('content-type') || '';
  if (!/^image\//i.test(type)) return fail(415, 'not_an_image');
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) return fail(413, 'too_large');
  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return fail(413, 'too_large');
  return new Response(body, { status: 200, headers: { 'content-type': type, 'cache-control': 'public, max-age=604800', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' } });
}
