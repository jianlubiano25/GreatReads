import React, { useEffect, useRef, useState } from 'react';
import { Book } from '../types';
import { loadShelf, getCachedShelf, getCachedCurated, seedPlaceholders, resolveCuratedShelf } from '../services/bookSearch';
import { loadTrendingShelf } from '../services/trending';
import type { CuratedShelf } from '../data/storeCatalog';
import { CoverFace, RatingLine, AwardBadges } from './BookMeta';

interface Props {
  id: string;
  title: React.ReactNode;
  url?: string;
  curated?: CuratedShelf;
  /** A ready-made list (e.g. prize winners from your own catalog): no loading at all */
  books?: Book[];
  ranked?: boolean;
  minRatings?: number;
  onOpen: (b: Book) => void;
}

/**
 * One horizontally scrolling store shelf.
 * - books: a ready-made list
 * - curated: titles draw instantly from the built-in list; covers/ratings fill in (and are cached for a week)
 * - url: a live Open Library list (e.g. weekly trending), cached for a few hours; `ranked` lists are re-ranked with Apple/Google data
 */
export const StoreShelf = React.memo(function StoreShelf({ id, title, url, curated, books: fixedBooks, ranked, minRatings, onOpen }: Props) {
  const [loaded, setLoaded] = useState<Book[] | null>(() => {
    if (fixedBooks) return null;
    if (!curated) return getCachedShelf(id);
    const seeded = seedPlaceholders(curated);
    // Fully prefetched shelves need no lookups and no cache at all
    return seeded.every(b => b.coverId || b.coverUrl) ? seeded : getCachedCurated(curated) || seeded;
  });
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(!curated);
  const holder = useRef<HTMLDivElement>(null);
  const books = fixedBooks ?? loaded;

  // Curated shelves only start looking things up when they're about to scroll into view
  useEffect(() => {
    if (fixedBooks || !curated || visible) return;
    const el = holder.current;
    if (!el || !('IntersectionObserver' in window)) { setVisible(true); return; }
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '500px' });
    io.observe(el);
    return () => io.disconnect();
  }, [fixedBooks, curated, visible]);

  useEffect(() => {
    if (fixedBooks || !visible) return;
    let live = true;
    if (curated) {
      resolveCuratedShelf(curated, loaded || seedPlaceholders(curated), b => live && setLoaded(b));
      return () => { live = false; };
    }
    if (!url) return;
    setFailed(false);
    // The ranked shelves (Trending Today, Top 15 this week) use the multi-source pipeline; the rest stay plain Open Library lists
    const load = ranked
      ? loadTrendingShelf(id, url, { limit: 15, onUpdate: b => live && setLoaded(b) })
      : loadShelf(id, url, { limit: 12, minRatings, onUpdate: b => live && setLoaded(b) });
    load
      .then(b => live && setLoaded(prev => (prev === b ? prev : b)))
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [id, url, visible, curated, fixedBooks]);

  if (fixedBooks && fixedBooks.length === 0) return null;

  return (
    <div ref={holder} className="flex flex-col gap-3">
      <h3 className="font-serif-display text-xl text-[#201a15] dark:text-[#f0e6d6] flex items-center gap-2">{title}</h3>
      {failed ? (
        <p className="text-sm text-[#706256] dark:text-[#a89a8a]">Couldn't load this shelf. The store needs an internet connection.</p>
      ) : !books ? (
        <div className="flex gap-4 overflow-hidden" aria-busy="true">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="w-[125px] sm:w-[140px] h-[180px] sm:h-[200px] shrink-0 rounded-md bg-[#e3d7c3]/60 dark:bg-[#382f25]/60 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-3 no-scrollbar">
          {books.map((b, i) => (
            <div key={b.id} className="w-[125px] sm:w-[140px] shrink-0 flex flex-col gap-1.5">
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
                  <CoverFace book={b} size="md" eager={i < 6} />
                </button>
              </div>
              <h4 className="font-serif-display text-xs sm:text-sm font-semibold leading-tight line-clamp-2">
                <button type="button" onClick={() => onOpen(b)} className="text-left hover:underline focus-visible:underline focus:outline-none">
                  {b.title}
                </button>
              </h4>
              <p className="text-[11px] text-[#706256] dark:text-[#a89a8a] truncate">{b.author}</p>
              <RatingLine book={b} compact />
              <AwardBadges book={b} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
