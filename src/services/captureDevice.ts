/**
 * Feeds the owner-only capture (capture.ts): what each lookup finds as it happens, and, once, everything this device already holds
 * (your library, the Store shelves shipped with the app, saved lookups and cover lists).
 */
import resolvedData from '../data/storeResolved.json';
import { CURATED_SHELVES } from '../data/storeCatalog';
import type { Book } from '../types';
import { coverKey } from './books/coverAnalysis';
import { peekCoverCandidates, setCandidateSink } from './books/coverCandidates';
import { getMyCoverPick } from './books/coverPicks';
import { getInfo, setInfoSink, siteRatingsOf } from './books/infoStore';
import { hasRealSummary, isKnownGenre } from './books/model';
import { backfillDone, captureBook, captureMany, captureOn, captureStatus, markBackfillDone, type CaptureItem, type CaptureRating } from './capture';

const SITES = new Set(['apple', 'google', 'openlibrary']);

/** Merge two descriptions of the same book: the first one's values win, gaps are filled from the second. */
export function mergeItems(a: CaptureItem, b: CaptureItem): CaptureItem {
  const ratings: CaptureRating[] = [...(a.ratings || [])];
  for (const r of b.ratings || []) if (!ratings.some(x => x.source === r.source)) ratings.push(r);
  return {
    title: a.title, author: a.author || b.author,
    covers: [...new Set([...(a.covers || []), ...(b.covers || [])])],
    summary: a.summary || b.summary, authorBio: a.authorBio || b.authorBio,
    year: a.year || b.year, pageCount: a.pageCount || b.pageCount, genre: a.genre || b.genre,
    ratings,
  };
}

/** What this device knows about one book right now (no network). */
export function itemOf(book: Pick<Book, 'title' | 'author'> & Partial<Book>): CaptureItem {
  const entry = getInfo(book as Book);
  const covers = [book.coverUrl, getMyCoverPick(book)?.url, ...peekCoverCandidates(book).map(c => c.url)].filter((u): u is string => !!u);
  return {
    title: book.title, author: book.author,
    covers,
    summary: hasRealSummary(book.summary) ? book.summary : entry.facts.summary,
    authorBio: book.authorBio || entry.facts.authorBio,
    year: /^\d{3,4}$/.test(book.year || '') ? book.year : entry.facts.year,
    pageCount: book.pageCount || entry.facts.pageCount,
    genre: isKnownGenre(book.genre) ? book.genre : entry.facts.genre,
    ratings: siteRatingsOf(entry).map(r => ({ source: r.source, average: r.average, count: r.count })),
  };
}

/** Everything on this device: library books and the Store shelves (the list shipped with the app, with its covers and ratings). */
export function deviceItems(library: Book[]): CaptureItem[] {
  const out = new Map<string, CaptureItem>();
  const add = (it: CaptureItem) => {
    if (!it.title?.trim()) return;
    const k = coverKey(it);
    const cur = out.get(k);
    out.set(k, cur ? mergeItems(cur, it) : it);
  };
  for (const b of library) add(itemOf(b));
  const shipped = resolvedData as unknown as Record<string, ({ coverUrl?: string; year?: string; pageCount?: number; sources?: Record<string, [number, number]> } | null)[]>;
  for (const shelf of CURATED_SHELVES) {
    shelf.seeds.forEach(([title, author], i) => {
      const r = shipped[shelf.id]?.[i];
      const base = itemOf({ title, author });
      const ratings: CaptureRating[] = Object.entries(r?.sources || {}).filter(([s, v]) => SITES.has(s) && Array.isArray(v)).map(([s, v]) => ({ source: s, average: v[0], count: v[1] }));
      add(mergeItems(base, { title, author, covers: r?.coverUrl ? [r.coverUrl] : [], year: r?.year, pageCount: r?.pageCount, ratings }));
    });
  }
  return [...out.values()];
}

let wired = false;
/** Call once at start: from then on every lookup that finds something is also kept in the catalog (owner only; otherwise nothing happens). */
export function initCapture(): void {
  if (wired) return;
  wired = true;
  setInfoSink((book) => captureBook(itemOf(book)));
  setCandidateSink((book, list) => captureBook({ title: book.title, author: book.author, covers: list.map(c => c.url) }));
}

/** The first time the owner is signed in on this device: send everything it already has. */
export function maybeBackfill(library: Book[]): void {
  if (!captureOn() || backfillDone()) return;
  void captureMany(deviceItems(library)).then(() => { if (!captureStatus().error) markBackfillDone(); });
}

/** On demand (Profile → Data): send everything again; what is already stored is skipped. */
export function backfillNow(library: Book[]): Promise<void> {
  return captureMany(deviceItems(library)).then(() => { if (!captureStatus().error) markBackfillDone(); });
}
