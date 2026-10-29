import React, { useCallback, useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { Book } from '../types';
import { BOOK_AWARDS } from '../data/defaultBooks';
import { honorKind, mergeHonors } from '../services/store/honors';
import { externalRating, isNytCoverUrl, ratingOf, starFills } from '../services/books';
import { infoKey, infoVersion, shownRating, subscribeInfo } from '../services/books/infoStore';
import { placeholderStyleFor, titleSizeCqw, isFrontCoverShape } from '../services/books/placeholderCover';
import { inspectCover } from '../services/books/covers';
import { coverKey, ownCoverUrl, sizedCoverUrl, resolveCover, subscribeCovers, getCoversVersion, getCoverFix, dropCoverFix, isCoverSettled, markCoverSettled, reportMissingCover, clearMissingCover, getCoverPickInfo, pickSizedUrl, markCoverPickFailed, peekCoverCandidate } from '../services/books';

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

/** 163204 -> 163.2k, 16000 -> 16k (never "16.0k"), 1,250,000 -> 1.3M (never "1250.0k"), 2,000,000 -> 2M */
export const compactCount = (n?: number) => {
  if (!n) return '';
  if (n < 1000) return String(n);
  const k = Math.round(n / 100) / 10;
  if (k >= 1000) return `${String(Math.round(n / 100000) / 10).replace(/\.0$/, '')}M`;
  return `${String(k).replace(/\.0$/, '')}k`;
};

/**
 * Stars + average + count (renders nothing without a rating). The stars are the same fractional StarRating the book info uses, so 4.3 and 3.7
 * are drawn as 4.3 and 3.7, never rounded. A rating that carries a source is an outside site's pair and must be valid (average 1-5 with its own
 * count); the library's own ratings (no source) only need an average.
 */
export function RatingLine({ book, className = '', compact = false }: { book: Book; className?: string; compact?: boolean }) {
  // The same main rating Book Info shows: once any site's rating is known for this book (saved by a lookup, or shipped with the app), the
  // card follows mainRating (Library -> Apple -> Open Library -> Google) instead of the pair frozen on the card. Re-draws when that entry changes.
  const key = infoKey(book);
  const subscribe = useCallback((fn: () => void) => subscribeInfo(book, fn), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useSyncExternalStore(subscribe, () => infoVersion(book), () => 0);
  const r = shownRating(book) ?? (book.ratingSource && book.ratingSource !== 'library' ? externalRating(book) : ratingOf(book));
  if (!r) return null;
  // One line, always: the stars never wrap and the number text never breaks (even 162.4k fits a 150px shelf card). Compact = the shelf / library card size: the stars stay big and the card
  // is made wide enough for them, rather than shrinking the stars to fit.
  return (
    <div className={`flex flex-nowrap items-center whitespace-nowrap text-[#706256] dark:text-[#a89a8a] ${compact ? 'gap-1 text-[11px] max-w-full' : 'gap-1 text-xs'} ${className}`}>
      <StarRating value={r.average} className={`shrink-0 ${compact ? 'text-xs' : ''}`} />
      <span className="whitespace-nowrap tabular-nums">
        {r.average.toFixed(1)}
        {r.count ? (compact ? `\u2009·\u2009${compactCount(r.count)}` : ` · ${compactCount(r.count)}`) : ''}
      </span>
    </div>
  );
}

/**
 * The ONE honor a book wears on a Store shelf: the label its own shelf gave it (the Booker shelf's "Booker Prize 2025"), otherwise its best
 * honor (a prize win, then a shortlist, then a club pick). The book info (Honors & Awards) lists every one; library cards list all too.
 */
export const primaryAward = (b: Book): { type: AwardKind; label: string } | undefined => {
  if (b.awardLabel?.trim()) return { type: honorKind(b.awardLabel), label: b.awardLabel };
  const rank: Record<AwardKind, number> = { w: 0, s: 1, c: 2 };
  return awardsFor(b).map((x, i) => ({ x, i })).sort((p, q) => rank[p.x.type] - rank[q.x.type] || p.i - q.i)[0]?.x;
};

const chipIcon = (t: AwardKind) => (t === 'c' ? '\u{1F4D6}' : t === 'w' ? '\u{1F3C6}' : '\u{1F396}\uFE0F');
/** "NYT bestseller · 12 weeks" reads "NYT · 12 weeks" on a chip, and "NYT · new this week" in full (never cut: a chip too wide for its card wraps to a second line). The book info keeps the full label. */
export const chipLabel = (label: string): string => label.replace(/^NYT bestseller(?= · )/, 'NYT');
const chipClass = (t: AwardKind) => `rl-bdg ${t === 'w' ? 'rl-bdg-w' : t === 'c' ? 'rl-bdg-c' : ''}`;

/** Prize / shortlist chips, e.g. 🏆 Women's Prize 2021. `primary`: just the one main honor, on one line (Store shelves: every shelf stays the same height). */
export function AwardBadges({ book, primary }: { book: Book; primary?: boolean }) {
  if (primary) {
    const x = primaryAward(book);
    if (!x) return null;
    return (
      <div className="rl-bdgs">
        <span className={`${chipClass(x.type)} block max-w-full`} title={x.label}>{chipIcon(x.type)} {chipLabel(x.label)}</span>
      </div>
    );
  }
  const a = awardsFor(book);
  if (!a.length) return null;
  return (
    <div className="rl-bdgs">
      {a.map((x, i) => (
        <span key={i} className={chipClass(x.type)}>
          {chipIcon(x.type)} {chipLabel(x.label)}
        </span>
      ))}
    </div>
  );
}

/** Author line size per cover size (title size is set from the cover's own width, see PlaceholderCover). */
const AUTHOR_CQW: Record<string, number> = { xs: 11.5, nook: 0, md: 10.8, lg: 10.2, xl: 9.6 }; // about 20% larger than before

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
      className="absolute inset-0 z-10 pointer-events-none select-none overflow-hidden"
      style={{
        containerType: 'size',
        background: `linear-gradient(180deg, ${st.bg} 0%, ${st.bg} 55%, ${st.shade} 100%)`,
      }}
      aria-hidden="true"
    >
      {/* The padding sits on this inner box: a container query unit on the container itself would measure the screen, not the cover (a huge gap on every stand-in cover) */}
      <div className="absolute inset-0 flex flex-col justify-between" style={{ padding: '9cqw 9cqw 8cqw' }}>
      <b
        style={{
          fontFamily: 'var(--rl-text-font, "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif)',
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
  // ONE URL per picture: a repaired cover is drawn at the card's size exactly like the same picture arriving through the book's own link (getCoverUrl). Raw, a repair
  // (Apple's 600x900) and the book's updated link (360x540) were two URLs for one picture, so the cover loaded twice and visibly swapped.
  const fix = pick ? '' : getCoverFix(book);
  // Whatever is already known is drawn at once (pick, repair, the book's own link, else a cover kept from an earlier lookup): nothing here waits on a lookup or a measurement.
  const own = pick ? '' : ownCoverUrl(book, imgSize);
  const kept = pick || fix || own ? '' : peekCoverCandidate(book);
  const baseUrl = pick ? pickSizedUrl(pick.url, imgSize) : fix ? sizedCoverUrl(fix, imgSize) : own || (kept ? sizedCoverUrl(kept, imgSize) : '');
  type St = { base: string; tries: number; alt: string; dead: boolean };
  const [st, setSt] = useState<St>({ base: baseUrl, tries: 0, alt: '', dead: false });
  const cur: St = st.base === baseUrl ? st : { base: baseUrl, tries: 0, alt: '', dead: false };

  // Retry twice (cache-busted), then look for the same book's cover on Apple / Google Books
  const src = (cur.alt && sizedCoverUrl(cur.alt, imgSize)) || (cur.tries > 0 && baseUrl ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}r=${cur.tries}` : baseUrl);
  // Starts false even for a cover seen before: until the picture really is in hand the stand-in cover shows (never the bare book colour); the effect below flips it at once for a cached one
  const [imgLoaded, setImgLoaded] = useState(false);

  // A cover the browser already has (HTTP cache) is complete the moment the <img> exists: show it straight away instead of
  // flashing the title placeholder first. (onLoad can fire before React attaches it, or not at all for cached images.)
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const im = imgRef.current;
    const ready = !!im && im.complete && im.naturalWidth >= 8 && (!!pick || isFrontCoverShape(im.naturalWidth, im.naturalHeight));
    // Always set (not only to true): a NEW picture (a pick, a repair, a replacement) starts as "not loaded", so the stand-in stays until THIS picture is in hand\n    setImgLoaded(ready);
    if (ready) {
      recordLoadedCover(src);
      vet(src);
    }
  }, [src]);

  // A cover on screen (or near it) asks for its lookup first; one far below the fold still resolves, but in the background and behind every visible one
  const sentinel = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(eager || size === 'lg' || size === 'xl' || size === 'nook');
  useEffect(() => {
    if (near) return;
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  const giveUp = () => {
    resolveCover(book, { background: !near }).then(u => setSt(u ? { ...cur, alt: u } : { ...cur, dead: true }));
  };

  // The cover is drawn at once. A cover that loaded fine can still be a 3D render (a tilted book, the spine showing): its pixels are measured once, and a render is
  // replaced by a flat front from another source when there is one, ONCE. Then the book is settled (covers.ts: markCoverSettled): it is never measured or looked up
  // again, whatever scrolling or reopening does, until Refresh Book Covers, a pick or a newly published cover. Not for a cover you picked, nor for a replacement.
  const liveSrc = useRef('');
  liveSrc.current = src;
  const vetted = useRef(new Set<string>());
  const vet = (u: string) => {
    if (pick || fix || cur.alt || !u || vetted.current.has(u) || isCoverSettled(book)) return;
    vetted.current.add(u);
    // Background only: after the picture is already on screen, when the browser is idle
    const idle = (fn: () => void) => { try { (window as any).requestIdleCallback ? (window as any).requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 60); } catch { setTimeout(fn, 60); } };
    idle(() => void inspectCover(u).then(async v => {
      if (liveSrc.current !== u) return;
      // A 3D render always looks for a flat front. So does the NYT's marketing image when its pixels cannot be read ('unknown'): it is a render far more often than not.
      if (v !== 'render' && !(v === 'unknown' && isNytCoverUrl(book.coverUrl))) return markCoverSettled(book);
      // The first flat front the lookup finds (Apple, Google, then Open Library) replaces it. With none, the render stays (better than a placeholder) and the book is settled
      const alt = await resolveCover(book, { background: true }).catch(() => '');
      if (alt && alt !== u && liveSrc.current === u) setSt({ ...cur, alt });
      else if (liveSrc.current === u) markCoverSettled(book);
    }));
  };
  useEffect(() => {
    if (!baseUrl && !cur.alt && !cur.dead) giveUp(); // runs again when the cover scrolls near: the same lookup, moved to the front
  }, [baseUrl, book.title, near]);

  // Every attempt failed: tell the "Reload missing covers" button
  useEffect(() => {
    if (!cur.dead) return;
    if (getCoverFix(book)) dropCoverFix(book); // a repaired cover that broke: forget it, then it can be repaired again
    else reportMissingCover(book);
  }, [cur.dead, book.title, book.author]);

  const onErr = () => {
    // Forget the cached answer for this URL: a bad answer must not be handed back on every retry and every visit
    try { navigator.serviceWorker?.controller?.postMessage({ type: 'FORGET_COVER', url: src }); } catch {}
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
  const isReady = imgLoaded; // only a picture that really loaded replaces the stand-in (a remembered URL can still be slow or gone)

  return (
    <>
      {near ? null : <span ref={sentinel} aria-hidden className="absolute inset-0 pointer-events-none" />}
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
            vet(url);
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
