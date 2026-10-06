import type { Book } from '../types';
import { docToBook, fetchJson, genreFromSubjects, getCachedShelf, shrunkRating, writeShelfCache, type SearchDoc } from './bookSearch';
import { authorListMatches, canonFromGoogle, mergeCanon, titlesMatch, type BookCanon } from './bookIdentity';

/**
 * Trending Today / Top 15 this week.
 *
 * Open Library's trending list is still the main source and decides who is a candidate. Each candidate is then checked against
 * Apple Books and Google Books (no keys needed) to fill in what Open Library lacks: a cover, a real description, genres, page
 * count, and extra reader ratings. Obviously explicit books are dropped or pushed down, normal romance is untouched, and the final
 * 15 favour books with good metadata and established reader signals while keeping a mix of genres.
 *
 * The shelf appears right away from Open Library alone; the improved version replaces it a few seconds later and is cached.
 * (Amazon has no public catalogue API, so it is not used.)
 */

const OL = 'https://openlibrary.org';
const POOL_SIZE = 24; // candidates that get the extra lookups
const WORKERS = 3; // lookups at once: keeps API use gentle

/* ------------------------------------------------------------------ */
/* Explicit-content screening                                          */
/* ------------------------------------------------------------------ */

const STRONG = /\b(erotic|erotica|erotics|bdsm|smut|smutty|porn|porno|pornographic|nsfw|hentai|xxx|sexually explicit)\b/i;
const MEDIUM = /\b(steamy|spicy romance|dark romance|reverse harem|why choose|sex scenes?|sexual content|mature content|kink|kinky|taboo romance|naughty)\b/i;

export const EXPLICIT_FILTER_AT = 40; // at or above: left out of the shelf
export const EXPLICIT_PENALTY_AT = 18; // at or above: allowed, but ranked well down

/**
 * 0 = nothing suspicious. Scores come from the title, subjects, description and the stores' own maturity flags.
 * Plain romance (genre, subjects, "love story") scores 0 on purpose. Covers are not analysed (no image model on the device), so
 * strongly sexualised covers are caught only through these metadata signals.
 */
export function explicitScore(x: { title?: string; subjects?: string[]; description?: string; googleMaturity?: string; appleAdvisory?: string }): number {
  let s = 0;
  const head = `${x.title || ''} ${(x.subjects || []).join(' ')}`;
  const desc = x.description || '';
  if (STRONG.test(head)) s += 45;
  else if (STRONG.test(desc)) s += 30;
  const medium = new Set([...(head.match(new RegExp(MEDIUM, 'gi')) || []), ...(desc.match(new RegExp(MEDIUM, 'gi')) || [])].map(m => m.toLowerCase()));
  s += Math.min(36, medium.size * 12);
  if (/^mature$/i.test(x.googleMaturity || '')) s += 30;
  if (/explicit|adult|18\+/i.test(x.appleAdvisory || '')) s += 20;
  return s;
}

/* ------------------------------------------------------------------ */
/* Scoring and picking                                                 */
/* ------------------------------------------------------------------ */

const hasRealSummary = (t?: string) => !!t && t.length >= 60 && !/^(A distinguished work by|A book by) /.test(t) && !/^.+ by .+\.$/.test(t);
const KNOWN_GENRE = (g?: string) => !!g && !/^(book|general)$/i.test(g);

/** Open Library's own trending order, plus reader signals, plus how complete the book's details are, minus explicit-content penalty. */
export function trendScore(b: Book, rank: number, total: number, explicit = 0): number {
  const prior = total > 1 ? ((total - rank) / total) * 40 : 20;
  const count = b.ratingCount || 0;
  const popularity = Math.min(24, Math.log10(count + 1) * 6);
  const quality = b.ratingAverage ? Math.max(-4, Math.min(8, (shrunkRating(b.ratingAverage, count) - 3.5) * 8)) : 0;
  let meta = 0;
  if (b.coverId || b.coverUrl) meta += 4;
  if (b.pageCount) meta += 2;
  if (b.year) meta += 1;
  if (hasRealSummary(b.summary)) meta += 3;
  if (KNOWN_GENRE(b.genre)) meta += 1.5;
  if (b.author && !/^(Unknown|Featured) Author$/.test(b.author)) meta += 1;
  return prior + popularity + quality + meta - (explicit >= EXPLICIT_PENALTY_AT ? 30 : 0);
}

