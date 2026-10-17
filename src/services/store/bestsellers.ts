import type { Book } from '../../types';
import { mapPool } from '../books/http';
import { persistentCache } from '../books/cache';
import { CONTENT_FILTER_VERSION, filterEligible } from '../books/eligibility';
import { resolveBook } from '../books/resolve';
import { NYT_FAILURE_TEXT, lastNytFailure, loadNytList } from '../books/sources/nyt';
import { enrichPool, gatherPool, rankPool } from './collate';
import { NYT_EXTRA_SHELVES, NYT_SHELVES, type NytShelf } from './lists';
import { combineWithNyt, nytEntryToBook, nytLabel } from './nytBooks';
import type { RefreshResult, ShelfSource } from './shelves';

export { NYT_SHELVES, NYT_EXTRA_SHELVES, type NytShelf, combineWithNyt, nytEntryToBook, nytLabel };

/**
 * "Top 15 this week".
 *
 * OFFICIAL: when the New York Times list can be loaded it is the authority. The NYT decides WHICH books and in WHAT ORDER;
 * nothing downstream can reorder or drop an entry. Each entry's ISBN pins the exact edition so details and cover are accurate.
 *
 * FALLBACK: when the NYT list cannot be loaded (not configured, rate-limited, offline...) the shelf does not disappear. It becomes
 * a GreatReads-collated Top 15 for the same kind of books (fiction or non-fiction), built only from signals Open Library, Apple
 * Books and Google Books really provide (see collate.ts), and says so in its heading: "GreatReads · Top 15 this week · Fiction".
 * It is NOT presented as an official chart. The NYT is tried again on the next load after a short time, and wins whenever it answers.
 */

type Mode = 'nyt' | 'collated';
interface Saved { mode: Mode; books: Book[]; at: number; /** content-filter version a GreatReads-collated list was built under (see books/eligibility.ts); absent on lists saved before it existed */ v?: number }

/** An official list is good for 6 hours (the NYT publishes weekly); the fallback only 20 minutes, so the official list returns soon after the NYT does. */
export const FRESH_MS: Record<Mode, number> = { nyt: 6 * 60 * 60 * 1000, collated: 20 * 60 * 1000 };
/** How old a saved list may be and still be drawn at once while a fresh one is requested. The NYT publishes weekly; the collated fallback changes faster. */
export const SHOW_STALE_MS: Record<Mode, number> = { nyt: 10 * 24 * 60 * 60 * 1000, collated: 3 * 24 * 60 * 60 * 1000 };
const saved = persistentCache<Saved>('readlife.top15', { ttl: 14 * 24 * 60 * 60 * 1000, max: 10 });

/** The heading for a shelf: the official title, or marked as GreatReads' own when it is the collated fallback. */
export const shelfHeading = (shelf: Pick<NytShelf, 'title'>, mode: Mode | null) => (mode === 'collated' ? `GreatReads · ${shelf.title}` : shelf.title);

const refining = new Set<string>();

/**
 * The saved list for a shelf, safe to draw. The official NYT list is returned exactly as saved (the NYT decides which books, nothing
 * downstream drops one). A GreatReads-collated fallback list is a discovery list, so it is held to the content-eligibility rules:
 * one saved before they existed (no version, or an older one) is not trusted, and any book judged ineligible since is taken out.
 */
function savedList(id: string): Saved | undefined {
  const s = saved.get(id);
  if (!s || s.mode !== 'collated') return s;
  if (s.v !== CONTENT_FILTER_VERSION) return undefined;
  const books = filterEligible(s.books);
  return books.length ? (books === s.books ? s : { ...s, books }) : undefined;
}

