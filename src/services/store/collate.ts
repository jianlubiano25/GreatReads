import type { Book } from '../../types';
import { mapPool } from '../books/http';
import { bookKey, identityOf, sameWork } from '../books/identity';
import { kindFromSources, type BookKind } from '../books/kind';
import { mergeBooks } from '../books/merge';
import { genreFromSubjects, hasRealSummary, isKnownGenre, makeBook, shrunkRating } from '../books/model';
import { EXPLICIT_FILTER_AT, EXPLICIT_PENALTY_AT, explicitScore, type ContentFlags } from '../books/quality';
import { resolveBook } from '../books/resolve';
import { loadAppleCharts, type AppleChartEntry } from '../books/sources/appleCharts';
import { loadNytList, type NytEntry } from '../books/sources/nyt';
import { trendingOpenLibrary } from '../books/sources/openLibrary';
import { NYT_SHELVES } from './lists';
import { nytEntryToBook } from './nytBooks';
import { readUsage } from './usage';

/**
 * GreatReads' own collated ranking. Used for "Trending Today" and as the fallback for "Top 15 this week" when the NYT list can't
 * be loaded.
 *
 * Every source contributes its OWN signal, normalised to 0..1 on its own scale, and the score is a weighted blend:
 *   olDaily / olWeekly  position in Open Library's trending lists          (rank signal)
 *   apple               position in Apple Books' Top Free / Top Paid       (rank signal)
 *   nyt                 position on the NYT bestseller lists               (rank signal; ONE signal, never the authority)
 *   readers             how many readers rated it, on each source's own log scale; the strongest counts
 *   quality             rating, shrunk toward average when there are few ratings
 *   recency, metadata   newly published; complete details and a cover
 *   usage               GreatReads' own activity, once it exists (see usage.ts)
 *
 * A source that FAILED is left out of the blend and the remaining weights are rescaled to 100, so an outage never drags every
 * book's score down or hands an advantage to books that happen to be on the working lists. A book that is simply absent from a
 * list that DID load gets 0 for that signal. A signal no source provides is never invented.
 */

export type SignalId = 'olDaily' | 'olWeekly' | 'apple' | 'nyt' | 'readers' | 'quality' | 'recency' | 'metadata' | 'usage';

/** Points each signal can add before rescaling. Change a number to change how the list is weighed. */
export const SIGNAL_WEIGHTS: Record<SignalId, number> = {
  olDaily: 28,
  olWeekly: 14,
  apple: 20,
  nyt: 12,
  readers: 14,
  quality: 6,
  recency: 6,
  metadata: 4,
  usage: 15,
};
export const SUGGESTIVE_PENALTY = 25; // on the final 0..100 score

/** log10 of the rating count at which a source's "readers" signal reaches its maximum (the sources have very different audiences). */
export const READER_CAPS = { ol: 4, google: 3.5, apple: 4 } as const;

export interface Candidate {
  book: Book;
  flags: ContentFlags;
  wordSets: string[][]; // category words, one list per source (for fiction / non-fiction)
  olDaily?: { rank: number; total: number }; // rank is 0-based
  olWeekly?: { rank: number; total: number };
  apple?: { rank: number; total: number }; // 0-based, best of the free and paid charts
  nyt?: number; // 1-based rank on a NYT list
  readers: { ol?: number; google?: number; apple?: number };
  enriched?: boolean;
}

export interface Pool {
  candidates: Candidate[];
  available: Set<SignalId>; // sources that answered
  at: number;
}

/* ------------------------------ normalisation + score ------------------------------ */

/** A 0-based rank in a list of `total` -> 1 (top) .. just above 0 (bottom). */
export const listPosition = (rank: number, total: number): number => (total > 0 ? Math.max(0, 1 - rank / total) : 0);
/** NYT ranks 1..15: first is 1.0, fifteenth 0.3 (being on an official list at all counts for something). */
export const nytPosition = (rank: number): number => Math.max(0.3, 1 - (rank - 1) / 20);

