// Cloudflare Pages Function: GET /api/goodreads-choice
// The newest Goodreads Choice Awards winners (one book per category), read server-side from goodreads.com.
//
// https://www.goodreads.com/award links "See all the YYYY Award Winners" to /choiceawards/best-books-YYYY. The newest year linked there
// is the newest year there is, so the shelf moves to the new year's winners by itself once Goodreads publishes them (early December).
// A year's page only counts when it lists a real set of winners (8 or more); otherwise the year before is used.
//
// Answers { source, year, books: [{ title, author, category: "Fiction" }] }. Goodreads may refuse a server's request or change its
// markup: then this answers 502 and the app keeps the winners it already has. Nothing here guesses a title.

const ORIGIN = 'https://www.goodreads.com';
const MIN_WINNERS = 8;

const json = (body, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } });

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '\u2019', lsquo: '\u2018' };
const decode = s =>
  String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
const clean = s => decode(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** The newest year the awards page links to ("/choiceawards/best-books-2025" -> 2025), or 0. */
export function newestYear(awardHtml) {
  const years = [...String(awardHtml).matchAll(/choiceawards\/best-books-(\d{4})/g)].map(m => Number(m[1]));
  return years.length ? Math.max(...years) : 0;
}

/** The winners on a year's page: each category's winner cover has the alt text "Title by Author". Pure (tested without the network). */
export function parseChoiceWinners(html) {
  const heads = [...String(html).matchAll(/<[a-z0-9]+\b[^>]*category__copy[^>]*>([\s\S]*?)<\/[a-z0-9]+>/gi)].map(m => ({ at: m.index, name: clean(m[1]) }));
  const out = [];
  const seen = new Set();
  for (const m of String(html).matchAll(/<img\b[^>]*category__winnerImage[^>]*>/gi)) {
    const alt = m[0].match(/\balt\s*=\s*"([^"]*)"/i)?.[1];
    if (!alt) continue;
    const text = clean(alt);
    const cut = text.lastIndexOf(' by ');
    if (cut < 1) continue;
    const title = text.slice(0, cut).trim();
    const author = text.slice(cut + 4).trim();
    const head = [...heads].reverse().find(h => h.at < m.index);
    const category = (head?.name || '').replace(/^best\s+/i, '').trim();
    const key = `${title}|${category}`.toLowerCase();
    if (!title || !author || !category || seen.has(key)) continue;
    seen.add(key);
    out.push({ title, author, category });
  }
  return out;
}

const get = url => fetch(url, { headers: { accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' }, cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 3600, '400-599': -1 } } });

/** The newest year the awards page links to; when that page can't be read, this year and the two before it are tried directly. */
async function candidateYears() {
  try {
    const award = await get(`${ORIGIN}/award`);
    if (award.ok) {
      const newest = newestYear(await award.text());
      if (newest) return { years: [newest, newest - 1], status: 200 };
    }
    var status = award.status;
  } catch {}
  const now = new Date().getUTCFullYear();
  return { years: [now, now - 1, now - 2], status };
}

export async function onRequestGet() {
  let seen = 0;
  try {
    const { years, status } = await candidateYears();
    for (const year of years) {
      const page = await get(`${ORIGIN}/choiceawards/best-books-${year}`);
      if (!page.ok) { seen = seen || page.status; continue; }
      const books = parseChoiceWinners(await page.text());
      if (books.length >= MIN_WINNERS) return json({ source: `${ORIGIN}/choiceawards/best-books-${year}`, year, books }, 200, 'public, max-age=1800');
    }
    return json({ error: seen || status ? 'upstream_error' : 'no_winners_found', upstream: seen || status || undefined }, 502);
  } catch {
    return json({ error: 'upstream_error' }, 502);
  }
}
