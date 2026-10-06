import type { Book } from '../../types';
import { mapPool } from '../books/http';
import { persistentCache } from '../books/cache';
import { resolveBook } from '../books/resolve';
import { loadNytList } from '../books/sources/nyt';
import { enrichPool, gatherPool, rankPool } from './collate';
import { NYT_SHELVES, type NytShelf } from './lists';
import { combineWithNyt, nytEntryToBook, nytLabel } from './nytBooks';
import type { ShelfSource } from './shelves';

export { NYT_SHELVES, type NytShelf, combineWithNyt, nytEntryToBook, nytLabel };

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
interface Saved { mode: Mode; books: Book[]; at: number }

/** An official list is good for 3 hours; the fallback only 20 minutes, so the official list returns soon after the NYT does. */
export const FRESH_MS: Record<Mode, number> = { nyt: 3 * 60 * 60 * 1000, collated: 20 * 60 * 1000 };
const saved = persistentCache<Saved>('readlife.top15', { ttl: 14 * 24 * 60 * 60 * 1000, max: 4 });

/** The heading for a shelf: the official title, or marked as GreatReads' own when it is the collated fallback. */
export const shelfHeading = (shelf: Pick<NytShelf, 'title'>, mode: Mode | null) => (mode === 'collated' ? `GreatReads · ${shelf.title}` : shelf.title);

const refining = new Set<string>();

export function bestsellerSource(shelf: NytShelf): ShelfSource {
  let mode: Mode | null = null;
  const remember = (m: Mode, books: Book[]) => {
    mode = m;
    saved.set(shelf.id, { mode: m, books, at: Date.now() });
  };

  /** The official NYT path. Slot i stays slot i: the rank never moves. */
  async function official(entries: NonNullable<Awaited<ReturnType<typeof loadNytList>>['entries']>, onUpdate: (b: Book[]) => void): Promise<Book[]> {
    const top = entries.slice(0, 15);
    const provisional = top.map(e => nytEntryToBook(e, shelf.genre));
    remember('nyt', provisional);
    if (!refining.has(shelf.id)) {
      refining.add(shelf.id);
      void (async () => {
        try {
          const out = [...provisional];
          await mapPool(top, 3, async (e, i) => {
            const r = await resolveBook({ title: e.title, author: e.author, isbn: e.isbn13 || e.isbn10, fallbackId: provisional[i].id, genreHint: shelf.genre });
            out[i] = combineWithNyt(provisional[i], r?.book ?? null);
            onUpdate([...out]);
          });
          if (mode === 'nyt') remember('nyt', out);
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
    cached: () => {
      const s = saved.get(shelf.id);
      if (!s || Date.now() - s.at > FRESH_MS[s.mode] || !s.books.length) return null;
      mode = s.mode;
      return s.books;
    },
    load: async onUpdate => {
      const s = saved.get(shelf.id);
      if (s && s.books.length && Date.now() - s.at <= FRESH_MS[s.mode]) { mode = s.mode; return s.books; }

      // 1. the official list (a list saved up to 10 days ago still counts when a refresh fails: the NYT publishes weekly)
      const nyt = await loadNytList(shelf.list);
      if (nyt.entries?.length) return official(nyt.entries, onUpdate);

      // 2. GreatReads' own collated list, labelled as such
      const own = await collated(onUpdate);
      if (own?.length) return own;

      // 3. nothing answered at all: show the last thing we showed, if we have one, instead of an empty error
      if (s?.books.length) { mode = s.mode; return s.books; }
      throw new Error('Top 15 unavailable');
    },
  };
}
