import type { Book } from '../../types';
import type { SearchGenre } from '../../data/searchGenres';
import { persistentCache } from '../books/cache';
import { searchBooksLive } from '../books/search';
import { shrunkRating } from '../books/model';
import { applyInfo } from '../books/infoStore';
import { externalRating, setRating } from '../books/ratings';
import { openLibraryRatings } from '../books/sources/openLibrary';
import { hardcoverRating } from '../books/sources/hardcover';
import { readShared, writeShared } from './sharedDiscovery';
import { fillMissingCovers } from '../books/covers';
import { kindAdjust } from '../books/genreRank';
import { InsufficientShelfError, type ShelfSource } from './shelves';

/** Both rows share a per-origin genre search pool. Hidden Gems also keeps its last eligible row for offline use and failed refreshes. */
export const ROW_SIZE = 12;
/** A "new release" came out this year or last year, and has a cover. */
export const NEW_YEARS = 1;
/** A "hidden gem" is well liked (average) by enough readers to mean something, but not one of the most-read books of the genre. */
export const GEM_MIN_AVERAGE = 4.1;
export const GEM_MIN_RATINGS = 40;
export const GEM_MAX_RATINGS = 5000;
/** A row with fewer books than this is not worth showing */
export const MIN_ROW = 3;

const hasCover = (b: Book) => {
  if (Number.isInteger(b.coverId) && Number(b.coverId) > 0) return true;
  if (!b.coverUrl) return false;
  try { return new URL(b.coverUrl).protocol === 'https:'; } catch { return false; }
};
const rightKind = (b: Book, kind: SearchGenre['kind']) => kindAdjust(b, kind) === 0;
const isGem = (b: Book, kind: SearchGenre['kind']) => {
  const average = Number(b.ratingAverage);
  const count = Number(b.ratingCount);
  return hasCover(b) && rightKind(b, kind) && Number.isFinite(average) && average >= GEM_MIN_AVERAGE && Number.isFinite(count) && count >= GEM_MIN_RATINGS && count <= GEM_MAX_RATINGS;
};

export function newReleases(pool: readonly Book[], kind: SearchGenre['kind'], year = new Date().getFullYear()): Book[] {
  return pool
    .filter(b => hasCover(b) && Number(b.year) >= year - NEW_YEARS && Number(b.year) <= year && rightKind(b, kind))
    .map((b, i) => ({ b, i }))
    .sort((x, y) => Number(y.b.year) - Number(x.b.year) || (y.b.ratingCount || 0) - (x.b.ratingCount || 0) || x.i - y.i)
    .map(x => x.b)
    .slice(0, ROW_SIZE);
}

/**
 * Hidden Gems fill from the best down, in steps, so a genre is never empty just because few of its books are rated: first the real rule (average 4.1+, 40-5000 ratings),
 * then, only to fill the row, slightly looser steps (3.9+ with 15-20000 ratings, then 3.7+ with 10+). Each step is ordered by the same shrunk rating, and a book appears once.
 */
export const GEM_STEPS = [
  { min: GEM_MIN_AVERAGE, lo: GEM_MIN_RATINGS, hi: GEM_MAX_RATINGS },
  { min: 3.9, lo: 15, hi: 20000 },
  { min: 3.7, lo: 10, hi: 50000 },
] as const;
const inStep = (b: Book, kind: SearchGenre['kind'], st: (typeof GEM_STEPS)[number]) => {
  const average = Number(b.ratingAverage), count = Number(b.ratingCount);
  return hasCover(b) && rightKind(b, kind) && Number.isFinite(average) && average >= st.min && Number.isFinite(count) && count >= st.lo && count <= st.hi;
};
export function hiddenGems(pool: readonly Book[], kind: SearchGenre['kind']): Book[] {
  const out: Book[] = [];
  const used = new Set<Book>();
  for (const st of GEM_STEPS) {
    if (out.length >= ROW_SIZE) break;
    const step = pool
      .filter(b => !used.has(b) && inStep(b, kind, st))
      .map((b, i) => ({ b, i, k: shrunkRating(b.ratingAverage, b.ratingCount) }))
      .sort((x, y) => y.k - x.k || x.i - y.i);
    for (const x of step) { if (out.length >= ROW_SIZE) break; out.push(x.b); used.add(x.b); }
  }
  return out;
}

