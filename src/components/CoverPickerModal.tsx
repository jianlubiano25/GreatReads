import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isFrontCoverShape } from '../services/books/placeholderCover';
import { ChevronLeft, ChevronRight, Star, X } from 'lucide-react';
import type { Book } from '../types';
import { useModalA11y } from '../hooks/useModalA11y';
import { useReducedMotion } from '../hooks/useReducedMotion';
import {
  clearCoverPick,
  coverKey,
  COVER_SOURCE_LABEL,
  coverSourceOf,
  getCoverFix,
  getCoverPickInfo,
  getMyCoverPick,
  getCoverUrl,
  getCoversVersion,
  flatKey,
  loadCoverCandidates,
  setCoverPick,
  subscribeCovers,
  type CoverSource,
} from '../services/books';
import { publishCoverToCatalog, rejectCoverForBook, rejectedCovers, storedCovers, syncCatalog } from '../services/catalog';
import { authVersion, currentUser, isAdminKnown, subscribeAuth } from '../services/supabase';

/**
 * The cover viewer: swipe through every cover the sources have for this book, tap the star to use one everywhere in the app.
 *
 * Light by design: a CSS scroll-snap strip (no gesture library), the first three pictures load at once and the rest as they come near,
 * and the covers come from services/books/covers.ts, which asks each source once per book and remembers the answer.
 * The slide order is fixed when the viewer opens (your pick, the default cover, then new finds as they arrive) so nothing jumps while you swipe.
 */

type Slide = { url: string; source: CoverSource; key: string };

// One cover is drawn CH tall (2:3); a slide is that wide plus a little air. Spacers let the first and last slide sit in the middle.
const CH = 'min(58dvh, 460px)';
const SLIDE_W = `calc(${CH} * 0.6667 + 24px)`;

interface Props {
  book: Book;
  onClose: () => void;
}

