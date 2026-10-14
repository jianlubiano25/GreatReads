// Cloudflare Pages Function: the shared cover store.
//   GET  /api/covers  -> { v, picks: { "<title>|<author>": { url, source, title?, author?, t } } }   (everyone; ETag + short cache)
//   PUT  /api/covers  -> the owner publishes the whole set: body { picks }, header  Authorization: Bearer <COVER_ADMIN_TOKEN>
// Setup (Cloudflare Pages -> Settings): Functions -> KV namespace bindings: variable name COVERS; Variables and Secrets: COVER_ADMIN_TOKEN
// (type Secret, at least 16 characters). Without them GET answers an empty set (the app works as before) and PUT says 503.
// Nothing here is per user: one set, one version number. The app reads it once in a while and keeps the last copy on the device.
const KEY = 'picks';
const MAX_PICKS = 600;
const MAX_BODY = 400_000;
const SOURCES = ['apple', 'google', 'openlibrary', 'link'];
const MIN_TOKEN = 16;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** Keep only well-formed entries (https picture, known source, sane lengths). Returns the clean map and how many entries were dropped. */
export function cleanPicks(raw) {
  const picks = {};
  let dropped = 0;
  const entries = raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.entries(raw) : [];
  for (const [key, v] of entries) {
    const ok = key && key.length <= 200 && !/[\u0000-\u001f]/.test(key) && v && typeof v === 'object' && typeof v.url === 'string' && v.url.length <= 1000 && /^https:\/\/[^\s]+$/i.test(v.url);
    if (!ok || Object.keys(picks).length >= MAX_PICKS) { dropped++; continue; }
    const rec = { url: v.url, source: SOURCES.includes(v.source) ? v.source : 'link', t: Number.isFinite(v.t) ? Number(v.t) : 0 };
    const title = text(v.title, 200);
    const author = text(v.author, 200);
    if (title) rec.title = title;
    if (author) rec.author = author;
    picks[key] = rec;
  }
  return { picks, dropped };
}

const bytes = s => new TextEncoder().encode(s);
/** Compare two secrets without leaking where they differ (both are hashed first, so the length does not leak either). */
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', bytes(a)), crypto.subtle.digest('SHA-256', bytes(b))]);
  const p = new Uint8Array(x), q = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < p.length; i++) diff |= p[i] ^ q[i];
  return diff === 0;
}

async function stored(env) {
  try {
    const s = await env.COVERS.get(KEY, 'json');
    return s && typeof s === 'object' && s.picks && typeof s.picks === 'object' ? { v: Number(s.v) || 0, picks: s.picks } : { v: 0, picks: {} };
  } catch {
    return null;
  }
}

export async function onRequestGet({ request, env }) {
  if (!env.COVERS) return json({ v: 0, picks: {} }, 200, { 'cache-control': 'public, max-age=300' }); // not set up yet: an empty set, not an error
  const s = await stored(env);
  if (!s) return json({ error: 'store_unavailable' }, 503);
  const etag = `"${s.v}"`;
  const headers = { etag, 'cache-control': 'public, max-age=60' };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return json(s, 200, headers);
}

export async function onRequestPut({ request, env }) {
  if (!env.COVERS || !env.COVER_ADMIN_TOKEN || String(env.COVER_ADMIN_TOKEN).length < MIN_TOKEN) return json({ error: 'not_configured' }, 503);
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!given || !(await sameSecret(given, String(env.COVER_ADMIN_TOKEN)))) return json({ error: 'unauthorized' }, 401);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: 'too_large' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'invalid' }, 400); }
  if (!body || typeof body !== 'object' || !body.picks || typeof body.picks !== 'object') return json({ error: 'invalid' }, 400);
  const { picks, dropped } = cleanPicks(body.picks);
  const prev = await stored(env);
  if (!prev) return json({ error: 'store_unavailable' }, 503);
  const v = Math.max(Date.now(), prev.v + 1); // a version only ever goes up
  try { await env.COVERS.put(KEY, JSON.stringify({ v, picks })); } catch { return json({ error: 'store_unavailable' }, 503); }
  return json({ v, picks, dropped });
}
