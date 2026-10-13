import { useEffect, useRef, useState } from 'react';
import { browserFrames, runReveal } from '../services/vineReveal';

/**
 * The fraction (0..1) of the vine to draw. It grows from nothing to `target` once, when the vine first appears, and later glides to a
 * new target when the streak changes. It depends only on `target` and `reduced`, so unrelated re-renders never restart it.
 * With reduced motion the complete vine (the target) is shown at once.
 */
export function useVineReveal(target: number, reduced: boolean): number {
  const [shown, setShown] = useState(reduced ? target : 0);
  const current = useRef(shown);
  useEffect(() => {
    const frames = browserFrames(typeof window === 'undefined' ? undefined : window);
    return runReveal(current.current, target, reduced, v => { current.current = v; setShown(v); }, frames);
  }, [target, reduced]);
  return shown;
}
