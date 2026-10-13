import type { Book } from '../../types';
import { persistentCache } from './cache';
import { COVER_SOURCE_LABEL, type CoverSource } from './coverPicks';
import { coverKey } from './covers';
import { transientFailureCount } from './http';
import { identityOf, isUnknownAuthor, primaryAuthor } from './identity';
import { findApple } from './sources/appleBooks';
import { findGoogle, googleVolume } from './sources/googleBooks';
import { findOpenLibrary, olCoverById, openLibraryEditionCovers } from './sources/openLibrary';

/**
 * The covers a book has, for the cover viewer: the same source functions the cover resolver uses, but collecting every cover instead of
 * stopping at the first. Each source answers on its own and its covers are handed over as they arrive, so the viewer opens at once and
 * fills in. Open Library's edition cover ids and the covers the APIs return are trusted as given (the viewer drops one that fails to load),
 * so no image is probed up front.
 *
 * Requests happen once per book: callers asking while a lookup runs share it, and a finished lookup is remembered on this device for a week
 * (a lookup disturbed by a network failure is not remembered). Nothing is fetched for a book nobody opened.
 */

export type CoverCandidate = { url: string; source: CoverSource };
export const coverSourceLabel = (s: CoverSource): string => COVER_SOURCE_LABEL[s];

const MAX_CANDIDATES = 14;
const MAX_OL = 8;

/** One key per picture, whatever its size: the same Apple art at 200x300 and 600x900, or the same Open Library cover as S / M / L, is one cover. */
export function imageKey(url: string): string {
  try {
    const u = new URL(url);
    if (/(^|\.)(openlibrary\.org|archive\.org)$/.test(u.hostname)) return `${u.hostname}${u.pathname.replace(/-[SML]\.jpg$/, '')}`;
    if (/(^|\.)mzstatic\.com$/.test(u.hostname)) return `${u.hostname}${u.pathname.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/art')}`;
    const q = [...u.searchParams].filter(([k]) => k !== 'zoom' && k !== 'edge' && k !== 'imgtk').map(kv => kv.join('=')).join('&');
    return `${u.hostname}${u.pathname}?${q}`;
  } catch {
    return url;
  }
}

type Finder = (b: Pick<Book, 'title' | 'author' | 'id' | 'identity' | 'coverId'>, author: string) => Promise<CoverCandidate[]>;

const fromApple: Finder = async (b, author) => {
  const hit = await findApple({ title: b.title, author });
  return hit?.book.coverUrl ? [{ url: hit.book.coverUrl, source: 'apple' }] : [];
};

const fromGoogle: Finder = async (b, author) => {
  const id = identityOf(b);
  let hit = id.gbVolume ? await googleVolume(id.gbVolume) : null; // the exact edition when we know it
  if (!hit?.book.coverUrl) hit = await findGoogle({ title: b.title, author, isbn: id.isbn13 || id.isbn10 }, {}, ['cover']);
  return hit?.book.coverUrl ? [{ url: hit.book.coverUrl, source: 'google' }] : [];
};

const fromOpenLibrary: Finder = async (b, author) => {
  const id = identityOf(b);
  let work = id.olWork;
  let first = b.coverId && b.coverId > 0 ? b.coverId : undefined;
  if (!work) {
    const hit = await findOpenLibrary({ title: b.title, author, isbn: id.isbn13 || id.isbn10 });
    work = hit?.book.identity?.olWork;
    first = first ?? hit?.book.coverId;
  }
  const editions = work ? await openLibraryEditionCovers(work, MAX_OL) : [];
  const ids = [...(first ? [first] : []), ...editions].filter((n, i, a) => a.indexOf(n) === i).slice(0, MAX_OL);
  return ids.map(n => ({ url: olCoverById(n, 'L'), source: 'openlibrary' as const }));
};

type Run = { found: CoverCandidate[]; subs: Set<(list: CoverCandidate[]) => void>; done: Promise<CoverCandidate[]> };
const runs = new Map<string, Run>();
const cache = persistentCache<CoverCandidate[]>('readlife.coverCands1', {
  ttl: 7 * 24 * 60 * 60 * 1000,
  max: 40,
  validate: v => Array.isArray(v) && v.every(c => c && typeof c.url === 'string' && /^https:\/\//.test(c.url) && typeof c.source === 'string'),
});

function startRun(book: Pick<Book, 'title' | 'author' | 'id' | 'identity' | 'coverId'>, key: string): Run {
  const author = isUnknownAuthor(book.author) ? '' : primaryAuthor(book.author);
  const trouble = transientFailureCount();
  const run: Run = { found: [], subs: new Set(), done: Promise.resolve([]) };
  const add = (list: CoverCandidate[]) => {
    let changed = false;
    for (const c of list) {
      if (run.found.length >= MAX_CANDIDATES) break;
      if (!run.found.some(f => imageKey(f.url) === imageKey(c.url))) { run.found.push(c); changed = true; }
    }
    if (changed) run.subs.forEach(s => s([...run.found]));
  };
  // The three sources are asked together; a source that fails or finds nothing only means fewer covers
  run.done = Promise.all([fromApple, fromGoogle, fromOpenLibrary].map(f => f(book, author).then(add, () => {})))
    .then(() => {
      // A lookup that was disturbed by a network failure is not remembered as "this book has these covers"
      if (transientFailureCount() === trouble) cache.set(key, run.found);
      return run.found;
    })
    .finally(() => { runs.delete(key); });
  runs.set(key, run);
  return run;
}

/**
 * Hand `onUpdate` the covers found so far, again each time more arrive (the list only ever grows, in a stable order). Resolves with the
 * final list. `signal` only stops the callbacks: a lookup other callers share keeps running and is remembered.
 */
export function loadCoverCandidates(book: Pick<Book, 'title' | 'author' | 'id' | 'identity' | 'coverId'>, onUpdate: (list: CoverCandidate[]) => void, signal?: AbortSignal): Promise<CoverCandidate[]> {
  const key = coverKey(book);
  const saved = cache.get(key);
  if (saved) {
    if (!signal?.aborted) onUpdate([...saved]);
    return Promise.resolve([...saved]);
  }
  const run = runs.get(key) || startRun(book, key);
  const sub = (list: CoverCandidate[]) => { if (!signal?.aborted) onUpdate(list); };
  run.subs.add(sub);
  if (run.found.length) sub([...run.found]);
  return run.done.finally(() => { run.subs.delete(sub); });
}
