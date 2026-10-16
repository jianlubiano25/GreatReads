import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';

const subscribe = (cb: () => void) => {
  document.addEventListener('visibilitychange', cb);
  return () => document.removeEventListener('visibilitychange', cb);
};
const visible = () => document.visibilityState !== 'hidden';

/** True while the app is in the foreground (not hidden, not in the background on a phone). */
export const useAppForeground = (): boolean => useSyncExternalStore(subscribe, visible, () => true);

/**
 * True while a scene is worth running: its tab is the open one, the app is in the foreground, and the scene is on screen.
 * Timers, animation frames and looping animations all hang off this one flag, so nothing runs for a scene nobody can see.
 */
export function useSceneLive(tabActive: boolean, ref: RefObject<Element | null>): boolean {
  const foreground = useAppForeground();
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(entries => setOnScreen(entries[entries.length - 1].isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [ref, tabActive]); // hidden tabs have no box; look again when the tab opens
  return tabActive && foreground && onScreen;
}