export function readersValue(c: Pick<Candidate, 'readers' | 'book'>): number {
  const per = (['ol', 'google', 'apple'] as const).map(k => (c.readers[k] ? Math.min(1, Math.log10(c.readers[k]! + 1) / READER_CAPS[k]) : 0));
  const best = Math.max(0, ...per);
  // a rating count of unknown origin (older saved data) is read on the Open Library scale
  return best || (c.book.ratingCount ? Math.min(1, Math.log10(c.book.ratingCount + 1) / READER_CAPS.ol) : 0);
}

export function recencyValue(year: string | undefined, now: Date): number {
  const age = year ? now.getFullYear() - Number(year) : 99;
  return age <= 0 ? 1 : age === 1 ? 0.6 : age <= 3 ? 0.3 : 0;
}

export function metadataValue(b: Book): number {
  return (b.coverId || b.coverUrl ? 0.4 : 0) + (hasRealSummary(b.summary) ? 0.3 : 0) + (b.pageCount ? 0.15 : 0) + (isKnownGenre(b.genre) ? 0.15 : 0);
}

/** Every signal's 0..1 value for a candidate (rank signals are 0 when the book is not on a list that did load). */
export function signalValues(c: Candidate, usage: { counts: Map<string, number>; max: number } | null, now = new Date()): Record<SignalId, number> {
  const b = c.book;
  return {
    olDaily: c.olDaily ? listPosition(c.olDaily.rank, c.olDaily.total) : 0,
    olWeekly: c.olWeekly ? listPosition(c.olWeekly.rank, c.olWeekly.total) : 0,
    apple: c.apple ? listPosition(c.apple.rank, c.apple.total) : 0,
    nyt: c.nyt ? nytPosition(c.nyt) : 0,
    readers: readersValue(c),
    quality: b.ratingAverage ? Math.max(0, Math.min(1, (shrunkRating(b.ratingAverage, b.ratingCount) - 3.5) / 1.5)) : 0,
    recency: recencyValue(b.year, now),
    metadata: metadataValue(b),
    usage: usage && usage.max > 0 ? Math.min(1, (usage.counts.get(bookKey(b)) || 0) / usage.max) : 0,
  };
}

/**
 * The 0..100 score over the signals whose source is available, with a per-signal breakdown (so it is always clear why a book is
 * where it is). Weights of unavailable signals are dropped and the rest rescaled.
 */
export function scoreCandidate(
  c: Candidate,
  available: ReadonlySet<SignalId>,
  usage: { counts: Map<string, number>; max: number } | null = null,
  now = new Date(),
): { score: number; parts: Partial<Record<SignalId, number>>; explicit: number } {
  const values = signalValues(c, usage, now);
  const ids = (Object.keys(SIGNAL_WEIGHTS) as SignalId[]).filter(id => available.has(id));
  const total = ids.reduce((n, id) => n + SIGNAL_WEIGHTS[id], 0) || 1;
  const parts: Partial<Record<SignalId, number>> = {};
  let score = 0;
  for (const id of ids) {
    parts[id] = (SIGNAL_WEIGHTS[id] / total) * 100 * values[id];
    score += parts[id]!;
  }
  const explicit = explicitScore(c.book.title, c.flags);
  if (explicit >= EXPLICIT_PENALTY_AT) score -= SUGGESTIVE_PENALTY;
  return { score, parts, explicit };
}

export const kindOfCandidate = (c: Candidate): BookKind => kindFromSources(...c.wordSets);

/** Best score first, but each extra book of an already-picked genre costs points, so one genre cannot take over the shelf. */
export function pickDiverse<T extends { book: Book; score: number }>(items: T[], limit: number, genrePenalty = 9): T[] {
  const left = [...items].sort((a, b) => b.score - a.score);
  const picked: T[] = [];
  const used: Record<string, number> = {};
  const genreOf = (b: Book) => (isKnownGenre(b.genre) ? b.genre : '');
  while (picked.length < limit && left.length) {
    let bestI = 0;
    let bestV = -Infinity;
    left.forEach((it, i) => {
      const g = genreOf(it.book);
      const v = it.score - (g ? genrePenalty * (used[g] || 0) : 0);
      if (v > bestV) { bestV = v; bestI = i; }
    });
    const [it] = left.splice(bestI, 1);
    picked.push(it);
    const g = genreOf(it.book);
    if (g) used[g] = (used[g] || 0) + 1;
  }
  return picked.sort((a, b) => b.score - a.score);
}

