import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Book } from '../types';
import type { ShelfSource } from '../services/store/shelves';
import { CoverFace, RatingLine, AwardBadges } from './BookMeta';
import { rememberHonor } from '../services/store/honors';
import { withKnownRating } from '../services/books';
import { DEFAULT_BOOKS } from '../data/defaultBooks';
import { milestone } from '../services/books/perf';
import { enrichInBackground } from '../services/books/infoQueue';

/** Every shelf gets the SAME pool array for the same `known` list, so the rating index (built once per array) is shared by all of them. */
const pools = new WeakMap<Book[], Book[]>();
const poolFor = (known?: Book[]): Book[] => {
  if (!known) return DEFAULT_BOOKS;
  let pool = pools.get(known);
  if (!pool) { pool = [...DEFAULT_BOOKS, ...known]; pools.set(known, pool); }
  return pool;
};

interface Props {
  id: string;
  title: React.ReactNode;
  /** Where the books come from (a curated list, the NYT list, Trending...). The shelf does not care which. */
  source?: ShelfSource;
  /** A ready-made list (e.g. prize winners from your own catalog): no loading at all */
  books?: Book[];
  /** Show 1, 2, 3... on the covers (the order is the source's ranking) */
  ranked?: boolean;
  /** Only start loading when the shelf is about to scroll into view (long lists of curated shelves) */
  lazy?: boolean;
  /** Draw nothing (instead of an error box) when the source can't load: for optional shelves such as the extra NYT lists */
  hideIfUnavailable?: boolean;
  /** Books you already have: when a shelf book is the same book as one of these, it shows that book's rating (average + count together) */
  known?: Book[];
  /** One of the first shelves on the page: its first covers load at once. Every other shelf's covers load as they come near the screen. */
  priority?: boolean;
  /** What you have done with a book ("Reading · page 120 of 300", "Finished Oct 3, 2026", your own stars); nothing for books you have not touched */
  mine?: (b: Book) => string | undefined;
  onOpen: (b: Book) => void;
}

/** Is `b` the shelf already drawn (same books, covers and ratings)? Then it is kept as it is, and nothing is drawn twice. */
const sameShelf = (a: Book[], b: Book[]): boolean =>
  a === b || (a.length === b.length && a.every((x, i) => x === b[i] || (x.id === b[i].id && x.title === b[i].title && x.coverId === b[i].coverId && x.coverUrl === b[i].coverUrl && x.ratingAverage === b[i].ratingAverage && x.ratingCount === b[i].ratingCount)));

/** Same card shape as a real one, so a shelf that has not drawn its books yet holds the height they will take (no jump when they appear). Static: nothing animates off-screen. */
function ShelfSkeleton({ pulse }: { pulse: boolean }) {
  return (
    <div className="flex gap-4 overflow-hidden pb-3" aria-busy="true">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="w-[125px] sm:w-[140px] shrink-0 flex flex-col gap-1.5">
          <div className={`w-full h-[180px] sm:h-[200px] rounded-md bg-[#e3d7c3]/60 dark:bg-[#382f25]/60 ${pulse ? 'animate-pulse' : ''}`} />
          <div className="h-3 w-4/5 rounded bg-[#e3d7c3]/40 dark:bg-[#382f25]/40" />
          <div className="h-3 w-3/5 rounded bg-[#e3d7c3]/40 dark:bg-[#382f25]/40" />
          <div className="h-3 w-2/5 rounded bg-[#e3d7c3]/40 dark:bg-[#382f25]/40" />
        </div>
      ))}
    </div>
  );
}

