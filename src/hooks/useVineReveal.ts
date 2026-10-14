import { useEffect, useRef, useState } from 'react';
import { browserFrames, runReveal } from '../services/vineReveal';

/**
 * The fraction (0..1) of the vine to draw. It grows from nothing to `target` once, when the vine first appears, and later glides to a
 * new target when the streak changes. It depends only on `target`, `reduced` and `live`, so unrelated re-renders never restart it.
 * With reduced motion the complete vine (the target) is shown at once.
 * While the scene is not `live` (another tab, app in the background, scrolled away) no frames run; the growth carries on from where it
 * stopped when the scene is seen again, so the opening animation is never spent on a vine nobody is looking at.
 */
export function useVineReveal(target: number, reduced: boolean, live = true): number {
  const [shown, setShown] = useState(reduced ? target : 0);
  const current = useRef(shown);
  useEffect(() => {
    if (!live && !reduced) return;
    const frames = browserFrames(typeof window === 'undefined' ? undefined : window);
    return runReveal(current.current, target, reduced, v => { current.current = v; setShown(v); }, frames);
  }, [target, reduced, live]);
  return shown;
}
