// Cloudflare Pages Function: GET /api/google-books
//   Search: ?q=intitle:"Dune"&maxResults=2[&startIndex=0][&langRestrict=en][&printType=books][&fields=...]
//   Volume: ?volumeId=B1hSG45JCX4C[&fields=...]
// Keeps the Google Books API key on the server. Set it in Cloudflare Pages -> Settings -> Variables and Secrets as
// GOOGLE_BOOKS_API_KEY (type: Secret, NOT a VITE_ build variable) for BOTH Production and Preview, then redeploy:
// variables only apply to NEW deployments.
//
// Only SUCCESSFUL answers are cached. Errors (a missing secret, a 429 rate limit, a 403 from a restricted key, a 5xx) must never be
// cached, or one bad moment would hide every rating for hours. Errors come back as small JSON so the app can tell them apart:
// { "error": "bad_request" | "not_configured" | "rate_limited" | "upstream_error" }. The key and Google's error bodies never appear in
// a response; at most a short Google reason code (e.g. "keyInvalid", "ipRefererBlocked") is passed along so a setup mistake can be found.
const json = (body, status, cache = 'no-store', extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache, ...extra } });

const GOOGLE = 'https://www.googleapis.com/books/v1';
const MAX_RESULTS = 40; // Google's own cap for one page
const MAX_START = 1000;
const MAX_Q = 300;
const EDGE_TTL = 6 * 60 * 60; // Cloudflare's edge keeps a good answer for 6 hours (ratings change slowly; Google's quota is small)
const BROWSER_TTL = 60 * 60;

const noControl = s => !/[\u0000-\u001f\u007f]/.test(s);
const intParam = (raw, min, max, fallback) => {
  if (raw === null || raw === '') return fallback;
  if (!/^\d{1,6}$/.test(raw)) return NaN;
  return Math.min(max, Math.max(min, Number(raw)));
};

/** The query string for Google from the allowed inputs only (nothing else is forwarded, and never a client "key"), or an error string. */
function buildUpstream(params) {
  const volumeId = params.get('volumeId');
  const q = params.get('q');
  const fields = params.get('fields');
  if (fields !== null && !/^[A-Za-z0-9_,()*\/;]{1,1000}$/.test(fields)) return { error: 'bad fields' };
  if ((volumeId === null) === (q === null)) return { error: 'send exactly one of q or volumeId' };

  const out = new URLSearchParams();
  if (volumeId !== null) {
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(volumeId)) return { error: 'bad volumeId' };
    if (fields) out.set('fields', fields);
    return { path: `/volumes/${volumeId}`, query: out };
  }
  const text = q.trim();
  if (!text || text.length > MAX_Q || !noControl(text)) return { error: 'bad q' };
  const maxResults = intParam(params.get('maxResults'), 1, MAX_RESULTS, 10);
  const startIndex = intParam(params.get('startIndex'), 0, MAX_START, 0);
  if (Number.isNaN(maxResults) || Number.isNaN(startIndex)) return { error: 'bad number' };
  const lang = params.get('langRestrict');
  const printType = params.get('printType');
  if (lang !== null && !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang)) return { error: 'bad langRestrict' };
  if (printType !== null && !/^(books|magazines|all)$/.test(printType)) return { error: 'bad printType' };

  out.set('q', text);
  out.set('maxResults', String(maxResults));
  if (startIndex > 0) out.set('startIndex', String(startIndex));
  if (lang) out.set('langRestrict', lang);
  if (printType) out.set('printType', printType);
  if (fields) out.set('fields', fields);
  return { path: '/volumes', query: out };
}

/** Google's short reason code for an error (e.g. "keyInvalid"), only when it looks like one; never the message or the body. */
async function reasonOf(res) {
  try {
    const reason = (await res.json())?.error?.errors?.[0]?.reason;
    return typeof reason === 'string' && /^[A-Za-z]{3,40}$/.test(reason) ? reason : undefined;
  } catch {
    return undefined;
  }
}

export async function onRequestGet({ request, env }) {
  const built = buildUpstream(new URL(request.url).searchParams);
  if (built.error) return json({ error: 'bad_request', detail: built.error }, 400);
  if (!env.GOOGLE_BOOKS_API_KEY) return json({ error: 'not_configured' }, 503);

  built.query.set('key', env.GOOGLE_BOOKS_API_KEY);
  let res;
  try {
    res = await fetch(`${GOOGLE}${built.path}?${built.query.toString()}`, {
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
      // Cache only 2xx at Cloudflare's edge. (cf.cacheTtl alone would cache EVERY status, including errors.)
      cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': EDGE_TTL, '400-599': -1 } },
    });
  } catch {
    return json({ error: 'upstream_error' }, 502);
  }
  if (res.ok) {
    return new Response(await res.text(), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${BROWSER_TTL}` } });
  }
  const reason = await reasonOf(res);
  // Google signals a spent quota with 429, or with 403 + a rate / quota reason: both mean "wait", not "the key is wrong"
  const limited = res.status === 429 || (res.status === 403 && /^(rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded|quotaExceeded)$/.test(reason || ''));
  if (limited) return json({ error: 'rate_limited', upstream: res.status }, 429);
  return json({ error: 'upstream_error', upstream: res.status, ...(reason ? { reason } : {}) }, 502);
}

// Everything except GET: not allowed
export const onRequest = () => json({ error: 'method_not_allowed' }, 405, 'no-store', { allow: 'GET' });