/** One horizontally scrolling store shelf, fed by a ShelfSource. */
export const StoreShelf = React.memo(function StoreShelf({ id, title, source, books: fixedBooks, ranked, lazy, hideIfUnavailable, known, priority, mine, onOpen }: Props) {
  const [loaded, setLoaded] = useState<Book[] | null>(() => (fixedBooks || !source || lazy ? null : source.cached()));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0); // "Try again" reloads the shelf
  const [visible, setVisible] = useState(!lazy);
  const holder = useRef<HTMLDivElement>(null);
  // A shelf that waits to scroll into view reads its saved books only then (its first draw is a cheap skeleton, not a row of covers)
  const saved = useMemo(() => (!fixedBooks && source && lazy && visible ? source.cached() : null), [fixedBooks, source, lazy, visible]);
  const raw = fixedBooks ?? loaded ?? saved;
  const shown = useRef<Book[] | null>(null);
  shown.current = raw ?? null;
  // The same book must show the same rating on every screen: reuse the one you already have (ratings policy, step 1)
  const pool = useMemo(() => poolFor(known), [known]);
  const books = useMemo(() => (raw ? raw.map(b => withKnownRating(b, pool)) : raw), [raw, pool]);

  useEffect(() => {
    if (fixedBooks || !lazy || visible) return;
    const el = holder.current;
    if (!el || !('IntersectionObserver' in window)) { setVisible(true); return; }
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '700px' });
    io.observe(el);
    return () => io.disconnect();
  }, [fixedBooks, lazy, visible]);

  useEffect(() => {
    if (fixedBooks || !visible || !source) return;
    let live = true;
    setFailed(false);
    // A shelf reports after EVERY book it resolves; drawing the whole shelf each time is wasted work, so the newest list is drawn at most every 100 ms
    let latest: Book[] | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const draw = (b: Book[]) => {
      latest = b;
      if (timer) return;
      timer = setTimeout(() => { timer = undefined; if (live && latest) setLoaded(latest); }, 100);
    };
    source.load(b => live && draw(b))
      // The answer replaces what was drawn first (a saved list shown while this loaded), unless a newer update already arrived
      .then(b => { if (live && !latest) setLoaded(prev => { const cur = prev ?? shown.current; return cur && sameShelf(cur, b) ? prev ?? cur : b; }); })
      // A failed refresh never takes away a list that is already on screen
      .catch(() => { if (live && !shown.current) setFailed(true); });
    return () => { live = false; clearTimeout(timer); };
  }, [id, visible, source, fixedBooks, attempt]);

  useEffect(() => { if (raw) milestone('store-first-shelf'); }, [raw]); // measurement only

  // A shelf on screen: its books get their missing Book Info in the background, ahead of books nobody is looking at (services/books/infoQueue.ts)
  useEffect(() => { if (visible && raw?.length) enrichInBackground(raw, 0); }, [raw, visible]);

  // Honors & Awards: remember what each shelf calls its books, so the book info can list them all (see services/store/honors.ts)
  useEffect(() => { if (!fixedBooks) (loaded ?? saved)?.forEach(rememberHonor); }, [loaded, saved, fixedBooks]);

  if (fixedBooks && fixedBooks.length === 0) return null;
  if (failed && hideIfUnavailable) return null;

  return (
    <div ref={holder} data-shelf-id={id} className="rl-shelf flex flex-col gap-3 scroll-mt-16">
      <h3 className="font-serif-display text-xl text-[#201a15] dark:text-[#f0e6d6] flex items-center gap-2">{source?.label?.() ?? title}</h3>
      {failed ? (
        <div className="flex items-center gap-3 flex-wrap text-sm text-[#706256] dark:text-[#a89a8a]">
          <p>Couldn't load this shelf. The store needs an internet connection.</p>
          <button type="button" onClick={() => setAttempt(n => n + 1)} className="px-3 py-1 rounded-lg text-xs font-semibold border border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17] text-[#2e5934] dark:text-[#86b880] active:scale-95 transition-all">
            Try again
          </button>
        </div>
      ) : !books ? (
        <ShelfSkeleton pulse={visible} />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-3 no-scrollbar">
          {books.map((b, i) => (
            <div key={`${b.id}|${b.title}`} className="w-[125px] sm:w-[140px] shrink-0 flex flex-col gap-1.5">
              <div className="relative">
                {ranked && (
                  <span className="absolute top-2 left-2 z-30 px-2 py-0.5 rounded-md text-xs font-bold bg-[#fbf7ee] dark:bg-[#231d17] text-[#201a15] dark:text-[#f0e6d6] shadow">
                    {i + 1}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onOpen(b)}
                  className="book-cover-3d w-full h-[180px] sm:h-[200px] text-left p-3 flex flex-col justify-between text-white overflow-hidden"
                  style={{ backgroundColor: b.spineColor || '#6b6f80' }}
                  aria-label={`${b.title} by ${b.author}`}
                >
                  <CoverFace book={b} size="md" eager={!!priority && i < 4} />
                </button>
              </div>
              {/* Title, author and rating lines have a fixed height so cards line up; the honors below are shown in full (never cut off) */}
              <h4 className="font-serif-display text-xs sm:text-sm font-semibold leading-tight line-clamp-2 min-h-[2.5em]">
                <button type="button" onClick={() => onOpen(b)} className="text-left hover:underline focus-visible:underline focus:outline-none">
                  {b.title}
                </button>
              </h4>
              <p className="text-[11px] leading-4 h-4 text-[#706256] dark:text-[#a89a8a] truncate">{b.author}</p>
              <div className="h-4"><RatingLine book={b} compact /></div>
              <AwardBadges book={b} />
              {/* One short chip (Reading now, In My Library, Finished...), on one line, below the honors: the reading page / dates live in the library, not on a shelf card */}
              {mine?.(b) && <span className="self-start max-w-full truncate px-2 py-0.5 rounded-full text-[10px] leading-4 font-semibold bg-[#2e5934]/10 text-[#2e5934] dark:bg-[#86b880]/15 dark:text-[#86b880]">{mine(b)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
