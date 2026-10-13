/**
 * The vine's opening animation, as pure maths: how far along the route the vine has grown `elapsed` ms after it started.
 * The component drives it from requestAnimationFrame, so leaves, shoots and flowers appear in route order as the growing tip passes them.
 */
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/** Longer for a longer way to grow (a full vine takes about 2.2 s), never less than half a second. */
export const revealDuration = (from: number, to: number): number => Math.max(500, Math.min(2200, Math.abs(to - from) * 3000));

export function revealValue(from: number, to: number, elapsed: number, duration: number): number {
  if (!(duration > 0) || elapsed >= duration) return to;
  return from + (to - from) * easeOutCubic(elapsed / duration);
}

export interface FrameScheduler { raf: (cb: (now: number) => void) => number; caf: (id: number) => void }

/**
 * Animation frames from a window. The browser's requestAnimationFrame only works when called ON the window ("Illegal invocation"
 * otherwise), so these are small wrappers that always call it as `win.requestAnimationFrame(...)`, never a detached copy.
 */
export function browserFrames(win?: { requestAnimationFrame?: (cb: (now: number) => void) => number; cancelAnimationFrame?: (id: number) => void }): FrameScheduler | undefined {
  if (!win || typeof win.requestAnimationFrame !== 'function' || typeof win.cancelAnimationFrame !== 'function') return undefined;
  return { raf: cb => win.requestAnimationFrame!(cb), caf: id => win.cancelAnimationFrame!(id) };
}

/**
 * Grow from `from` to `to`, reporting each step to `onValue`. With reduced motion (or no animation frames available) it reports `to`
 * at once, so the complete vine shows. Returns a function that stops it (used when the inputs change or the layer goes away).
 */
export function runReveal(from: number, to: number, reduced: boolean, onValue: (v: number) => void, frames?: FrameScheduler): () => void {
  if (reduced || !frames) {
    onValue(to);
    return () => {};
  }
  if (from === to) return () => {};
  const duration = revealDuration(from, to);
  let start = -1;
  let id = 0;
  const step = (now: number) => {
    if (start < 0) start = now;
    onValue(revealValue(from, to, now - start, duration));
    if (now - start < duration) id = frames.raf(step);
  };
  id = frames.raf(step);
  return () => frames.caf(id);
}
