import { type Book } from '../../types';
import { COVER_CACHE_KEYS, persistentCache } from './cache';
import { transientFailureCount } from './http';
import { identityOf, isUnknownAuthor, primaryAuthor } from './identity';
import { findApple } from './sources/appleBooks';
import { findGoogle, googleVolume } from './sources/googleBooks';
import { isEnglishLanguage, titleIsNonLatin } from './language';
import { olCoverById, olCoverByIsbn, openLibraryEditionCovers, openLibraryEnglishCoverFor, findOpenLibrary, BUNDLE_TITLE } from './sources/openLibrary';
import { coverKey, flatKey, probeImage } from './coverAnalysis';
import { COVER_SOURCE_LABEL, type CoverSource } from './coverPicks';

/* ======================================================================================================
 * the covers offered in the cover viewer  (was coverCandidates.ts)
 * ====================================================================================================== */

/**
 * The covers a book has, for the cover viewer: the same source functions the cover resolver uses, but collecting every cover instead of
 * stopping at the first. Each source answers on its own and its covers are handed over as they arrive, so the viewer opens at once and
 * fills in. Open Library's edition cover ids and the covers the APIs return are trusted as given (the viewer drops one that fails to load),
 * so no image is probed up front.
 *
 * Requests happen once per book: callers asking while a lookup runs share it, and a finished lookup is remembered on this device for a week
 * (a lookup disturbed by a network failure is not remembered). Nothing is fetched for a book nobody opened.
 */

/** `foreign`: the picture belongs to another language's edition (kept, but always after every English one) */
export type CoverCandidate = { url: string; source: CoverSource; foreign?: true };
const SOURCE_RANK: Record<string, number> = { apple: 0, google: 1, openlibrary: 2 };
/**
 * THE order covers are tried in, for the shelves and the cover viewer alike: English before another language's edition, then Apple, Google, Open Library (Apple's art is
 * flat, modern and clean; Open Library's scans are the likeliest to be a spine, a back or a photographed book). Within a source the order it gave stays. The three
 * sources answer at different speeds, so the arrival order never decides.
 */
export const rankCandidates = (list: CoverCandidate[]): CoverCandidate[] =>
  list.map((c, i) => ({ c, i })).sort((a, b) => Number(!!a.c.foreign) - Number(!!b.c.foreign) || (SOURCE_RANK[a.c.source] ?? 9) - (SOURCE_RANK[b.c.source] ?? 9) || a.i - b.i).map(x => x.c);
export const coverSourceLabel = (s: CoverSource): string => COVER_SOURCE_LABEL[s];

const MAX_CANDIDATES = 14;
const MAX_OL = 8;

/** One key per picture, whatever its size (the same Apple art at 200x300 and 600x900, the same Open Library cover as S / M / L): the key the picture's verdict is saved under. */
export const imageKey = flatKey;

type Finder = (b: Pick<Book, 'title' | 'author' | 'id' | 'identity' | 'coverId'>, author: string) => Promise<CoverCandidate[]>;

const fromApple: Finder = async (b, author) => {
  const hit = await findApple({ title: b.title, author });
  return hit?.book.coverUrl ? [{ url: hit.book.coverUrl, source: 'apple' }] : [];
};

const fromGoogle: Finder = async (b, author) => {
  const id = identityOf(b);
  const exact = id.gbVolume ? await googleVolume(id.gbVolume) : null; // the exact edition when we know it
  const byName = !exact?.book.coverUrl || !isEnglishLanguage(exact.flags.language) ? await findGoogle({ title: b.title, author, isbn: id.isbn13 || id.isbn10 }, {}, ['cover']) : null;
  // English jackets first; another language's edition is still offered (the reader may want it), but after
  return [byName, exact].filter((h): h is NonNullable<typeof h> => !!h?.book.coverUrl && !BUNDLE_TITLE.test(h.book.title || '')) // a box set / "3 in 1" volume's jacket is a collage, never the book
    .map(h => ({ url: h.book.coverUrl!, source: 'google' as const, ...(isEnglishLanguage(h.flags.language) ? {} : { foreign: true as const }) }));
};

const fromOpenLibrary: Finder = async (b, author) => {
  const id = identityOf(b);
  const isbn = id.isbn13 || id.isbn10;
  let work = id.olWork;
  let first = b.coverId && b.coverId > 0 ? b.coverId : undefined;
  // The exact edition (the ISBN the book is pinned to) is asked at the same time as its work
  const byIsbn = isbn ? probeImage(olCoverByIsbn(isbn, 'L'), 5000, true) : Promise.resolve(false);
  if (!work) {
    const hit = await findOpenLibrary({ title: b.title, author, isbn });
    work = hit?.book.identity?.olWork;
    first = first ?? hit?.book.coverId;
  }
  const editions = work ? await openLibraryEditionCovers(work, MAX_OL) : [];
  const translation = !!(work && first) && (await openLibraryEnglishCoverFor(work, first)) !== first;
  // An English edition's own cover leads; the work's cover_i (any edition's) follows it, unless it is provably a translation's (then it is last and marked foreign)
  const english = [...editions, ...(first && !translation ? [first] : [])].filter((n, i, a) => a.indexOf(n) === i);
  const out: CoverCandidate[] = english.map(n => ({ url: olCoverById(n, 'L'), source: 'openlibrary' as const }));
  if (translation) out.push({ url: olCoverById(first!, 'L'), source: 'openlibrary', foreign: true });
  // No English edition has a cover (or none is tagged): another language's jacket is still offered rather than "no cover found" (English ones always lead)
  if (!out.length && work) out.push(...(await openLibraryEditionCovers(work, MAX_OL, {}, true).catch(() => [] as number[])).map(n => ({ url: olCoverById(n, 'L'), source: 'openlibrary' as const, foreign: true as const })));
  if (await byIsbn) out.unshift({ url: olCoverByIsbn(isbn!, 'L'), source: 'openlibrary' });
  return out.slice(0, MAX_OL);
};