export interface Ranked { book: Book; score: number; parts: Partial<Record<SignalId, number>> }

/** The best `limit` books in the pool: explicit ones left out, optionally one kind only (never mixing fiction and non-fiction). */
export function rankPool(pool: Pool, opts: { limit: number; kind?: BookKind; now?: Date }): Ranked[] {
  const usageCounts = readUsage();
  const usage = usageCounts && usageCounts.size ? { counts: usageCounts, max: Math.max(...usageCounts.values()) } : null;
  const available = new Set(pool.available);
  if (usage) available.add('usage');

  let scored = pool.candidates
    .filter(c => (opts.kind ? kindOfCandidate(c) === opts.kind : true))
    .map(c => ({ c, ...scoreCandidate(c, available, usage, opts.now) }))
    .filter(x => x.explicit < EXPLICIT_FILTER_AT);
  const withCover = scored.filter(x => x.c.book.coverId || x.c.book.coverUrl);
  if (withCover.length >= opts.limit) scored = withCover; // prefer books that can show a cover, unless that leaves the shelf short
  return pickDiverse(scored.map(x => ({ book: x.c.book, score: x.score, parts: x.parts })), opts.limit);
}

/* ------------------------------ gathering ------------------------------ */

const sameCandidate = (c: Candidate, book: Book) => sameWork(c.book, book);

function upsert(list: Candidate[], book: Book, flags: ContentFlags, words: string[] | undefined, patch: Partial<Candidate>, readers: Candidate['readers'] = {}): void {
  const i = list.findIndex(c => sameCandidate(c, book));
  if (i >= 0) {
    const c = list[i];
    Object.assign(c, patch);
    c.readers = { ...c.readers, ...Object.fromEntries(Object.entries(readers).filter(([, v]) => v)) };
    c.book = mergeBooks(c.book, book);
    if (words?.length) c.wordSets.push(words);
    c.flags = { ...c.flags, subjects: [...(c.flags.subjects || []), ...(flags.subjects || [])], description: c.flags.description || flags.description };
  } else {
    list.push({ book, flags, wordSets: words?.length ? [words] : [], readers: { ...readers }, ...patch });
  }
}

export function appleEntryToBook(e: AppleChartEntry): Book {
  return makeBook({
    id: `apple_${e.id}`,
    title: e.title,
    author: e.author || 'Unknown Author',
    genre: genreFromSubjects(e.genres) || e.genres[0] || 'Book',
    coverUrl: e.cover || undefined,
    source: 'apple',
  });
}

const APPLE_DEPTH = 40; // how far down each Apple chart to look for candidates

let poolPromise: Promise<Pool | null> | null = null;
let poolAt = 0;
const POOL_TTL = 10 * 60 * 1000;