export function CoverPickerModal({ book, onClose }: Props) {
  useModalA11y(onClose);
  const reduced = useReducedMotion();
  useSyncExternalStore(subscribeCovers, getCoversVersion, getCoversVersion); // the star follows the saved pick

  // What the app would show without a pick: the repaired cover, else the book's own link (full size)
  const [autoUrl] = useState(() => getCoverFix(book) || getCoverUrl(book.coverId, 'L', book.coverUrl));
  const autoKey = autoUrl ? flatKey(autoUrl) : '';
  const pickInfo = getCoverPickInfo(book);
  const pickKey = pickInfo ? flatKey(pickInfo.url) : '';

  const merge = useCallback((list: Slide[], more: { url: string; source: CoverSource }[]): Slide[] => {
    const next = [...list];
    for (const c of more) {
      const key = flatKey(c.url);
      if (!next.some(s => s.key === key)) next.push({ url: c.url, source: c.source, key });
    }
    return next.length === list.length ? list : next;
  }, []);

  const [slides, setSlides] = useState<Slide[]>(() => {
    const first: { url: string; source: CoverSource }[] = [];
    if (pickInfo) first.push({ url: pickInfo.url, source: pickInfo.source });
    if (autoUrl) first.push({ url: autoUrl, source: coverSourceOf(autoUrl) });
    return merge([], first);
  });
  const [loading, setLoading] = useState(true);
  const [bad, setBad] = useState<Record<string, true>>({});
  useSyncExternalStore(subscribeAuth, authVersion, authVersion);
  const owner = !!currentUser() && isAdminKnown() === true;
  // covers the owner already rejected for this book never show up again in the viewer
  useEffect(() => {
    if (!owner) return;
    let live = true;
    rejectedCovers(book).then(urls => { if (live && urls.length) setBad(prev => { const n = { ...prev }; urls.forEach(u => { n[flatKey(u)] = true; }); return n; }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, book.title, book.author]);
  const [dims, setDims] = useState<Record<string, string>>({});
  const [active, setActive] = useState(0);

  // The owner sees what the catalog already stores for this book first (the same covers the admin tools list), then the live finds are added behind them
  useEffect(() => {
    if (!owner) return;
    let live = true;
    storedCovers(book).then(list => { if (live && list.length) setSlides(prev => merge(prev, list)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, book.title, book.author]);

  // Ask the sources (once per book; a repeat open is answered from this device)
  const bookKey = coverKey(book);
  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    loadCoverCandidates(book, list => setSlides(prev => merge(prev, list)), ac.signal).finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  const visible = slides.filter(s => !bad[s.key]);
  const at = Math.min(active, Math.max(0, visible.length - 1));
  const current = visible[at];

  // Which slide is in the middle: the one that is mostly inside the strip
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = strip.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      entries => { for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i)); },
      { root, threshold: 0.6 },
    );
    root.querySelectorAll('[data-i]').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [visible.length]);

  const go = (delta: number) => {
    const el = strip.current?.querySelector<HTMLElement>(`[data-i="${Math.max(0, Math.min(visible.length - 1, at + delta))}"]`);
    el?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
  };

  const starred = !!current && current.key === pickKey;
  const mine = getMyCoverPick(book);
  const [note, setNote] = useState('');
  useEffect(() => setNote(''), [at]);
  const toggleStar = () => {
    if (!current) return;
    if (!starred) {
      setCoverPick(book, { url: current.url, source: current.source }); // your own pick: on this device at once
      if (owner) { // the owner's star is also published for everyone, and this device's catalog is refreshed straight away
        setNote('Published for everyone…');
        void publishCoverToCatalog(book, current.url).then(async r => { if (r.ok) await syncCatalog({ force: true }); setNote(r.ok ? 'Published for everyone.' : `Used here, but not published: ${r.error}`); });
      }
    } else if (mine) clearCoverPick(book);
    else setNote('Published for everyone. To take it off, use the ✕ in Profile › Publish book covers.'); // nothing of yours to unstar
  };

  // ✕ = do not use this cover: it leaves the viewer now; for the owner it is also stored as rejected in the catalog (it never comes back), and a pick of it is dropped
  const dontUse = async () => {
    if (!current) return;
    const { url, key } = current;
    setBad(prev => ({ ...prev, [key]: true }));
    if (mine && flatKey(mine.url) === key) clearCoverPick(book);
    if (!owner) { setNote('Hidden here. Sign in as the owner (Profile → Account) to reject it for everyone.'); return; }
    const r = await rejectCoverForBook(book, url);
    setNote(r.ok ? 'Rejected: this cover will not be used.' : `Hidden here, but not saved to the catalog: ${r.error}`);
  };

  const tip = current ? `${COVER_SOURCE_LABEL[current.source]}${current.key === autoKey ? ' · default cover' : ''}${dims[current.key] ? ` · ${dims[current.key]}` : ''}` : '';

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/90 backdrop-blur-sm text-white animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label={`Choose a cover for ${book.title}`}
      onClick={onClose}
      onKeyDown={e => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      }}
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-2" onClick={e => e.stopPropagation()}>
        <div className="min-w-0">
          <div className="font-serif-display text-lg leading-tight truncate">{book.title}</div>
          <div className="text-xs text-white/60 truncate" role="status" aria-live="polite">
            {loading ? 'Finding more covers…' : visible.length > 1 ? 'Swipe to compare covers' : 'No other covers found'}
          </div>
        </div>
        <button onClick={onClose} className="shrink-0 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center" aria-label="Close cover viewer">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* The strip: native scroll + snap, so swiping is as smooth as the phone's own scrolling */}
      <div
        ref={strip}
        className="flex-1 min-h-0 flex items-center overflow-x-auto overflow-y-hidden snap-x snap-mandatory no-scrollbar overscroll-x-contain"
        style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
        onClick={e => e.stopPropagation()}
        tabIndex={-1}
      >
        <div aria-hidden="true" style={{ flex: '0 0 auto', width: `calc((100% - ${SLIDE_W}) / 2)` }} />
        {visible.map((s, i) => (
          <div key={s.key} data-i={i} className="snap-center flex items-center justify-center" style={{ flex: `0 0 ${SLIDE_W}` }}>
            <div className="relative rounded-md overflow-hidden bg-white/5 shadow-2xl flex items-center justify-center" style={{ height: CH, aspectRatio: '2 / 3' }}>
              <img
                src={s.url}
                alt={`${book.title}, cover from ${COVER_SOURCE_LABEL[s.source]}`}
                loading={i < 3 ? 'eager' : 'lazy'}
                decoding="async"
                referrerPolicy="no-referrer"
                draggable={false}
                className="max-w-full max-h-full object-contain"
                onLoad={e => {
                  const im = e.currentTarget;
                  if (im.naturalWidth > 0 && im.naturalWidth < 8) return setBad(p => ({ ...p, [s.key]: true })); // a 1x1 placeholder is no cover
                  if (!isFrontCoverShape(im.naturalWidth, im.naturalHeight)) return setBad(p => ({ ...p, [s.key]: true })); // a spine / back / photographed book is no front cover
                  if (im.naturalWidth) setDims(p => (p[s.key] ? p : { ...p, [s.key]: `${im.naturalWidth}×${im.naturalHeight}` }));
                }}
                onError={() => setBad(p => ({ ...p, [s.key]: true }))}
              />
              {s.key === pickKey && (
                <span className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/55 flex items-center justify-center" aria-hidden="true">
                  <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                </span>
              )}
            </div>
          </div>
        ))}
        {!visible.length && !loading && <div className="mx-auto px-8 text-center text-sm text-white/60">No cover found for this book yet.</div>}
        <div aria-hidden="true" style={{ flex: '0 0 auto', width: `calc((100% - ${SLIDE_W}) / 2)` }} />
      </div>

      <div className="flex flex-col items-center gap-3 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()}>
        {/* The tooltip: where this cover comes from (and how big it is) */}
        <div className="min-h-[28px] max-w-full" aria-live="polite">
          {current && (
            <span className="inline-block max-w-full truncate px-3 py-1 rounded-full bg-white/12 text-xs" title={`Source: ${COVER_SOURCE_LABEL[current.source]}`}>
              {tip}
            </span>
          )}
        </div>
        <div className="flex items-center gap-5">
          <button onClick={() => go(-1)} disabled={at <= 0} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 flex items-center justify-center" aria-label="Previous cover">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={toggleStar}
            disabled={!current}
            aria-pressed={starred}
            aria-label={starred ? 'Stop using this cover' : 'Use this cover everywhere'}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-transform active:scale-95 disabled:opacity-30 ${starred ? 'bg-amber-400/20 ring-2 ring-amber-400' : 'bg-white/10 hover:bg-white/20'}`}
          >
            <Star className={`w-7 h-7 ${starred ? 'fill-amber-400 text-amber-400' : 'text-white'}`} />
          </button>
          <button
            onClick={() => void dontUse()}
            disabled={!current}
            aria-label="Do not use this cover"
            title="Do not use this cover"
            className="w-11 h-11 rounded-full flex items-center justify-center bg-white/10 hover:bg-red-500/30 active:scale-95 transition disabled:opacity-30"
          >
            <X className="w-5 h-5 text-red-300" />
          </button>
          <button onClick={() => go(1)} disabled={at >= visible.length - 1} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 flex items-center justify-center" aria-label="Next cover">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        <div className="text-[11px] text-white/50 min-h-[14px] text-center max-w-[300px]" aria-live="polite">
          {note || (starred ? (mine ? 'Your pick · on this device until you publish it' : 'Published for everyone') : visible.length ? `${at + 1} of ${visible.length}` : '')}
        </div>
      </div>
    </div>
  );
}