/** Best-scoring books first, but each extra book of an already-picked genre costs points, so one genre cannot take over the shelf. */
export function pickDiverse<T extends { book: Book; score: number }>(items: T[], limit: number, genrePenalty = 9): T[] {
  const left = [...items].sort((a, b) => b.score - a.score);
  const picked: T[] = [];
  const used: Record<string, number> = {};
  while (picked.length < limit && left.length) {
    let bestI = 0;
    let bestV = -Infinity;
    left.forEach((it, i) => {
      const g = KNOWN_GENRE(it.book.genre) ? it.book.genre : '';
      const v = it.score - (g ? genrePenalty * (used[g] || 0) : 0);
      if (v > bestV) { bestV = v; bestI = i; }
    });
    const [it] = left.splice(bestI, 1);
    picked.push(it);
    const g = KNOWN_GENRE(it.book.genre) ? it.book.genre : '';
    if (g) used[g] = (used[g] || 0) + 1;
  }
  return picked.sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------ */
/* Extra sources                                                       */
/* ------------------------------------------------------------------ */

interface Extra {
  ratings: { avg: number; count: number }[];
  genres: string[];
  description: string;
  cover: string;
  googleMaturity: string;
  appleAdvisory: string;
  pages?: number;
  year?: string;
  canon?: BookCanon;
}
const emptyExtra = (): Extra => ({ ratings: [], genres: [], description: '', cover: '', googleMaturity: '', appleAdvisory: '' });
const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

async function fromApple(b: Book, x: Extra) {
  const q = encodeURIComponent(`${b.title} ${/^(Unknown|Featured) Author$/.test(b.author) ? '' : b.author}`.trim());
  const data = await fetchJson(`https://itunes.apple.com/search?media=ebook&entity=ebook&limit=5&term=${q}`, 4500, 0);
  const m = (data?.results || []).find((it: any) => titlesMatch(String(it.trackName || ''), b.title) && authorListMatches(it.artistName, b.author));
  if (!m) return;
  if (m.averageUserRating && m.userRatingCount) x.ratings.push({ avg: Number(m.averageUserRating), count: Number(m.userRatingCount) });
  if (Array.isArray(m.genres)) x.genres.push(...m.genres.map(String));
  if (m.description && !x.description) x.description = plain(String(m.description)).slice(0, 600);
  if (m.artworkUrl100 && !x.cover) x.cover = String(m.artworkUrl100).replace(/100x100bb\.(jpg|png)/, '600x900bb.$1');
  x.appleAdvisory = String(m.contentAdvisoryRating || m.trackExplicitness || '');
  if (!x.year && m.releaseDate) x.year = String(m.releaseDate).slice(0, 4);
}

async function fromGoogle(b: Book, x: Extra) {
  const generic = /^(Unknown|Featured) Author$/.test(b.author);
  const q = encodeURIComponent(`intitle:${b.title}${generic ? '' : ` inauthor:${b.author}`}`);
  const fields = 'items(id,volumeInfo(title,authors,description,categories,pageCount,publishedDate,averageRating,ratingsCount,maturityRating,imageLinks,industryIdentifiers))';
  const data = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=5&printType=books&fields=${encodeURIComponent(fields)}`);
  const item = (data?.items || []).find((i: any) => titlesMatch(String(i.volumeInfo?.title || ''), b.title) && authorListMatches(i.volumeInfo?.authors, b.author));
  const v = item?.volumeInfo;
  if (!v) return;
  if (v.averageRating && v.ratingsCount) x.ratings.push({ avg: Number(v.averageRating), count: Number(v.ratingsCount) });
  if (Array.isArray(v.categories)) x.genres.push(...v.categories.map(String));
  if (v.description && !x.description) x.description = plain(String(v.description)).slice(0, 600);
  const thumb = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail;
  if (thumb && !x.cover) x.cover = String(thumb).replace(/^http:/, 'https:').replace('&edge=curl', '');
  x.googleMaturity = String(v.maturityRating || '');
  if (v.pageCount) x.pages = Number(v.pageCount);
  if (!x.year && v.publishedDate) x.year = String(v.publishedDate).slice(0, 4);
  x.canon = canonFromGoogle(item, b.title, b.author);
}

async function lookUp(b: Book, olKey: string): Promise<Extra> {
  const x = emptyExtra();
  try {
    if (!b.ratingAverage && olKey) {
      const j = await fetchJson(`${OL}${olKey}/ratings.json`, 8000, 0);
      const sm = j?.summary;
      if (sm?.average) x.ratings.push({ avg: Number(sm.average), count: Number(sm.count) || 1 });
    }
  } catch {}
  try { await fromApple(b, x); } catch {}
  // Google fills in whatever Apple did not (or is the only one that knows the book)
  if (!x.description || !x.cover || !x.ratings.length || !b.pageCount) {
    try { await fromGoogle(b, x); } catch {}
  }
  return x;
}

/** Apply what the other sources told us to the Open Library book. Only fills gaps and adds reader signals; never changes the id. */
function applyExtra(b: Book, x: Extra, subjects: string[]): Book {
  const out: Book = { ...b };
  const pool = [...(b.ratingAverage ? [{ avg: b.ratingAverage, count: b.ratingCount || 1 }] : []), ...x.ratings].filter(r => r.avg > 0);
  if (pool.length) {
    const total = pool.reduce((n, r) => n + Math.max(1, r.count), 0);
    out.ratingAverage = Number((pool.reduce((n, r) => n + r.avg * Math.max(1, r.count), 0) / total).toFixed(1));
    out.ratingCount = pool.reduce((n, r) => n + (r.count > 1 || b.ratingAverage ? r.count : 0), 0) || b.ratingCount;
  }
  if (!out.coverId && !out.coverUrl && x.cover) out.coverUrl = x.cover;
  if (!hasRealSummary(out.summary) && x.description.length > 60) out.summary = x.description;
  if (!out.pageCount && x.pages) { out.pageCount = x.pages; out.difficulty = x.pages > 450 ? 3 : x.pages > 250 ? 2 : 1; }
  if (!out.year && x.year) out.year = x.year;
  if (!KNOWN_GENRE(out.genre)) {
    const g = genreFromSubjects([...subjects, ...x.genres]);
    if (g) out.genre = g;
  }
  out.canon = mergeCanon(out.canon, x.canon);
  return out;
}

/* ------------------------------------------------------------------ */
/* The shelf                                                           */
/* ------------------------------------------------------------------ */

interface Entry { book: Book; rank: number; subjects: string[]; olKey: string }
const refining = new Set<string>();

function choose(entries: Entry[], total: number, limit: number, extras?: Map<Entry, Extra>): Book[] {
  const scored = entries
    .map(e => {
      const x = extras?.get(e);
      const explicit = explicitScore({
        title: e.book.title, subjects: e.subjects, description: x?.description,
        googleMaturity: x?.googleMaturity, appleAdvisory: x?.appleAdvisory,
      });
      return { e, explicit };
    })
    .filter(s => s.explicit < EXPLICIT_FILTER_AT && (s.e.book.coverId || s.e.book.coverUrl))
    .map(s => ({ book: s.e.book, score: trendScore(s.e.book, s.e.rank, total, s.explicit) }));
  return pickDiverse(scored, limit).map(s => s.book);
}

/**
 * Load a trending shelf. Returns a good shelf immediately (Open Library only), then quietly improves it with Apple/Google
 * data and calls `onUpdate` with the final 15 (also cached for a few hours like every other store shelf).
 */
export async function loadTrendingShelf(
  id: string,
  url: string,
  opts: { limit?: number; onUpdate?: (books: Book[]) => void } = {},
): Promise<Book[]> {
  const cached = getCachedShelf(id);
  if (cached) return cached;
  const { limit = 15, onUpdate } = opts;

  const data = await fetchJson(url, 10000, 1);
  const docs: SearchDoc[] = data?.works || data?.docs || [];
  const entries: Entry[] = docs
    .filter(d => d?.title)
    .map((d, i) => ({ book: docToBook(d, i), rank: i, subjects: d.subject || [], olKey: d.key || '' }))
    .filter(e => explicitScore({ title: e.book.title, subjects: e.subjects }) < EXPLICIT_FILTER_AT);
  if (!entries.length) throw new Error(`shelf ${id}: empty`);

  const total = docs.length;
  let provisional = choose(entries, total, limit);
  if (!provisional.length) provisional = entries.slice(0, limit).map(e => e.book); // nothing has a cover yet: show what we have
  if (!provisional.length) throw new Error(`shelf ${id}: empty`);

  if (onUpdate && !refining.has(id)) {
    refining.add(id);
    void (async () => {
      try {
        // The candidates worth a closer look: best first impressions from Open Library's own data
        const pool = entries
          .map(e => ({ e, s: trendScore(e.book, e.rank, total) }))
          .sort((a, b) => b.s - a.s)
          .slice(0, POOL_SIZE)
          .map(x => x.e);
        const extras = new Map<Entry, Extra>();
        let next = 0;
        const worker = async () => {
          while (next < pool.length) {
            const e = pool[next++];
            extras.set(e, await lookUp(e.book, e.olKey));
          }
        };
        await Promise.all(Array.from({ length: WORKERS }, worker));

        const improved = pool.map(e => ({ ...e, book: applyExtra(e.book, extras.get(e)!, e.subjects) }));
        const remap = new Map<Entry, Extra>();
        improved.forEach((e, i) => remap.set(e, extras.get(pool[i])!));
        let final = choose(improved, total, limit, remap);
        if (final.length < Math.min(limit, 8)) {
          // too many dropped (offline, or odd data): top up from the first-impression list
          const have = new Set(final.map(b => String(b.id)));
          final = [...final, ...provisional.filter(b => !have.has(String(b.id)))].slice(0, limit);
        }
        if (final.length) {
          writeShelfCache(id, final);
          onUpdate(final);
        }
      } catch {
        /* the first-impression shelf stays */
      } finally {
        refining.delete(id);
      }
    })();
  }
  return provisional;
}
