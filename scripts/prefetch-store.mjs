import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEEDS = path.join(root, 'src/data/storeSeeds.json');
const OUT = path.join(root, 'src/data/storeResolved.json');

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function getJson(url, timeoutMs = 5000) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const r = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'MyReadingLife/1.0' } });
    clearTimeout(t);
    if (r.ok) return await r.json();
  } catch {}
  return null;
}

/** An outside site's rating is valid only as an average from 1 to 5 together with its own count above zero (src/services/books/ratings.ts: externalRating). */
const validPair = (average, count) => Number.isFinite(Number(average)) && Number(average) >= 1 && Number(average) <= 5 && Number(count) > 0;

/** 1. Apple Books (iTunes API) — high-res 600x900 cover, rating, year */
async function fromAppleBooks(title, author) {
  try {
    const q = encodeURIComponent(`${title} ${author}`.trim());
    const data = await getJson(`https://itunes.apple.com/search?media=ebook&entity=ebook&limit=4&term=${q}`);
    const results = data?.results || [];
    if (!results.length) return null;
    const match = results.find(item => norm(item.trackName || '').includes(norm(title).slice(0, 10))) || results[0];
    const art = match.artworkUrl100?.replace(/100x100bb\.(jpg|png)/, '600x900bb.$1');
    return {
      coverUrl: art,
      ratingAverage: match.averageUserRating ? Math.round(match.averageUserRating * 10) / 10 : undefined,
      ratingCount: match.userRatingCount,
      year: match.releaseDate ? String(match.releaseDate).slice(0, 4) : undefined,
      genre: match.genres?.[0] !== 'Books' ? match.genres?.[0] : match.genres?.[1],
    };
  } catch {
    return null;
  }
}

/** 2. Open Library — covers and page counts */
async function fromOpenLibrary(title, author) {
  try {
    const q = new URLSearchParams({ title, author, limit: '4', fields: 'key,title,cover_i,first_publish_year,ratings_average,ratings_count,number_of_pages_median' });
    const data = await getJson(`https://openlibrary.org/search.json?${q}`);
    const docs = data?.docs || [];
    if (!docs.length) return null;
    const best = docs.find(d => d.cover_i) || docs[0];
    return {
      coverId: best.cover_i,
      ratingAverage: best.ratings_average ? Math.round(best.ratings_average * 10) / 10 : undefined,
      ratingCount: best.ratings_count,
      pages: best.number_of_pages_median,
      year: best.first_publish_year ? String(best.first_publish_year) : undefined,
      olKey: best.key,
    };
  } catch {
    return null;
  }
}

/** 3. Google Books fallback */
async function fromGoogleBooks(title, author) {
  try {
    const q = encodeURIComponent(`intitle:${title} inauthor:${author}`);
    const key = process.env.VITE_GOOGLE_BOOKS_API_KEY || process.env.GOOGLE_BOOKS_API_KEY || '';
    const url = `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=3&printType=books${key ? `&key=${encodeURIComponent(key)}` : ''}`;
    const data = await getJson(url);
    // editions of one book differ in whether Google rates them: prefer the first edition that has a valid rating pair
    const items = (data?.items || []).map(i => i.volumeInfo).filter(Boolean);
    const item = items.find(v => validPair(v.averageRating, v.ratingsCount)) || items[0];
    if (!item) return null;
    const thumb = (item.imageLinks?.thumbnail || item.imageLinks?.smallThumbnail || '').replace(/^http:/, 'https:').replace('&edge=curl', '');
    return {
      coverUrl: thumb,
      ratingAverage: item.averageRating,
      ratingCount: item.ratingsCount,
      pages: item.pageCount,
      year: item.publishedDate ? item.publishedDate.slice(0, 4) : undefined,
    };
  } catch {
    return null;
  }
}

async function resolveBook(title, author) {
  const [apple, ol, gb] = await Promise.all([
    fromAppleBooks(title, author),
    fromOpenLibrary(title, author),
    fromGoogleBooks(title, author),
  ]);

  const rec = { title }; // so the app can tell if the shelf was edited after this was fetched
  if (apple?.coverUrl) rec.coverUrl = apple.coverUrl;
  else if (ol?.coverId) rec.coverId = ol.coverId;
  else if (gb?.coverUrl) rec.coverUrl = gb.coverUrl;

  // A rating is ONE source's average + count, taken together (never an average from one site with another's count, never a sum).
  // Ladder, as in src/services/books/ratings.ts: Apple Books, then Open Library, then Google Books. Only valid pairs count, and a source
  // with fewer than 10 ratings only wins when no other source has a rating. The source is saved so the app knows where the stars came from.
  const ladder = [['apple', apple], ['openlibrary', ol], ['google', gb]].filter(([, r]) => r && validPair(r.ratingAverage, r.ratingCount));
  const pick = ladder.find(([, r]) => r.ratingCount >= 10) || ladder[0];
  if (pick) {
    rec.ratingAverage = pick[1].ratingAverage;
    rec.ratingCount = pick[1].ratingCount;
    rec.ratingSource = pick[0];
  }

  const pages = ol?.pages || gb?.pages; // unknown stays unknown (never invent a page count)
  if (pages) rec.pageCount = pages;

  const year = apple?.year || ol?.year || gb?.year;
  if (year) rec.year = year;

  if (ol?.olKey) rec.olKey = ol.olKey;

  return rec;
}

const shelves = JSON.parse(await fs.readFile(SEEDS, 'utf8'));
let out = {};
try { out = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch {}

// Optional time limit: `node scripts/prefetch-store.mjs --max-minutes=10` stops politely (re-run to finish the rest)
// `--redo-ratings` fetches every book again, so ratings saved by an older version of this script are rewritten under the policy above
const redoRatings = process.argv.includes('--redo-ratings');
const maxMinutes = Number((process.argv.find(a => a.startsWith('--max-minutes=')) || '').split('=')[1]) || 0;
const deadline = maxMinutes ? Date.now() + maxMinutes * 60_000 : Infinity;

console.log(`Resolving ${shelves.length} shelves with parallel pool...`);

for (const shelf of shelves) {
  if (Date.now() > deadline) { console.log('Stopped at the time limit; run again to finish the rest.'); break; }
  out[shelf.id] = out[shelf.id] || [];
  
  // Resolve books in shelf in chunks of 4 concurrent
  const tasks = shelf.seeds.map(([title, author], i) => async () => {
    const existing = out[shelf.id][i];
    if (!redoRatings && existing && existing.title === title && (existing.coverUrl || existing.coverId) && existing.ratingAverage && existing.ratingSource) { // an entry saved without its source predates the ladder: fetched again
      return;
    }
    const resolved = await resolveBook(title, author);
    out[shelf.id][i] = resolved;
  });

  // Run 4 at a time
  for (let i = 0; i < tasks.length; i += 4) {
    await Promise.all(tasks.slice(i, i + 4).map(fn => fn()));
  }

  // Save after each shelf completes
  await fs.writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
  const count = (out[shelf.id] || []).filter(b => b && (b.coverUrl || b.coverId)).length;
  console.log(`✓ [${shelf.title}]: ${count}/${shelf.seeds.length} covers resolved`);
}

console.log('\nAll shelves successfully resolved into src/data/storeResolved.json');
