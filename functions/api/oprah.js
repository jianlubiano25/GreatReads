// Cloudflare Pages Function: GET /api/oprah
// Oprah's Book Club picks from Oprah Daily's own list page (the browser cannot read another site's pages):
//   https://www.oprahdaily.com/entertainment/books/g23067476/oprah-book-club-list/
// The page is a numbered gallery, newest pick first, each entry written as   112. “Title,” Author
// Answers { source, picks: [{ n, title, author }] } newest first (at most 30). The page carries no dates, so the app labels these picks
// "Oprah's Book Club" and adds the ones the shelf does not have yet (see DYNAMIC_SPECS.oprah). This is the shelf's only source.
//
// NOT verified against the live page: the page blocks automated readers in the tool used to write this, so the parser follows the
// entry format quoted by outlets that republish the list. Anything that does not look like that is dropped, fewer than 8 entries
// is an error (502, never cached), and the shelf then simply keeps its saved list. Run `npm run check:oprah` on a normal
// connection to see what the real page gives.
const PAGE = 'https://www.oprahdaily.com/entertainment/books/g23067476/oprah-book-club-list/';
const LIMIT = 30;
const MIN_PICKS = 8;

const json = (body, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } });

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d', hellip: '\u2026', ndash: '\u2013', mdash: '\u2014' };
const decode = s =>
  String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);

// "112. “Title,” Author": the number, the title in quotes (the comma may sit inside the quotes), then the author
const ENTRY = /^(\d{1,3})\s*[.)]\s*[\u201c"]\s*(.+?)\s*,?\s*[\u201d"]\s*,?\s*(?:by\s+)?(.+?)\s*$/;

/** The numbered entries in the page's HTML: [{ n, title, author }] newest (highest number) first. Tags only separate text pieces. */
export function parseOprahList(html) {
  const nodes = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, '\u0000')
    .replace(/<[^>]+>/g, '\u0000')
    .split('\u0000')
    .map(n => decode(n).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  // The number may sit in a tag of its own ("112" or "112." then the entry): join it to the entry that follows
  for (let i = 0; i + 1 < nodes.length; i++) {
    if (/^\d{1,3}$/.test(nodes[i]) && /^[\u201c"]/.test(nodes[i + 1])) { nodes.splice(i, 2, `${nodes[i]}. ${nodes[i + 1]}`); }
  }
  const byNumber = new Map();
  for (let i = 0; i < nodes.length; i++) {
    // An entry may be split over several tags (the number, the title, the author): join up to three pieces until it reads as one
    if (!/^\d{1,3}\s*[.)]/.test(nodes[i])) continue;
    let text = nodes[i];
    let m = text.match(ENTRY);
    for (let k = 1; !m && k <= 2 && nodes[i + k] !== undefined; k++) {
      text = `${text} ${nodes[i + k]}`;
      m = text.match(ENTRY);
      if (m) i += k;
    }
    if (!m) continue;
    const n = Number(m[1]);
    const title = m[2].replace(/\s+/g, ' ').trim();
    const author = m[3].replace(/\s+/g, ' ').replace(/[.,;]+$/, '').trim();
    if (!n || n > 400 || title.length < 1 || title.length > 140 || author.length < 3 || author.length > 90 || /[<>]|https?:/i.test(`${title}${author}`)) continue;
    if (!byNumber.has(n)) byNumber.set(n, { n, title, author });
  }
  return [...byNumber.values()].sort((a, b) => b.n - a.n);
}

export async function onRequestGet() {
  let html;
  try {
    const res = await fetch(PAGE, {
      // A browser-like request: this publisher turns away requests that announce themselves as a script
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
      },
      // Cache only 2xx at Cloudflare's edge (12 h). Errors are never cached.
      cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 12 * 3600, '400-599': -1 } },
    });
    if (!res.ok) return json({ error: 'upstream_error', upstream: res.status }, 502);
    html = await res.text();
  } catch {
    return json({ error: 'upstream_error' }, 502);
  }
  const picks = parseOprahList(html).slice(0, LIMIT);
  if (picks.length < MIN_PICKS) return json({ error: 'layout_changed', found: picks.length }, 502);
  return json({ source: 'oprahdaily.com', picks }, 200, 'public, max-age=3600');
}
