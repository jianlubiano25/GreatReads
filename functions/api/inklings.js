// Cloudflare Pages Function: GET /api/inklings
// The Inklings Book Club's monthly picks (Jack Edwards), read from the club's PODCAST feed (https://feeds.megaphone.fm/inklings),
// server-side (the browser cannot read another site's feed). No key needed.
//
// The club has no list of its own. Its podcast does: each month one episode is about the book club pick, titled "Author: Book"
// (the first ones were tagged "*BOOK CLUB*" / "[Book Club]"; later ones say so in the description: "this month our book club picks as
// X", "our March book of the month"). An episode counts as a PICK only when its title is "Author: Book" AND it is tagged, or its
// description says it is the book club pick / book of the month. Everything else (author interviews, the Women's Prize series) is left out.
//
// Answers { source, books: [{ title, author, when: "Jul 2026" }] }, newest first. Only successful answers are cached (1 hour); a feed
// that cannot be read, or has no picks, answers 502 and the app keeps the list it already has. Nothing here guesses a title.

const FEED = 'https://feeds.megaphone.fm/inklings';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LIMIT = 60;

const json = (body, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } });

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d', hellip: '\u2026', ndash: '\u2013', mdash: '\u2014' };
const decode = s =>
  String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
const clean = s => decode(String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const tag = (xml, name) => xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] ?? '';

// the title's own tag: "*BOOK CLUB*", "[Book Club]", "(Book Club)"
const TITLE_TAG = /\s*[*[(]\s*book\s*club\s*[*\])]\s*$/i;
// the description saying so
const DESC_PICK = /\bbook club picks?\s+(?:is|as|was)\b|\bbook of the month\b|\bmonth(?:'s|\u2019s)?\s+(?:book club\s+)?(?:pick|read)\b|\bthis month\s+we\s+(?:read|are reading)\b/i;

/** The picks in an RSS feed, newest first: [{ title, author, when }]. Pure (tested without the network). */
export function parseInklings(xml) {
  const out = [];
  const seen = new Set();
  for (const m of String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const item = m[1];
    const rawTitle = clean(tag(item, 'title'));
    const tagged = TITLE_TAG.test(rawTitle);
    const desc = clean(tag(item, 'description') || tag(item, 'itunes:summary') || tag(item, 'content:encoded'));
    if (!tagged && !DESC_PICK.test(desc)) continue;
    const split = rawTitle.replace(TITLE_TAG, '').trim().match(/^([^:]{2,60}):\s+(\S.{1,120})$/); // "Author: Book"
    if (!split) continue;
    const author = split[1].trim();
    const title = split[2].trim();
    const d = new Date(clean(tag(item, 'pubDate')));
    if (Number.isNaN(d.getTime())) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, author, when: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, at: d.getTime() });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, LIMIT).map(({ title, author, when }) => ({ title, author, when }));
}

export async function onRequestGet() {
  try {
    const res = await fetch(FEED, { headers: { accept: 'application/rss+xml, application/xml, text/xml' }, cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 3600, '400-599': -1 } } });
    if (!res.ok) return json({ error: 'upstream_error', upstream: res.status }, 502);
    const books = parseInklings(await res.text());
    if (!books.length) return json({ error: 'no_picks_found' }, 502);
    return json({ source: FEED, books }, 200, 'public, max-age=1800');
  } catch {
    return json({ error: 'upstream_error' }, 502);
  }
}
