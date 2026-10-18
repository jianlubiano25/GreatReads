// Cloudflare Pages Function: GET /api/nobel
// The Nobel Prize in Literature laureates, from the Nobel Foundation's own API (https://api.nobelprize.org/2.1/laureates), server-side.
// Official and updated the day the prize is announced (Wikipedia's list lags by weeks). No key needed.
// Answers { source, laureates: [{ year: 2026, name: "Anne Carson" }] }, newest first. Only successful answers are cached; anything
// unreadable answers 502 and the app falls back to Wikipedia's table, then to the list it already has.

const API = 'https://api.nobelprize.org/2.1/laureates?nobelPrizeCategory=lit&limit=300';

const json = (body, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } });

const text = v => (v && typeof v === 'object' ? v.en ?? Object.values(v)[0] : v);

/** The laureates in the API's answer, newest first: [{ year, name }]. Pure (tested without the network). */
export function parseNobel(data) {
  const out = [];
  for (const l of Array.isArray(data?.laureates) ? data.laureates : []) {
    const name = String(text(l?.knownName) ?? text(l?.fullName) ?? text(l?.orgName) ?? '').trim();
    for (const p of Array.isArray(l?.nobelPrizes) ? l.nobelPrizes : []) {
      const category = String(text(p?.category) ?? p?.categoryFullName?.en ?? '');
      const year = Number(p?.awardYear);
      if (name && Number.isInteger(year) && /literature/i.test(category)) out.push({ year, name });
    }
  }
  return out.sort((a, b) => b.year - a.year);
}

export async function onRequestGet() {
  try {
    const res = await fetch(API, { headers: { accept: 'application/json' }, cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 3600, '400-599': -1 } } });
    if (!res.ok) return json({ error: 'upstream_error', upstream: res.status }, 502);
    const laureates = parseNobel(await res.json());
    if (laureates.length < 20) return json({ error: 'too_few_laureates' }, 502);
    return json({ source: API, laureates }, 200, 'public, max-age=1800');
  } catch {
    return json({ error: 'upstream_error' }, 502);
  }
}