/**
 * Hidden Gems needs a rating AND a count on each book. Google's ratings are the usual source and Google refuses requests when its quota is empty (the owner's iPad log:
 * 95% answered 429), which left the row empty. So a book with no usable rating first takes any rating saved for it on this device (Book Info, the shared catalog, the
 * bundled lists: `applyInfo`, no network), then asks Open Library for the work's own rating (at most ENRICH_MAX books, background priority, through its gate).
 * Only real pairs are used (average 1-5 with a count); nothing is made up, and Google being down never empties the row on its own.
 */
const ENRICH_MAX = 10;
export async function withFallbackRatings(
  books: Book[],
  ask: (olWork: string) => Promise<{ average: number; count: number } | null> = id => openLibraryRatings(id),
  max = ENRICH_MAX,
  askHardcover: (title: string, author: string) => Promise<{ average: number; count: number } | null> = (t, a) => hardcoverRating(t, a),
): Promise<Book[]> {
  const out = books.map(b => (externalRating(b) ? b : applyInfo(b)));
  // Hardcover first (one call by title + author, through our server), then the work's own Open Library rating
  const need = out.map((b, i) => ({ b, i })).filter(x => !externalRating(x.b) && (x.b.identity?.olWork || x.b.title)).slice(0, max);
  await Promise.all(need.map(async ({ b, i }) => {
    try {
      const hc = await askHardcover(b.title, b.author);
      if (hc && hc.count > 0 && hc.average >= 1) { out[i] = setRating(b, { average: hc.average, count: hc.count, source: 'hardcover' }); return; }
    } catch {}
    try {
      if (!b.identity?.olWork) return;
      const r = await ask(b.identity.olWork);
      if (r && r.count > 0 && r.average >= 1) out[i] = setRating(b, { average: r.average, count: r.count, source: 'openlibrary' });
    } catch {}
  }));
  return out;
}

const DAY = 24 * 60 * 60 * 1000;
const STALE_FOR = 14 * DAY;
const pools = persistentCache<Book[]>('readlife.genrepool1', { ttl: DAY, max: 30, keepStale: STALE_FOR, validate: Array.isArray });
const gemShelves = persistentCache<Book[]>('readlife.genregems1', { ttl: DAY, max: 30, keepStale: STALE_FOR, validate: Array.isArray });
type PoolResult = { books: Book[]; failed: boolean };
const inFlight = new Map<string, Promise<PoolResult>>();

/**
 * A genre's own search holds only ~40 books, so few of them can be gems (Fantasy showed 2-3). When too few qualify, the first sub-genres' searches
 * (each a Keywords search of the same kind) are added to the pool, same books never twice. The gem rule itself stays the same; a failed extra search just adds nothing.
 */
export const GEMS_WANTED = 8;
export async function widenForGems(g: SearchGenre, books: Book[], more: (query: string) => Promise<Book[]> = q => searchBooksLive(q, { scope: 'keywords', limit: 40, final: true, local: false })): Promise<Book[]> {
  const rated = books.map(b => (externalRating(b) ? b : applyInfo(b)));
  if (hiddenGems(rated, g.kind).length >= GEMS_WANTED) return books;
  const seen = new Set(books.map(b => b.id));
  const out = [...books];
  for (const sub of g.subgenres.slice(0, 3)) {
    try {
      for (const b of await more(sub.query)) if (!seen.has(b.id)) { seen.add(b.id); out.push(b); }
    } catch {}
    if (hiddenGems(out.map(b => (externalRating(b) ? b : applyInfo(b))), g.kind).length >= GEMS_WANTED) break;
  }
  return out;
}

