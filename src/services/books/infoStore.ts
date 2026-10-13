import type { Book } from '../../types';
import { dedupeInflight, transientFailureCount } from './http';
import { persistentCache } from './cache';
import { authorKey, isUnknownAuthor, titleKey } from './identity';
import { difficultyFor } from './model';
import { chooseRating, externalRating, setRating, type SourceRating } from './ratings';
import { prefetchedSourceRatings } from './prefetchIndex';
import { RATING_SITES, legacyBookInfo, lookupAuthorBio, lookupMeta, lookupRatingSources, lookupSummary, weak, weakBio } from './details';

/**
 * Book Info's own memory: everything found about a book, kept per FIELD, so a screen can draw it at once and only the missing parts are fetched.
 *
 *  - found values are saved the moment they are found (a page count and a year are kept even when no site has a rating);
 *  - each site's rating is its own entry (average + count + when), never combined with another site's;
 *  - a field with nothing yet is in one of two states: MISSING (the sites answered and have nothing: not asked again for a while) or
 *    FAILED (offline, timed out, rate limited, malformed answer: asked again after a short, growing wait). A failure is never saved as "no data";
 *  - old values are shown at once and refreshed in the background when they are older than their time-to-live.
 *
 * Nothing here touches the library, reading history, saved books, preferences or any other cache: this is a separate, re-downloadable key
 * (readlife.bookinfo1). The older caches (readlife.meta6, readlife.ratingsrc3) are read as a starting point, never deleted.
 */

export type RatingSite = SourceRating['source'];
export type InfoField = 'year' | 'pageCount' | 'genre' | 'summary' | 'authorBio' | `rating:${RatingSite}`;
/** One group = one provider round trip (or two): fields that come from the same lookup are fetched together. */
export type InfoGroup = 'lookup' | 'text';
const GROUP_OF = (f: InfoField): InfoGroup => (f === 'summary' || f === 'authorBio' ? 'text' : 'lookup');

const DAY = 24 * 60 * 60 * 1000;
export const INFO_TUNING = {
  /** Ratings change: each site's own pair is refreshed (in the background, the old one stays on screen) after this long. */
  ratingTtlMs: { openlibrary: 7 * DAY, google: 7 * DAY, apple: 7 * DAY } as Record<RatingSite, number>,
  /** Year, pages, genre, synopsis and author bio hardly change. */
  factTtlMs: 60 * DAY,
  /** A site answered and has nothing: do not ask again for this long (ratings can appear later, so they come back sooner than text). */
  missingMs: { rating: 7 * DAY, fact: 14 * DAY },
  /** After a failure (by number of failures in a row): wait this long before asking again. */
  backoffMs: [2 * 60 * 1000, 10 * 60 * 1000, 60 * 60 * 1000, 6 * 60 * 60 * 1000],
};

interface Missing { kind: 'missing' | 'failed'; at: number; until: number; tries: number }
export interface InfoEntry {
  facts: { year?: string; pageCount?: number; genre?: string; difficulty?: number; summary?: string; authorBio?: string };
  /** when each found fact was saved */
  at: Partial<Record<'year' | 'pageCount' | 'genre' | 'summary' | 'authorBio', number>>;
  ratings: Partial<Record<RatingSite, { average: number; count: number; at: number }>>;
  miss: Partial<Record<InfoField, Missing>>;
}
const EMPTY: InfoEntry = Object.freeze({ facts: {}, at: {}, ratings: {}, miss: {} }) as InfoEntry;

const store = persistentCache<InfoEntry>('readlife.bookinfo1', {
  ttl: 365 * DAY,
  max: 500,
  validate: v => !!v && typeof v === 'object' && !!v.facts && typeof v.facts === 'object' && !!v.ratings && typeof v.ratings === 'object' && !!v.miss && typeof v.miss === 'object' && !!v.at && typeof v.at === 'object',
});

let clock = () => Date.now();
/** Tests only. */
export const setInfoClockForTests = (fn?: () => number) => { clock = fn ?? (() => Date.now()); };
/** Tests only: forget in-memory state (saved data is the test's own storage). */
export const resetInfoStoreForTests = () => { seeded.clear(); inflightNow.clear(); versions.clear(); adopted.clear(); };

/**
 * One key per book, the same normalised title + first author the resolver uses when there is no ISBN, so a Store card, the NYT list, a search result and
 * a library copy of the same book share one entry however each spells the author, and an edition without an ISBN finds the entry of the one with.
 */
export const infoKey = (b: Pick<Book, 'title' | 'author'>) => `${titleKey(b.title)}|${authorKey(b.author || '')}`;

