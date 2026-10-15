import React, { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { Book } from '../types';
import { BOOK_AWARDS } from '../data/defaultBooks';
import { honorKind, mergeHonors } from '../services/store/honors';
import { externalRating, ratingOf, starFills } from '../services/books';
import { placeholderStyleFor, titleSizeCqw, isFrontCoverShape } from '../services/books/placeholderCover';
import { coverKey, getCoverUrl, resolveCover, subscribeCovers, getCoversVersion, getCoverFix, dropCoverFix, reportMissingCover, clearMissingCover, getCoverPickInfo, pickSizedUrl, markCoverPickFailed } from '../services/books';

export type AwardKind = 'w' | 's' | 'c'; // winner, shortlist, other pick (book club, series...)

/** Prize wins get a trophy, shortlists a medal, and anything else (e.g. "Service95 Pick") a plain book badge. */
export const awardsFor = (b: Book): { type: AwardKind; label: string }[] => {
  const base: { type: AwardKind; label: string }[] = typeof b.id === 'number' ? BOOK_AWARDS[b.id] || [] : [];
  if (!b.awardLabel) return base;
  return [...base, { type: honorKind(b.awardLabel), label: b.awardLabel }];
};

/** For the book info (Honors & Awards): everything awardsFor shows plus every other label shelves have given this book, so a book club pick that also won a prize lists both. Not used on the Store covers. */
export const honorsListFor = (b: Book): { type: AwardKind; label: string }[] => mergeHonors(awardsFor(b), b);

/** Five stars, each filled by exactly its share of the rating: 4.0 is four full stars, 4.5 four and a half, 3.2 three full, one filled 20%, one empty. */
export function StarRating({ value, className = '' }: { value: number; className?: string }) {
  return (
    <span className={`inline-flex gap-px leading-none ${className}`} role="img" aria-label={`${value.toFixed(1)} out of 5 stars`}>
      {starFills(value).map((fill, i) => (
        <span key={i} aria-hidden="true" className="relative inline-block">
          <span style={{ color: '#d9a441', opacity: 0.28 }}>★</span>
          {fill > 0 && (
            <span className="absolute left-0 top-0 overflow-hidden whitespace-nowrap" style={{ width: `${fill * 100}%`, color: '#d9a441' }}>★</span>
          )}
        </span>
      ))}
    </span>
  );
}

export const compactCount = (n?: number) => (!n ? '' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/**
 * Stars + average + count (renders nothing without a rating). The stars are the same fractional StarRating the book info uses, so 4.3 and 3.7
 * are drawn as 4.3 and 3.7, never rounded. A rating that carries a source is an outside site's pair and must be valid (average 1-5 with its own
 * count); the library's own ratings (no source) only need an average.
 */
export function RatingLine({ book, className = '', compact = false }: { book: Book; className?: string; compact?: boolean }) {
  const r = book.ratingSource && book.ratingSource !== 'library' ? externalRating(book) : ratingOf(book);
  if (!r) return null;
  return (
    <div className={`flex items-center gap-1 text-xs text-[#706256] dark:text-[#a89a8a] ${className}`}>
      <StarRating value={r.average} />
      <span>
        {r.average.toFixed(1)}
        {r.count ? ` · ${compactCount(r.count)}${compact ? '' : ' ratings'}` : ''}
      </span>
    </div>
  );
}

/** Prize / shortlist chips, e.g. 🏆 Women's Prize 2021 */
export function AwardBadges({ book }: { book: Book }) {
  const a = awardsFor(book);
  if (!a.length) return null;
  return (
    <div className="rl-bdgs">
      {a.map((x, i) => (
        <span key={i} className={`rl-bdg ${x.type === 'w' ? 'rl-bdg-w' : x.type === 'c' ? 'rl-bdg-c' : ''}`}>
          {x.type === 'c' ? '📖' : x.type === 'w' ? '🏆' : '🎖️'} {x.label}
        </span>
      ))}
    </div>
  );
}

/** Author line size per cover size (title size is set from the cover's own width, see PlaceholderCover). */
const AUTHOR_CQW: Record<string, number> = { xs: 9.5, nook: 0, md: 9, lg: 8.5, xl: 8 };

/**
 * The stand-in cover: flat colour, the whole title in bold white, the author in black (Apple Books style). Sizes use container
 * query units, so one rule fits the tiny nook spines and the large detail cover alike; a long title simply gets smaller type.
 */
function PlaceholderCover({ book, size }: { book: Book; size: keyof typeof AUTHOR_CQW }) {
  const st = placeholderStyleFor(book);
  const author = AUTHOR_CQW[size] ?? 7;
  const showAuthor = author > 0 && !!book.author && !/^unknown/i.test(book.author);
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col justify-between pointer-events-none select-none overflow-hidden"
      style={{
        containerType: 'size',
        background: `linear-gradient(180deg, ${st.bg} 0%, ${st.bg} 55%, ${st.shade} 100%)`,
        padding: '9cqw 9cqw 8cqw',
      }}
      aria-hidden="true"
    >
      <b
        style={{
          fontFamily: '"SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif',
          fontWeight: 800,
          color: '#fff',
          fontSize: `${titleSizeCqw(book.title)}cqw`,
          lineHeight: 1.08,
          letterSpacing: '-0.01em',
          overflowWrap: 'anywhere',
          textShadow: '0 1px 2px rgba(0,0,0,.18)',
        }}
      >
        {book.title}
      </b>
      {showAuthor ? (
        <span
          style={{
            fontWeight: 600,
            color: '#000',
            opacity: 0.85,
            fontSize: `${author}cqw`,
            lineHeight: 1.2,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            overflowWrap: 'anywhere',
          }}
        >
          {book.author}
        </span>
      ) : <span />}
    </div>
  );
}

// URLs that have already loaded once on this device. Used only to skip the fade-in for covers that appear instantly.
// (Kept apart from 'readlife.preload', the short list index.html starts loading before the app code runs.)
const LOADED_KEY = 'readlife.loaded';
const loadedCovers = new Set<string>((() => {
  try {
    const saved = JSON.parse(localStorage.getItem(LOADED_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
})());

let saveLoadedTimer: ReturnType<typeof setTimeout> | undefined;
function recordLoadedCover(url: string) {
  if (!url || loadedCovers.has(url)) return;
  loadedCovers.add(url);
  // Many covers load in a burst: write the list once, a moment later
  clearTimeout(saveLoadedTimer);
  saveLoadedTimer = setTimeout(() => {
    try {
      localStorage.setItem(LOADED_KEY, JSON.stringify(Array.from(loadedCovers).slice(-300)));
    } catch {}
  }, 1500);
}

/**
 * Cover contents. The real cover image is shown on its own; the title/author text
 * appears gracefully as the book jacket while loading or when no cover exists.
 */
type CoverFaceProps = { book: Book; size?: 'xs' | 'nook' | 'md' | 'lg' | 'xl'; imgSize?: 'S' | 'M' | 'L'; badge?: boolean; eager?: boolean };

/**
 * Cover state belongs to one book. Keying the inner component ensures that when a different book takes a reused shelf slot,
 * retries and replacement covers from the previous book are discarded.
 */
export const CoverFace = React.memo(function CoverFace(props: CoverFaceProps) {
  return <CoverFaceFor key={coverKey(props.book)} {...props} />;
});

function CoverFaceFor({ book, size = 'md', imgSize = 'M', badge = true, eager = false }: CoverFaceProps) {
  // Re-render when "Reload missing covers" repairs one or a cover is picked in the cover viewer. A picked cover wins over a repaired one, which wins over the original link
  useSyncExternalStore(subscribeCovers, getCoversVersion, getCoversVersion);
  const pick = getCoverPickInfo(book);
  const baseUrl = pick ? pickSizedUrl(pick.url, imgSize) : getCoverFix(book) || getCoverUrl(book.coverId, imgSize, book.coverUrl);
  type St = { base: string; tries: number; alt: string; dead: boolean };
  const [st, setSt] = useState<St>({ base: baseUrl, tries: 0, alt: '', dead: false });
  const cur: St = st.base === baseUrl ? st : { base: baseUrl, tries: 0, alt: '', dead: false };

  // Retry twice (cache-busted), then look for the same book's cover on Apple / Google Books
  const src = cur.alt || (cur.tries > 0 && baseUrl ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}r=${cur.tries}` : baseUrl);
  const [imgLoaded, setImgLoaded] = useState(() => (src ? loadedCovers.has(src) : false));

  useEffect(() => {
    if (src && loadedCovers.has(src)) {
      setImgLoaded(true);
    }
  }, [src]);

  // A cover the browser already has (HTTP cache) is complete the moment the <img> exists: show it straight away instead of
  // flashing the title placeholder first. (onLoad can fire before React attaches it, or not at all for cached images.)
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const im = imgRef.current;
    if (im && im.complete && im.naturalWidth >= 8 && (pick || isFrontCoverShape(im.naturalWidth, im.naturalHeight))) {
      recordLoadedCover(src);
      setImgLoaded(true);
    }
  }, [src]);

  const giveUp = () => {
    resolveCover(book).then(u => setSt(u ? { ...cur, alt: u } : { ...cur, dead: true }));
  };
  useEffect(() => {
    if (!baseUrl && !cur.alt && !cur.dead) giveUp();
  }, [baseUrl, book.title]);

  // Every attempt failed: tell the "Reload missing covers" button
  useEffect(() => {
    if (!cur.dead) return;
    if (getCoverFix(book)) dropCoverFix(book); // a repaired cover that broke: forget it, then it can be repaired again
    else reportMissingCover(book);
  }, [cur.dead, book.title, book.author]);

  const onErr = () => {
    if (cur.alt) return setSt({ ...cur, dead: true });
    if (cur.tries < 2 && baseUrl) {
      setTimeout(() => setSt(p => (p.base === baseUrl ? { ...p, tries: cur.tries + 1 } : p)), 700 * (cur.tries + 1));
      return;
    }
    if (pick) return markCoverPickFailed(book); // a picked cover that will not load: the normal cover shows (the pick is kept)
    giveUp();
  };

  // Loaded fine but is a spine / back / photographed book: no retries (the same picture would come back), look for a flat front cover
  const onWrongShape = () => {
    if (cur.alt) return setSt({ ...cur, dead: true });
    giveUp();
  };

  const url = src;
  const failed = cur.dead;
  const won = awardsFor(book).some(a => a.type === 'w');
  const isEager = eager || size === 'lg' || size === 'xl';
  const wasKnown = url ? loadedCovers.has(url) : false; // seen before on this device: appears with no fade
  const isReady = wasKnown || imgLoaded;

  return (
    <>
      {url && !failed ? (
        <img
          key={url}
          ref={imgRef}
          src={url}
          alt=""
          loading={isEager ? 'eager' : 'lazy'}
          fetchPriority={isEager ? 'high' : undefined}
          decoding="async"
          className={`absolute inset-0 w-full h-full object-cover z-20 ${wasKnown ? '' : 'transition-opacity duration-150'} ${isReady ? 'opacity-100' : 'opacity-0'}`}
          referrerPolicy="no-referrer"
          onLoad={e => {
            // A 1x1 placeholder counts as a failure; a real image clears any earlier miss
            const im = e.currentTarget;
            if (im.naturalWidth > 0 && im.naturalWidth < 8) return onErr();
            // A spine / back / box-set / physical-book photo is not a front cover: look for a flat front-facing one instead
            if (!pick && !isFrontCoverShape(im.naturalWidth, im.naturalHeight)) return onWrongShape();
            recordLoadedCover(url);
            setImgLoaded(true);
            clearMissingCover(book);
          }}
          onError={onErr}
        />
      ) : null}
      {(!url || failed || !isReady) ? <PlaceholderCover book={book} size={size} /> : null}
      {badge && won && size !== 'xs' ? (
        <span className="rl-prize" title="Prize winner" aria-label="Prize winner">🏆</span>
      ) : null}
    </>
  );
}