async function build(): Promise<Pool | null> {
  const [daily, weekly, apple, ...nyt] = await Promise.all([
    trendingOpenLibrary('daily', 50),
    trendingOpenLibrary('weekly', 60),
    loadAppleCharts(),
    ...NYT_SHELVES.map(s => loadNytList(s.list)), // shared with the official shelves: usually already cached, no extra request
  ]);
  const available = new Set<SignalId>(['readers', 'quality', 'recency', 'metadata']);
  const candidates: Candidate[] = [];

  if (daily) {
    available.add('olDaily');
    daily.forEach(h => upsert(candidates, h.book, h.flags, h.flags.subjects, { olDaily: { rank: h.rank, total: daily.length } }, { ol: h.book.ratingCount }));
  }
  if (weekly) {
    available.add('olWeekly');
    weekly.forEach(h => upsert(candidates, h.book, h.flags, h.flags.subjects, { olWeekly: { rank: h.rank, total: weekly.length } }, { ol: h.book.ratingCount }));
  }
  if (apple) {
    available.add('apple');
    // best position across the free and paid charts
    for (const chart of ['top-free', 'top-paid'] as const) {
      apple.filter(e => e.chart === chart && e.rank <= APPLE_DEPTH).forEach(e => {
        const book = appleEntryToBook(e);
        const existing = candidates.find(c => sameCandidate(c, book));
        const pos = { rank: e.rank - 1, total: e.total };
        const better = !existing?.apple || listPosition(pos.rank, pos.total) > listPosition(existing.apple.rank, existing.apple.total);
        upsert(candidates, book, { subjects: e.genres }, e.genres, better ? { apple: pos } : {});
      });
    }
  }

  // NYT is a signal for books that are already candidates. It only supplies candidates itself when no other list answered.
  const nytAll: { entry: NytEntry; kind: BookKind }[] = [];
  nyt.forEach((r, i) => (r.entries || []).forEach(entry => nytAll.push({ entry, kind: NYT_SHELVES[i].kind })));
  if (nyt.every(r => r.entries?.length)) available.add('nyt');
  if (!candidates.length) {
    for (const { entry, kind } of nytAll) {
      const shelf = NYT_SHELVES.find(s => s.kind === kind)!;
      upsert(candidates, nytEntryToBook(entry, shelf.genre), {}, [shelf.genre], { nyt: entry.rank });
    }
  } else {
    for (const c of candidates) {
      const id = identityOf(c.book);
      const hit = nytAll.find(n => (id.isbn13 && id.isbn13 === n.entry.isbn13) || sameWork(c.book, { id: '', title: n.entry.title, author: n.entry.author, identity: { isbn13: n.entry.isbn13, isbn10: n.entry.isbn10 } }));
      if (hit) {
        c.nyt = hit.entry.rank;
        c.wordSets.push([NYT_SHELVES.find(s => s.kind === hit.kind)!.genre]); // the NYT's own list name says which kind it is
      }
    }
  }

  if (!candidates.length) return null;
  if (readUsage()) available.add('usage');
  return { candidates, available, at: Date.now() };
}

/** Gather candidates and signals from every source that answers (once per 10 minutes, shared by every shelf). null if none did. */
export function gatherPool(force = false): Promise<Pool | null> {
  if (!force && poolPromise && Date.now() - poolAt < POOL_TTL) return poolPromise;
  const p = build().then(r => { if (!r && poolPromise === p) poolPromise = null; return r; }, () => { if (poolPromise === p) poolPromise = null; return null; });
  poolPromise = p;
  poolAt = Date.now();
  return p;
}
export const resetPoolForTests = () => { poolPromise = null; poolAt = 0; };

/**
 * Look the best candidates up in Open Library + Google (+ Apple) for covers, ratings, categories and descriptions. This is what
 * lets fiction be told from non-fiction, and explicit books be caught. Shared work: a candidate is only ever looked up once.
 */
export async function enrichPool(pool: Pool, opts: { kind?: BookKind; max?: number; onProgress?: () => void }): Promise<void> {
  const available = new Set(pool.available);
  const order = pool.candidates
    .filter(c => !c.enriched && (!opts.kind || kindOfCandidate(c) !== (opts.kind === 'fiction' ? 'nonfiction' : 'fiction')))
    .map(c => ({ c, score: scoreCandidate(c, available).score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.max ?? 24)
    .map(x => x.c);
  await mapPool(order, 4, async c => {
    const id = identityOf(c.book);
    const r = await resolveBook({ title: c.book.title, author: c.book.author, isbn: id.isbn13 || id.isbn10, fallbackId: c.book.id, apple: true }).catch(() => null);
    c.enriched = true;
    if (!r) return;
    const keepId = String(r.book.id).startsWith('ol_') ? r.book.id : c.book.id;
    c.book = { ...mergeBooks(c.book, r.book), id: keepId };
    c.flags = {
      subjects: [...(c.flags.subjects || []), ...(r.flags.subjects || [])],
      description: r.flags.description || c.flags.description,
      googleMaturity: r.flags.googleMaturity || c.flags.googleMaturity,
      appleAdvisory: r.flags.appleAdvisory || c.flags.appleAdvisory,
    };
    if (r.words?.length) c.wordSets.push(r.words);
    c.readers = { ...c.readers, ...Object.fromEntries(Object.entries(r.readers || {}).filter(([, v]) => v)) };
    opts.onProgress?.();
  });
}