const seeded = new Map<string, InfoEntry>();
function seedFromLegacy(book: Book): InfoEntry {
  const old = legacyBookInfo(book);
  if (!old.meta && !old.ratings.length) return EMPTY;
  const t = clock();
  const e: InfoEntry = { facts: {}, at: {}, ratings: {}, miss: {} };
  const m = old.meta;
  if (m?.year) { e.facts.year = m.year; e.at.year = t; }
  if (m?.pageCount) { e.facts.pageCount = m.pageCount; e.at.pageCount = t; e.facts.difficulty = difficultyFor(m.pageCount); }
  if (m?.genre) { e.facts.genre = m.genre; e.at.genre = t; }
  for (const r of old.ratings) if (r.count && r.count > 0) e.ratings[r.source] = { average: r.average, count: r.count, at: t };
  return e;
}

/**
 * The ratings shipped with the app (storeResolved.json, one pair per site, Google included) fill every site a saved entry has no VALID rating for (none, or a pair that is not valid, such as a count of 0).
 * An entry saved on this device before those ratings were bundled (or while Google could not be reached) holds "no Google rating", or a wait before
 * asking again, and the bundled pair was only ever read inside a lookup that such an entry blocks: a phone that had opened the book earlier kept
 * showing no Google rating, while a browser or a reinstalled app (empty storage) showed it. Only GAPS are filled: a valid pair already saved for a site is
 * left to the normal refresh, and the same book's wait for that site is lifted, because a rating is now known. The result is the same object until the
 * saved entry changes (useSyncExternalStore), and is saved with the next normal update.
 */
const adopted = new Map<string, { base: InfoEntry; out: InfoEntry }>();
function withBundledRatings(book: Book, base: InfoEntry, key: string): InfoEntry {
  const bundled = prefetchedSourceRatings(book);
  const validSaved = (site: RatingSite) => { const s = base.ratings[site]; return !!s && !!externalRating({ ratingAverage: s.average, ratingCount: s.count }); };
  const gaps = bundled?.ratings.filter(r => !validSaved(r.source) && externalRating({ ratingAverage: r.average, ratingCount: r.count })) ?? [];
  if (!gaps.length) return base;
  const memo = adopted.get(key);
  if (memo && memo.base === base) return memo.out;
  const t = clock();
  const ratings = { ...base.ratings };
  const miss = { ...base.miss };
  for (const r of gaps) { ratings[r.source] = { average: r.average, count: r.count as number, at: t }; delete miss[`rating:${r.source}` as InfoField]; }
  const out: InfoEntry = { ...base, ratings, miss };
  adopted.set(key, { base, out });
  return out;
}

/** What is saved about a book (instantly, no network). Always the same object until something changes: safe for useSyncExternalStore. */
export function getInfo(book: Book): InfoEntry {
  const key = infoKey(book);
  const saved = store.peek(key)?.value;
  if (saved) return withBundledRatings(book, saved, key);
  let s = seeded.get(key);
  if (!s) { s = seedFromLegacy(book); seeded.set(key, s); }
  return withBundledRatings(book, s, key);
}

// ---- subscribers (screens re-draw when what they show was found) ----
const listeners = new Map<string, Set<() => void>>();
const versions = new Map<string, number>();
export function subscribeInfo(book: Book, fn: () => void): () => void {
  const key = infoKey(book);
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(fn);
  return () => { set!.delete(fn); if (!set!.size) listeners.delete(key); };
}
const notify = (key: string) => { versions.set(key, (versions.get(key) || 0) + 1); listeners.get(key)?.forEach(fn => { try { fn(); } catch {} }); };

function update(book: Book, change: (e: InfoEntry) => InfoEntry) {
  const key = infoKey(book);
  const next = change(getInfo(book));
  store.set(key, next);
  seeded.delete(key);
  adopted.delete(key);
  notify(key);
}

// ---- what is still missing ----
const isYear = (y?: string) => !!y && y !== 'N/A';
export const hasGenre = (b: Pick<Book, 'genre'>) => !!b.genre && b.genre !== 'Book';

const blocked = (e: InfoEntry, f: InfoField, now: number) => { const m = e.miss[f]; return !!m && m.until > now; };

/**
 * The fields worth asking a site for right now: not yet known (on the book or saved), not recently confirmed missing, not waiting out a failure.
 * Found-but-old values (past their time-to-live) are listed too: they are refreshed while the saved value stays on screen.
 */
