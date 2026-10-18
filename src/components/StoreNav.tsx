import { useEffect, useRef, useState } from 'react';
import { BookHeart, Crown, Flame, Shapes, Trophy, type LucideIcon } from 'lucide-react';
import { SHELF_BY_ID, type StoreSection } from '../services/store/registry';

/** The sticky icon bar: five icons, one per part of the Store (New and Trending share one). */
export const NAV_ITEMS: { key: string; label: string; icon: LucideIcon; sections: StoreSection[] }[] = [
  { key: 'top', label: 'Top charts', icon: Crown, sections: ['top'] },
  { key: 'trending', label: 'New & trending', icon: Flame, sections: ['new', 'trending'] },
  { key: 'clubs', label: 'Book clubs', icon: BookHeart, sections: ['clubs'] },
  { key: 'awards', label: 'Awards', icon: Trophy, sections: ['awards'] },
  { key: 'genres', label: 'Genres', icon: Shapes, sections: ['genres'] },
];

const shelfEls = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[data-shelf-id]'));
const itemOf = (shelfId: string) => NAV_ITEMS.find(n => n.sections.includes(SHELF_BY_ID[shelfId]?.section))?.key;

/** Jump to the first shelf (as the Store is arranged now, and not hidden) of an icon's sections. Returns false when there is none. */
export function jumpTo(key: string): boolean {
  const item = NAV_ITEMS.find(n => n.key === key);
  const el = item && shelfEls().find(e => item.sections.includes(SHELF_BY_ID[e.dataset.shelfId || '']?.section));
  if (!el) return false;
  const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  // Shelves below the screen are drawn at an estimated height until they come near it, so the page can grow or shrink while the smooth
  // scroll runs and it ends a little off. Check where the shelf landed a few times and put it exactly under the bar if it is off.
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  let tries = 0;
  const settle = () => {
    if (!el.isConnected) return;
    if (Math.abs(el.getBoundingClientRect().top - margin) > 3) el.scrollIntoView({ behavior: 'auto', block: 'start' });
    if (++tries < 4) setTimeout(settle, 450);
  };
  setTimeout(settle, 450);
  return true;
}

/** Icons only, so it stays small on a phone. Sticks to the top while the shelves scroll under it; the icon of the part you are in is lit. */
export function StoreNav({ active, order }: { active: boolean; order: string[] }) {
  const [current, setCurrent] = useState('top');
  const [present, setPresent] = useState<Record<string, boolean>>({});
  // After a tap, the tapped icon stays lit while the page scrolls there: the smooth scroll passes over every part in between, and
  // following it made the highlight jump back and forth. The lock is released only by the reader's own scrolling (wheel, touch, keys).
  const locked = useRef<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const els = shelfEls();
      const have: Record<string, boolean> = {};
      for (const e of els) { const k = itemOf(e.dataset.shelfId || ''); if (k) have[k] = true; }
      setPresent(prev => (NAV_ITEMS.every(n => !!prev[n.key] === !!have[n.key]) ? prev : have));
      let key = NAV_ITEMS[0].key;
      for (const e of els) { if (e.getBoundingClientRect().top <= 120) key = itemOf(e.dataset.shelfId || '') || key; else break; }
      if (!locked.current) setCurrent(key);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    const release = () => { if (locked.current) { locked.current = null; onScroll(); } };
    const onKey = (e: KeyboardEvent) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) release(); };
    update();
    const settle = setTimeout(update, 1500); // lazy shelves appear (or hide themselves) shortly after opening
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('wheel', release, { passive: true });
    window.addEventListener('touchstart', release, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(settle); if (raf) cancelAnimationFrame(raf); window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); window.removeEventListener('wheel', release); window.removeEventListener('touchstart', release); window.removeEventListener('keydown', onKey); };
  }, [active, order]);

  return (
    <nav aria-label="Jump to a part of the Store" className="sticky top-0 z-20 -mx-4 sm:-mx-6 md:-mx-8 px-4 sm:px-6 md:px-8 pt-[max(env(safe-area-inset-top),0.25rem)] pb-1.5 bg-[#f5f0e6]/95 dark:bg-[#181410]/95 backdrop-blur-md border-b border-[#e3d7c3] dark:border-[#382f25]">
      <div className="flex items-center justify-around max-w-sm mx-auto">
        {NAV_ITEMS.map(({ key, label, icon: Icon }) => {
          const on = current === key;
          return (
            <button
              key={key}
              type="button"
              aria-label={label}
              title={label}
              aria-current={on ? 'true' : undefined}
              disabled={present[key] === false}
              onClick={() => { if (jumpTo(key)) { locked.current = key; setCurrent(key); } }}
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2e5934] ${on ? 'bg-[#2e5934]/15 text-[#2e5934] dark:bg-[#86b880]/20 dark:text-[#86b880]' : 'text-[#706256] dark:text-[#a89a8a] hover:bg-[#e3d7c3]/50 dark:hover:bg-[#382f25]/50'}`}
            >
              <Icon className="w-5 h-5" />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
