// Cloudflare Pages Function: GET /api/service95
// Dua Lipa's Service95 Book Club, read from the club's OWN page (https://www.service95.com/book-club) and its book pages, server-side
// (the browser cannot read another site's pages). No key needed.
//
//   book-club page : a carousel of every Monthly Read, newest first. Each item is a link to /books/<slug> followed by a
//                    "2026 October"-style heading. It carries no title or author.
//   book page      : the book's own heading, and a "By <author>" line under it (the page <title> is only a fallback: its wording
//                    changes from month to month).
//
// Answers { source, books: [{ title, author, when: "Oct 2026", url }] }, newest first, at most 12.
// Only SUCCESSFUL answers are cached: the book-club page for 12 hours, a book page for a week (a past month never changes). A page
// that cannot be read, or whose layout changed so that too few books can be found, answers 502 and is never cached: the app then
// keeps the list it already has (see DYNAMIC_SPECS.service95). Nothing here guesses a title or an author.

const BASE = 'https://www.service95.com';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LIMIT = 12;
const MIN_BOOKS = 4;

const json = (body, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': cache } });

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d', hellip: '\u2026', ndash: '\u2013', mdash: '\u2014' };
const decode = s =>
  String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
const text = html => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// <a href=".../books/<slug>">...</a> immediately followed by a "<year> <Month>" heading. The body of the link may not cross a </a>,
// so a link without a heading after it (the featured book at the top) is skipped instead of borrowing the next link's heading.
const ITEM = new RegExp(
  String.raw`<a\b[^>]*?href=["'](?:https?:\/\/(?:www\.)?service95\.com)?\/books\/([a-z0-9][a-z0-9-]*)\/?["'][^>]*>(?:(?!<\/a>)[\s\S])*<\/a>\s*(?:<[^>]{0,300}>\s*){0,3}(20\d\d)\s+(${MONTHS.join('|')})\b`,
  'gi',
);

/** The Monthly Reads on the book-club page: [{ slug, year, month (1-12) }], newest first, each book once. */
export function parseBookClub(html) {
  const seen = new Set();
  const out = [];
  for (const m of String(html).matchAll(ITEM)) {
    const slug = m[1].toLowerCase();
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, year: Number(m[2]), month: MONTHS.findIndex(n => n.toLowerCase() === m[3].toLowerCase()) + 1 });
  }
  return out.sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month));
}

const sane = (s, max) => !!s && s.length <= max && !/[<>]|https?:/i.test(s);

// A person's name, not a sentence: a few words, no years, no verbs. (The Night People page has NO "By <author>" line, but its quote from
// Dua says "Widow Basquiat by Jennifer Clement gave us a who's who of New York's early 1980s creative scene": a loose "by ..." match read
// that sentence as the author.)
const NOT_NAME_WORDS = /\b(is|was|were|are|has|have|had|gave|gives|made|makes|will|would|about|which|that|this|who|whose|his|her|their|its|from|into|with|us|we)\b/i;
export function looksLikeAuthor(a) {
  const s = String(a ?? '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 70 || /\d{3,}|[<>!?:;@]|https?:/i.test(s) || /\b\p{L}{3,}\.\s+\S/u.test(s)) return false;
  const words = s.split(' ');
  return words.length <= 7 && !NOT_NAME_WORDS.test(s) && /^\p{Lu}/u.test(s);
}

/** One book page -> { title, author } or null. */
export function parseBookPage(html) {
  html = String(html);
  // A quoted attribute value can contain the OTHER kind of quote ("Dua's Monthly Read"), so the value runs to the matching quote.
  const meta = name => {
    const a = html.match(new RegExp(`<meta[^>]*?(?:property|name)=(["'])${name}\\1[^>]*?content=(["'])([\\s\\S]*?)\\2`, 'i'));
    if (a) return a[3];
    const b = html.match(new RegExp(`<meta[^>]*?content=(["'])([\\s\\S]*?)\\1[^>]*?(?:property|name)=(["'])${name}\\3`, 'i'));
    return b ? b[2] : undefined;
  };
  const clean = v => (v ? decode(v).replace(/\s+/g, ' ').trim() : '');

  // 1. The page's own title says it outright: "Dua's Monthly Read[ for October]: <Title> by <Author>" (og:title, then <title>, then the
  //    description: "Explore Dua's Monthly Read, <Title> by <Author>, for Service95 Book Club ..."). The separator and wording vary
  //    from month to month, so the rest of the pattern is strict.
  const titles = [clean(meta('og:title')), clean((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1])];
  for (const t of titles) {
    const m = t.match(/Monthly Read(?:\s+for\s+[A-Za-z]+(?:\s+\d{4})?)?\s*[:\-\u2013,]\s*(.+)\s+by\s+(.+)$/i);
    if (m && sane(m[1].trim(), 140) && looksLikeAuthor(m[2].trim())) return { title: m[1].trim(), author: m[2].trim() };
  }
  const d = clean(meta('og:description') || meta('description')).match(/Monthly Read,\s*(.+?)\s+by\s+(.+?),\s+for\s+Service95/i);
  if (d && sane(d[1].trim(), 140) && looksLikeAuthor(d[2].trim())) return { title: d[1].trim(), author: d[2].trim() };

  // 2. The page's heading, then a "By <author>" line that is a line of its own under it (its WHOLE text, and a name)
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const title = text(h1[1]);
    const after = html.slice((h1.index ?? 0) + h1[0].length, (h1.index ?? 0) + h1[0].length + 1500);
    const by = after.match(/<(p|div|span|h\d)\b[^>]*>\s*By\s+([^<]{2,80}?)\s*<\/\1>/i);
    const author = by ? decode(by[2]).replace(/\s+/g, ' ').trim() : '';
    if (sane(title, 140) && looksLikeAuthor(author)) return { title, author };
  }
  return null;
}

const get = async (url, ttl) => {
  const res = await fetch(url, {
    headers: { 'user-agent': 'GreatReads/1.0 (a reading app; reads the public Service95 Book Club list; github.com/jianlubiano25/GreatReads)', accept: 'text/html' },
    // Cache only 2xx at Cloudflare's edge. (cf.cacheTtl alone would cache EVERY status, including errors.)
    cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': ttl, '400-599': -1 } },
  });
  if (!res.ok) throw new Error(`service95 answered ${res.status}`);
  return res.text();
};

export async function onRequestGet() {
  let entries;
  try {
    entries = parseBookClub(await get(`${BASE}/book-club`, 12 * 3600)).slice(0, LIMIT);
  } catch {
    return json({ error: 'upstream_error' }, 502);
  }
  if (entries.length < MIN_BOOKS) return json({ error: 'layout_changed', found: entries.length }, 502);

  const pages = await Promise.all(
    entries.map(async e => {
      try {
        const book = parseBookPage(await get(`${BASE}/books/${e.slug}`, 7 * 24 * 3600));
        return book && { ...book, when: `${MONTHS[e.month - 1].slice(0, 3)} ${e.year}`, url: `${BASE}/books/${e.slug}` };
      } catch {
        return null; // one book page failing only drops that book
      }
    }),
  );
  const books = pages.filter(Boolean);
  if (books.length < Math.min(MIN_BOOKS, entries.length)) return json({ error: 'layout_changed', found: books.length }, 502);
  return json({ source: 'service95.com/book-club', books }, 200, 'public, max-age=3600');
}