export function missingFields(book: Book, entry: InfoEntry = getInfo(book), now = clock()): InfoField[] {
  const out: InfoField[] = [];
  const add = (f: InfoField) => { if (!blocked(entry, f, now)) out.push(f); };
  const stale = (t: number | undefined, ttl: number) => t !== undefined && now - t > ttl;
  const curated = typeof book.id === 'number';

  if (!isYear(book.year) && (!entry.facts.year || stale(entry.at.year, INFO_TUNING.factTtlMs))) add('year');
  if (!book.pageCount && (!entry.facts.pageCount || stale(entry.at.pageCount, INFO_TUNING.factTtlMs))) add('pageCount');
  if (!curated && !hasGenre(book) && !entry.facts.genre) add('genre');
  for (const site of RATING_SITES) {
    const r = entry.ratings[site];
    if (!r || stale(r.at, INFO_TUNING.ratingTtlMs[site])) add(`rating:${site}`);
  }
  if (weak(book.summary) && (!entry.facts.summary || stale(entry.at.summary, INFO_TUNING.factTtlMs))) add('summary');
  if (weakBio(book.authorBio) && !isUnknownAuthor(book.author) && (!entry.facts.authorBio || stale(entry.at.authorBio, INFO_TUNING.factTtlMs))) add('authorBio');
  return out;
}

export const groupsNeeded = (fields: InfoField[]): InfoGroup[] => [...new Set(fields.map(GROUP_OF))];

// ---- saving what a lookup found ----
const found = (e: InfoEntry, f: InfoField): InfoEntry => {
  if (!e.miss[f]) return e;
  const miss = { ...e.miss };
  delete miss[f];
  return { ...e, miss };
};
function markNotFound(book: Book, fields: InfoField[], transient: boolean) {
  if (!fields.length) return;
  const t = clock();
  update(book, e => {
    const miss = { ...e.miss };
    for (const f of fields) {
      const tries = transient ? Math.min((miss[f]?.kind === 'failed' ? miss[f]!.tries : 0) + 1, INFO_TUNING.backoffMs.length) : 0;
      miss[f] = transient
        ? { kind: 'failed', at: t, tries, until: t + INFO_TUNING.backoffMs[tries - 1] }
        : { kind: 'missing', at: t, tries: 0, until: t + (f.startsWith('rating:') ? INFO_TUNING.missingMs.rating : INFO_TUNING.missingMs.fact) };
    }
    return { ...e, miss };
  });
}

function saveFact(book: Book, patch: Partial<InfoEntry['facts']>) {
  const t = clock();
  update(book, e => {
    let next: InfoEntry = { ...e, facts: { ...e.facts, ...patch }, at: { ...e.at } };
    for (const k of Object.keys(patch) as (keyof InfoEntry['facts'])[]) { if (k !== 'difficulty') { next.at[k] = t; next = found(next, k as InfoField); } }
    return next;
  });
}

function saveRatings(book: Book, ratings: SourceRating[]) {
  if (!ratings.length) return;
  const t = clock();
  update(book, e => {
    let next: InfoEntry = { ...e, ratings: { ...e.ratings } };
    for (const r of ratings) {
      if (!externalRating({ ratingAverage: r.average, ratingCount: r.count })) continue; // only a real pair is ever kept
      next.ratings[r.source] = { average: r.average, count: r.count as number, at: t }; // each site keeps its OWN pair
      next = found(next, `rating:${r.source}` as InfoField);
    }
    return next;
  });
}

// ---- running lookups ----
const inflightNow = new Map<string, Promise<void>>();
const loading = new Map<string, Set<InfoGroup>>();
const setLoading = (key: string, g: InfoGroup, on: boolean) => {
  let s = loading.get(key);
  if (!s) loading.set(key, (s = new Set()));
  on ? s.add(g) : s.delete(g);
  notify(key);
};
/** Is this group of this book being fetched right now (by this screen, another screen or the background queue)? */
export const isLoadingInfo = (book: Book, g: InfoGroup) => !!loading.get(infoKey(book))?.has(g);
/** Changes whenever anything about the book changes (found, failed, started or finished): the snapshot for useSyncExternalStore. */
export const infoVersion = (book: Book) => versions.get(infoKey(book)) || 0;

async function runLookup(book: Book, fields: InfoField[]) {
  const wanted = (f: InfoField) => fields.includes(f);
  // 1. year / pages / genre (one shared resolver lookup), saved as soon as they are known
  const metaFields = (['year', 'pageCount', 'genre'] as const).filter(wanted);
  const ratingSites = RATING_SITES.filter(s => wanted(`rating:${s}`));
  if (metaFields.length) {
    const before = transientFailureCount();
    const { meta, retry } = await lookupMeta(book).catch(() => ({ meta: {} as Partial<Book>, retry: true }));
    const transient = retry || transientFailureCount() > before;
    const patch: InfoEntry['facts'] = {};
    if (wanted('year') && isYear(meta.year)) patch.year = meta.year;
    if (wanted('pageCount') && meta.pageCount) { patch.pageCount = meta.pageCount; patch.difficulty = difficultyFor(meta.pageCount); }
    if (wanted('genre') && meta.genre) patch.genre = meta.genre;
    if (Object.keys(patch).length) saveFact(book, patch);
    markNotFound(book, metaFields.filter(f => patch[f] === undefined), transient);
  }
  // 2. each site's own rating, saved as soon as the lookup returns (so a site that failed never holds back one that answered)
  if (ratingSites.length) {
    const before = transientFailureCount();
    const r = await lookupRatingSources(book, { only: ratingSites }).catch(() => null);
    if (!r) { markNotFound(book, ratingSites.map(s => `rating:${s}` as InfoField), true); return; }
    saveRatings(book, r.ratings);
    const got = new Set(r.ratings.map(x => x.source));
    const trouble = transientFailureCount() > before;
    markNotFound(book, ratingSites.filter(s => !got.has(s) && r.failed.includes(s)).map(s => `rating:${s}` as InfoField), true);
    // asked, answered, no rating: a real "none" (unless the lookup hit trouble that no site owned up to: then it is asked again soon)
    markNotFound(book, ratingSites.filter(s => !got.has(s) && !r.failed.includes(s)).map(s => `rating:${s}` as InfoField), trouble && !r.ratings.length && !r.failed.length);
  }
}