type Run = { found: CoverCandidate[]; subs: Set<(list: CoverCandidate[]) => void>; done: Promise<CoverCandidate[]> };
const runs = new Map<string, Run>();
const cache = persistentCache<CoverCandidate[]>(COVER_CACHE_KEYS.candidates, {
  ttl: 30 * 24 * 60 * 60 * 1000, // a book's covers are looked up once and kept; Refresh Book Covers forgets them
  max: 150,
  validate: v => Array.isArray(v) && v.every(c => c && typeof c.url === 'string' && /^https:\/\//.test(c.url) && typeof c.source === 'string'),
});

function startRun(book: Pick<Book, 'title' | 'author' | 'id' | 'identity' | 'coverId'>, key: string, fast = false): Run {
  const author = isUnknownAuthor(book.author) ? '' : primaryAuthor(book.author);
  const trouble = transientFailureCount();
  const run: Run = { found: [], subs: new Set(), done: Promise.resolve([]) };
  const add = (list: CoverCandidate[]) => {
    let changed = false;
    for (const c of list) {
      if (run.found.length >= MAX_CANDIDATES) break;
      if (!run.found.some(f => imageKey(f.url) === imageKey(c.url))) { run.found.push(c); changed = true; }
    }
    if (changed) run.subs.forEach(s => s([...run.found])); // arrival order while the viewer is open (it keeps its own slide order); ranked once everything has answered
  };
  // The three sources are asked together; a source that fails or finds nothing only means fewer covers
  const own = titleIsNonLatin(book.title); // 変な絵: its own language's jacket is the book, not a translation to rank last
  const ask = (fs: Finder[]) => Promise.all(fs.map(f => f(book, author).then(l => add(own ? l.map(({ foreign, ...c }) => c) : l), () => {})));
  // A shelf card needs ONE good cover, not the whole list: Apple and Google answer in a moment, Open Library (a search, then the editions, then a probe) is the slow, rate-limited one.
  // So a shelf (fast) asks the two quick sources first and only goes on to Open Library when neither gave an English cover. The picker (not fast) asks all three, as before.
  const lookup = fast
    ? ask([fromApple, fromGoogle]).then(() => (run.found.some(c => !c.foreign) ? undefined : ask([fromOpenLibrary])))
    : ask([fromApple, fromGoogle, fromOpenLibrary]);
  run.done = lookup
    .then(() => {
      run.found = rankCandidates(run.found);
      // A lookup that was disturbed by a network failure is not remembered as "this book has these covers".
      // A short list is not remembered either (one source may simply have been slow or empty today): the picker asks again next time. A fast (shelf) lookup is partial by design, so it is never saved as the list.
      if (!fast && transientFailureCount() === trouble && run.found.length >= 2) cache.set(key, run.found);
      try { if (run.found.length) candidateSink?.(book, [...run.found]); } catch { /* capture must never disturb a lookup */ }
      return run.found;
    })
    .finally(() => { runs.delete(key + (fast ? '|fast' : '')); });
  runs.set(key + (fast ? '|fast' : ''), run);
  return run;
}

/**
 * Hand `onUpdate` the covers found so far, again each time more arrive (the list only ever grows, in a stable order). Resolves with the
 * final list. `signal` only stops the callbacks: a lookup other callers share keeps running and is remembered.
 */
/** Instant, no network: the best saved English cover for a book that has no link of its own (from a list the cover viewer or an earlier lookup already kept), or ''. */
/** Instant, no network: every cover a finished lookup kept for this book (empty when none). */
export const peekCoverCandidates = (book: { title?: string; author?: string }): CoverCandidate[] => { const saved = cache.get(coverKey(book)); return saved ? [...saved] : []; };

/** Told what a lookup found (the owner's quiet catalog capture listens here). Never throws into the lookup. */
type CandidateSink = (book: { title: string; author?: string }, list: CoverCandidate[]) => void;
let candidateSink: CandidateSink | undefined;
export const setCandidateSink = (f?: CandidateSink) => { candidateSink = f; };

export function peekCoverCandidate(book: { title?: string; author?: string }): string {
  const saved = cache.get(coverKey(book));
  const best = saved ? rankCandidates(saved).find(c => !c.foreign) : undefined;
  return best ? (best.source === 'openlibrary' ? best.url.replace(/-L\.jpg/, '-M.jpg') : best.url) : '';
}

export function loadCoverCandidates(book: Pick<Book, 'title' | 'author' | 'id' | 'identity' | 'coverId'>, onUpdate: (list: CoverCandidate[]) => void, signal?: AbortSignal, opts: { fast?: boolean } = {}): Promise<CoverCandidate[]> {
  const key = coverKey(book);
  const saved = cache.get(key);
  if (saved) {
    if (!signal?.aborted) onUpdate([...saved]);
    return Promise.resolve([...saved]);
  }
  const fast = !!opts.fast;
  const runKey = key + (fast ? '|fast' : '');
  // A full run already going answers a fast request too
  const run = runs.get(key) || (fast ? runs.get(runKey) : undefined) || startRun(book, key, fast);
  const sub = (list: CoverCandidate[]) => { if (!signal?.aborted) onUpdate(list); };
  run.subs.add(sub);
  if (run.found.length) sub([...run.found]);
  return run.done.finally(() => { run.subs.delete(sub); });
}