export function bestsellerSource(shelf: NytShelf): ShelfSource {
  let mode: Mode | null = null;
  /** `at` is when the LIST was fetched; improving its covers afterwards passes the original time, so "last updated" does not creep forward. */
  const remember = (m: Mode, books: Book[], at = Date.now()) => {
    mode = m;
    saved.set(shelf.id, { mode: m, books, at, ...(m === 'collated' ? { v: CONTENT_FILTER_VERSION } : {}) });
  };

  /** The official NYT path. Slot i stays slot i: the rank never moves. */
  async function official(entries: NonNullable<Awaited<ReturnType<typeof loadNytList>>['entries']>, onUpdate: (b: Book[]) => void): Promise<Book[]> {
    const top = entries.slice(0, shelf.limit ?? 15);
    const provisional = top.map(e => nytEntryToBook(e, shelf.genre));
    const fetchedAt = Date.now();
    remember('nyt', provisional, fetchedAt);
    if (!refining.has(shelf.id)) {
      refining.add(shelf.id);
      void (async () => {
        try {
          const out = [...provisional];
          await mapPool(top, 3, async (e, i) => {
            const r = await resolveBook({ title: e.title, author: e.author, isbn: e.isbn13 || e.isbn10, fallbackId: provisional[i].id, genreHint: shelf.genre, apple: true });
            out[i] = combineWithNyt(provisional[i], r?.book ?? null);
            onUpdate([...out]);
          });
          if (mode === 'nyt') remember('nyt', out, fetchedAt);
        } finally {
          refining.delete(shelf.id);
        }
      })();
    }
    return provisional;
  }

  /** The GreatReads-collated list for this kind of book. Shows what it has at once, then improves as lookups finish. */
  async function collated(onUpdate: (b: Book[]) => void): Promise<Book[] | null> {
    const pool = await gatherPool();
    if (!pool) return null;
    const first = rankPool(pool, { limit: 15, kind: shelf.kind }).map(r => r.book);
    const publish = () => {
      const books = rankPool(pool, { limit: 15, kind: shelf.kind }).map(r => r.book);
      if (books.length && mode === 'collated') { remember('collated', books); onUpdate(books); }
    };
    if (first.length) remember('collated', first);
    // Looking candidates up is what tells fiction from non-fiction when a source gave no category, so it runs even when `first` is thin
    const work = enrichPool(pool, { kind: shelf.kind, max: 30, onProgress: publish }).then(publish);
    if (!first.length) {
      await work;
      const after = rankPool(pool, { limit: 15, kind: shelf.kind }).map(r => r.book);
      if (!after.length) return null;
      remember('collated', after);
      return after;
    }
    void work;
    return first;
  }

  return {
    id: shelf.id,
    label: () => shelfHeading(shelf, mode),
    info: () => {
      const s = savedList(shelf.id);
      const m = s?.mode ?? mode;
      const failed = lastNytFailure(shelf.list);
      const why = failed && (!s || s.mode !== 'nyt') ? ` · not loading right now: ${NYT_FAILURE_TEXT[failed]}` : '';
      return {
        updatedAt: s?.at,
        schedule: shelf.schedule ?? 'NYT publishes weekly · checked every 6 hours when opened',
        source: (m === 'collated' ? 'GreatReads fallback (the NYT list could not be loaded), not an official list' : 'The New York Times Books API (official)') + why,
        kind: m === 'collated' ? 'generated' : 'official',
      };
    },
    // Manual refresh: ask the NYT again now (the saved list stays as the fallback). Only the official list counts as a success.
    refresh: async (): Promise<RefreshResult> => {
      const before = savedList(shelf.id);
      const nyt = await loadNytList(shelf.list, { force: true });
      if (!nyt.entries?.length || nyt.stale) return 'failed';
      const books = await official(nyt.entries, () => {});
      const key = (bs: Book[]) => bs.map(b => `${b.title}|${b.author}`).join('~');
      return before?.mode === 'nyt' && key(before.books) === key(books) ? 'unchanged' : 'updated';
    },
    // Instant: the last list shown, even when it is due for a refresh (load() below asks again and the shelf swaps in the answer).
    // Before, a list older than 6 hours (20 minutes for the fallback) drew an empty skeleton until the network answered.
    cached: () => {
      const s = savedList(shelf.id);
      if (!s || !s.books.length || Date.now() - s.at > SHOW_STALE_MS[s.mode]) return null;
      mode = s.mode;
      return s.books;
    },
    load: async onUpdate => {
      const s = savedList(shelf.id);
      if (s && s.books.length && Date.now() - s.at <= FRESH_MS[s.mode]) { mode = s.mode; return s.books; }

      // 1. the official list (a list saved up to 10 days ago still counts when a refresh fails: the NYT publishes weekly)
      const nyt = await loadNytList(shelf.list);
      if (nyt.entries?.length) return official(nyt.entries, onUpdate);

      // 2. GreatReads' own collated list, labelled as such (not for the niche lists, which are official-or-nothing)
      if (shelf.fallback !== false) {
        const own = await collated(onUpdate);
        if (own?.length) return own;
      }

      // 3. nothing answered at all: show the last thing we showed, if we have one, instead of an empty error
      if (s?.books.length) { mode = s.mode; return s.books; }
      throw new Error('Top 15 unavailable');
    },
  };
}