async function runText(book: Book, fields: InfoField[]) {
  if (fields.includes('summary')) {
    const before = transientFailureCount();
    const text = await lookupSummary(book).catch(() => '');
    if (text && !weak(text)) saveFact(book, { summary: text });
    else markNotFound(book, ['summary'], transientFailureCount() > before);
  }
  if (fields.includes('authorBio')) {
    const before = transientFailureCount();
    const bio = await lookupAuthorBio(book).catch(() => '');
    if (bio && !weakBio(bio)) saveFact(book, { authorBio: bio });
    else markNotFound(book, ['authorBio'], transientFailureCount() > before);
  }
}

/**
 * Fetch what is missing for one book and save it as it arrives. A group that is already being fetched (by another screen or the background queue)
 * is joined, not repeated, so opening Book Info while the queue is on the same book costs no extra request. Never throws.
 * Resolves with the book's entry once everything asked for has been tried.
 */
export async function ensureBookInfo(book: Book, only?: InfoGroup[]): Promise<InfoEntry> {
  const key = infoKey(book);
  const fields = missingFields(book);
  const groups = groupsNeeded(fields).filter(g => !only || only.includes(g));
  await Promise.all(groups.map(g => dedupeInflight(inflightNow, `${key}|${g}`, async () => {
    // Recomputed inside: a group that finished a moment ago may have found what this caller needed
    const todo = missingFields(book).filter(f => GROUP_OF(f) === g);
    if (!todo.length) return;
    setLoading(key, g, true);
    try {
      await (g === 'lookup' ? runLookup(book, todo) : runText(book, todo));
    } catch {
      markNotFound(book, todo, true);
    } finally {
      setLoading(key, g, false);
    }
  })));
  return getInfo(book);
}

// ---- showing it ----
/** Valid ratings, one per site, in the order Open Library, Google, Apple. */
export const siteRatingsOf = (e: InfoEntry): SourceRating[] =>
  RATING_SITES.flatMap(s => { const r = e.ratings[s]; return r && externalRating({ ratingAverage: r.average, ratingCount: r.count }) ? [{ source: s, average: r.average, count: r.count } as SourceRating] : []; });

/**
 * The book with everything saved filled in. Only GAPS are filled: what the book already shows (the card's rating, a curated genre, a year, pages
 * you entered) is never replaced, so a card and its sheet cannot disagree and no user data is overwritten.
 */
export function applyInfo<T extends Book>(book: T, e: InfoEntry = getInfo(book)): T {
  let out: T = book;
  const set = (patch: Partial<Book>) => { out = { ...out, ...patch }; };
  const f = e.facts;
  if (f.year && !isYear(out.year)) set({ year: f.year });
  if (f.pageCount && !out.pageCount) set({ pageCount: f.pageCount, difficulty: out.difficulty || f.difficulty || difficultyFor(f.pageCount) });
  if (f.genre && !hasGenre(out) && typeof out.id !== 'number') set({ genre: f.genre });
  if (f.summary && weak(out.summary)) set({ summary: f.summary });
  if (f.authorBio && weakBio(out.authorBio)) set({ authorBio: f.authorBio });
  if (!out.ratingAverage) {
    const pick = chooseRating({ apple: pairOf(e, 'apple'), ol: pairOf(e, 'openlibrary'), google: pairOf(e, 'google') });
    if (pick) {
      const site = RATING_SITES.find(s => e.ratings[s] && e.ratings[s]!.average === pick.average && e.ratings[s]!.count === pick.count);
      out = setRating(out, { ...pick, source: site });
    }
  }
  return out;
}
const pairOf = (e: InfoEntry, s: RatingSite) => (e.ratings[s] ? { average: e.ratings[s]!.average, count: e.ratings[s]!.count } : undefined);