async function genrePool(g: SearchGenre): Promise<PoolResult> {
  const fresh = pools.get(g.query);
  if (fresh) return { books: fresh, failed: false };
  let p = inFlight.get(g.query);
  if (!p) {
    const stale = pools.peek(g.query)?.value;
    p = (async () => {
      let failed = false;
      try {
        // The shared list (Supabase) comes before the slow public sites; it does nothing until the table exists (migration not applied yet)
        const shared = await readShared('genre_pool', g.query);
        // A shared list with no rating at all is not trusted (Hidden Gems could never use it): it is asked for live instead
        if (shared?.some(b => externalRating(b))) { pools.set(g.query, shared); return { books: shared, failed: false }; }
        const books = await searchBooksLive(g.query, {
          scope: 'keywords', limit: 40, final: true, local: false,
          onUpdate: (_books, state) => { if (state.done) failed = !!state.failedSources?.length; },
        });
        if (failed) return { books: stale && stale.length >= books.length ? stale : books, failed: true }; // not saved: a partial answer never replaces the last good list
        // An EMPTY answer (providers slow, timed out or rate-limited without saying so) is a failure, not a result: never save it, or the genre shows 0 results and no Hidden Gems for a whole day.
        if (!books.length) return { books: stale ?? [], failed: true };
        const rated = await withFallbackRatings(await widenForGems(g, books));
        pools.set(g.query, rated);
        void writeShared('genre_pool', g.query, rated); // admin devices only; a good list is shared for everyone
        return { books: rated, failed: false };
      } catch {
        return { books: stale ?? [], failed: true };
      }
    })()
      .finally(() => { inFlight.delete(g.query); });
    inFlight.set(g.query, p);
  }
  return p;
}

type Row = 'new' | 'gems';
const sources = new Map<string, ShelfSource>();

/** A shelf source for one row of a genre page. One object per genre and row (a shelf reloads when its source changes). Fails (so the row hides itself) when too few books qualify. */
export function genreRowSource(g: SearchGenre, row: Row): ShelfSource {
  const key = `${g.label}|${row}`;
  let src = sources.get(key);
  if (src) return src;
  const cut = (pool: readonly Book[]) => (row === 'new' ? newReleases(pool, g.kind) : hiddenGems(pool, g.kind));
  const showable = (pool: readonly Book[]) => {
    const books = cut(pool);
    return books.length >= (row === 'gems' ? 1 : MIN_ROW) ? books : null;
  };
  src = {
    id: `genre-${row}-${g.label}`,
    cached: () => {
      const fresh = pools.get(g.query);
      if (fresh) {
        const current = showable(fresh);
        const previous = row === 'gems' ? gemShelves.peek(g.query)?.value : undefined;
        const lastGood = previous && showable(previous);
        return lastGood && lastGood.length > (current?.length ?? 0) ? lastGood : current;
      }
      const oldPool = pools.peek(g.query)?.value;
      const oldGems = row === 'gems' ? gemShelves.peek(g.query)?.value : undefined;
      return (oldPool && showable(oldPool)) || (oldGems && showable(oldGems)) || null;
    },
    load: async onUpdate => {
      const result = await genrePool(g);
      let books = showable(result.books);
      // Hidden Gems with too few rated books (cookbooks, chick lit: 9-15 of 40 had a rating): rate more of the pool (up to 24 more, background priority) once, keep it, and look again
      if (!books && row === 'gems' && !result.failed && result.books.length) {
        try {
          const richer = await withFallbackRatings(result.books, undefined, 24);
          if (richer.filter(externalRating).length > result.books.filter(externalRating).length) { pools.set(g.query, richer); books = showable(richer); }
        } catch {}
      }
      if (!books) {
        const lastGood = row === 'gems' ? gemShelves.peek(g.query)?.value : undefined;
        if (lastGood && showable(lastGood)) return showable(lastGood)!;
        if (result.failed) {
          throw new Error('genre provider refresh failed');
        }
        throw new InsufficientShelfError();
      }
      if (row === 'gems') {
        const lastGood = gemShelves.peek(g.query)?.value;
        const previous = lastGood && showable(lastGood);
        if (previous && (result.failed || previous.length > books.length)) return previous;
        gemShelves.set(g.query, books);
      }
      fillMissingCovers(books, onUpdate, undefined, { upgradeWeak: ROW_SIZE }); // a modern flat front in place of an old scan, as the covers are found
      return books;
    },
  };
  sources.set(key, src);
  return src;
}

/**
 * Admin "Fill shared lists": make sure the shared table holds this genre's list. Skips a genre whose live row exists; otherwise searches (up to 3 tries, the sites are slow,
 * a short answer of at least 20 books is accepted), adds fallback ratings, saves it on this device and writes it for every reader. Returns what happened.
 * `deps` lets tests run it without the network.
 */
export type FillResult = 'already' | 'filled' | 'failed' | 'not-admin';
export interface FillDeps {
  read: (q: string) => Promise<Book[] | null>;
  search: (q: string) => Promise<{ books: Book[]; failed: boolean }>;
  rate: (b: Book[]) => Promise<Book[]>;
  write: (q: string, b: Book[]) => Promise<boolean>;
  wait: (ms: number) => Promise<void>;
}
const realFill: FillDeps = {
  read: q => readShared('genre_pool', q),
  search: async q => { let failed = false; const books = await searchBooksLive(q, { scope: 'keywords', limit: 40, final: true, local: false, onUpdate: (_b, s) => { if (s.done) failed = !!s.failedSources?.length; } }); return { books, failed }; },
  rate: b => withFallbackRatings(b),
  write: (q, b) => writeShared('genre_pool', q, b),
  wait: ms => new Promise(r => setTimeout(r, ms)),
};
export const FILL_MIN_BOOKS = 20;
export async function fillSharedGenre(g: SearchGenre, deps: FillDeps = realFill): Promise<FillResult> {
  const have = await deps.read(g.query);
  if (have?.some(b => externalRating(b))) return 'already';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await deps.wait(4000 * attempt);
    let r: { books: Book[]; failed: boolean };
    try { r = await deps.search(g.query); } catch { continue; }
    if (r.books.length < (r.failed ? FILL_MIN_BOOKS : 3)) continue;
    const rated = await deps.rate(await widenForGems(g, r.books));
    if (!rated.some(b => externalRating(b))) continue;
    pools.set(g.query, rated);
    return (await deps.write(g.query, rated)) ? 'filled' : 'not-admin';
  }
  return 'failed';
}

/**
 * "Popular now" when the genre's official NYT list is not available (the NYT stopped publishing it, or its few requests a minute are used): the most-read books of
 * the genre's own pool (most ratings first, right kind, with a cover). Labelled "Popular now" like the NYT row; never claims to be the NYT list.
 */
export function mostReadSource(g: SearchGenre): ShelfSource {
  const cut = (pool: readonly Book[]) => pool.filter(b => hasCover(b) && rightKind(b, g.kind) && Number(b.ratingCount) > 0)
    .sort((x, y) => Number(y.ratingCount) - Number(x.ratingCount)).slice(0, ROW_SIZE);
  return {
    id: `genre-most-read-${g.label}`,
    cached: () => { const p = pools.peek(g.query)?.value; const r = p ? cut(p) : []; return r.length >= MIN_ROW ? r : null; },
    load: async () => {
      const r = cut((await genrePool(g)).books);
      if (r.length < MIN_ROW) throw new InsufficientShelfError();
      return r;
    },
  };
}

/** The stored list for a genre query: this device's last good pool, else the shared one. No network when the device has it. Used to lead a typed genre search. */
export async function storedGenreList(query: string): Promise<Book[] | null> {
  const local = pools.peek(query)?.value;
  if (local && local.length >= MIN_ROW) return local;
  return readShared('genre_pool', query);
}
