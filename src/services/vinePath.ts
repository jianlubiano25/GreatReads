/**
 * The nook's vine. It grows along one continuous route as the reading streak goes on:
 *   window's bottom-right corner -> along the bottom edge, right to left -> up the left side -> over the arch, left to right
 *   -> down the right side -> (a gentle curve to) the bottom shelf's board -> the top shelf's board.
 *
 * Pure geometry (no DOM): the scene measures the window frame and the two shelf boards and hands the rectangles in; this turns
 * them into one polyline with a length, so the vine can be drawn to any fraction of it and leaves and flowers can sit at fixed
 * fractions along it. Everything is in the scene's own pixels.
 */

export interface Box { x: number; y: number; w: number; h: number }
/** A shelf board: the line the books stand on, from x0 to x1 at height y (its centre). */
export interface Board { x0: number; x1: number; y: number }
export interface VineGeometry {
  /** The window's bordered frame (outer edge) */
  frame: Box;
  /** The frame's border width in px (the vine runs along the middle of the wood) */
  wood: number;
  /** The frame's top corner radius in px (the window is arched) */
  radius: number;
  bottom: Board;
  top: Board;
  /** The scene's width: the vine never leaves it */
  width: number;
}
export interface VinePoint { x: number; y: number; /** direction of travel, radians */ angle: number }
export interface Vine {
  /** SVG path data */
  d: string;
  /** The drawn path's real length in px (the stroke is clipped to a fraction of this) */
  length: number;
  /** Where the vine is a fraction t (0..1) of the way along it */
  at: (t: number) => VinePoint;
  /** Fractions along the vine where each leg of the route ends (the top shelf runs to 1) */
  bottomEdgeEnd: number; // the window's bottom edge, right to left
  leftEnd: number;       // up the left side
  archEnd: number;       // over the arch, left to right
  windowEnd: number;     // down the right side: the whole window frame
  bottomEnd: number;     // along the bottom shelf
}

type Pt = [number, number];
const STEP = 3;

/** Straight line sampled every STEP px (the start point is not repeated). */
function line(from: Pt, to: Pt): Pt[] {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const n = Math.max(1, Math.ceil(len / STEP));
  return Array.from({ length: n }, (_, i) => [from[0] + ((to[0] - from[0]) * (i + 1)) / n, from[1] + ((to[1] - from[1]) * (i + 1)) / n] as Pt);
}
function arc(cx: number, cy: number, r: number, a0: number, a1: number): Pt[] {
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / STEP));
  return Array.from({ length: n }, (_, i) => { const a = a0 + ((a1 - a0) * (i + 1)) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Pt; });
}
function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt): Pt[] {
  const approx = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) + Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
  const n = Math.max(2, Math.ceil(approx / STEP));
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n, u = 1 - t;
    return [0, 1].map(k => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]) as Pt;
  });
}

/** The vine's path (see the route at the top of this file). */
export function buildVine(g: VineGeometry): Vine {
  const half = g.wood / 2;
  const xl = g.frame.x + half;
  const xr = g.frame.x + g.frame.w - half;
  const yb = g.frame.y + g.frame.h - half;
  const yt = g.frame.y + half;
  const r = Math.max(2, Math.min(g.radius - half, (xr - xl) / 2, yb - yt));
  const start: Pt = [xr, yb];

  const pts: Pt[] = [start];
  pts.push(...line(start, [xl, yb])); // bottom edge, right to left
  const bottomEdgeEndIdx = pts.length - 1;
  pts.push(...line([xl, yb], [xl, yt + r])); // up the left side
  const leftEndIdx = pts.length - 1;
  pts.push(...arc(xl + r, yt + r, r, Math.PI, 1.5 * Math.PI)); // over the arch, left to right
  if (xr - r > xl + r) pts.push(...line([xl + r, yt], [xr - r, yt]));
  pts.push(...arc(xr - r, yt + r, r, 1.5 * Math.PI, 2 * Math.PI));
  const archEndIdx = pts.length - 1;
  pts.push(...line([xr, yt + r], [xr, yb])); // down the right side
  const windowEndIdx = pts.length - 1;

  // Window's bottom-right corner -> the start of the bottom shelf's board (a gentle S-curve when they are not level)
  const bx0 = g.bottom.x0 + 3;
  const bx1 = g.bottom.x1 - 2;
  const dx = Math.max(6, bx0 - xr);
  pts.push(...cubic([xr, yb], [xr + dx * 0.45, yb], [bx0 - dx * 0.45, g.bottom.y], [bx0, g.bottom.y]));
  pts.push(...line([bx0, g.bottom.y], [bx1, g.bottom.y]));
  const bottomEndIdx = pts.length - 1;

  // Round the end of the bottom board and go back along the top board (the bulge stays inside the scene)
  const bulge = Math.max(4, Math.min(12, g.width - 4 - bx1));
  pts.push(...cubic([bx1, g.bottom.y], [bx1 + bulge, g.bottom.y], [bx1 + bulge, g.top.y], [bx1, g.top.y]));
  pts.push(...line([bx1, g.top.y], [g.top.x0 + 3, g.top.y]));

  // Distance along the vine for every point
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const length = cum[cum.length - 1] || 1;

  // A gentle, repeatable sway across the direction of travel (two slow sine waves, no randomness), so it reads as a plant and
  // not a ruler line. It stays small: the vine follows the wood of the frame and the shelf boards with natural curves, and is steady at both ends.
  const wobble = 2.8;
  const dir = (i: number) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  const out: VinePoint[] = pts.map(([x, y], i) => {
    const angle = dir(i);
    const w = wobble * (0.75 * Math.sin(cum[i] / 10 + 0.5) + 0.35 * Math.sin(cum[i] / 4.3 + 1.7)) * Math.min(1, cum[i] / 12) * Math.min(1, (length - cum[i]) / 12);
    return { x: x - Math.sin(angle) * w, y: y + Math.cos(angle) * w, angle };
  });

  // The vine is drawn through the swayed points, so everything below (where a fraction t is, the leg ends, the length the stroke is
  // clipped to) is measured along THAT path. The stroke, the leaves and the leg ends then all agree about "how far".
  const run: number[] = [0];
  for (let i = 1; i < out.length; i++) run.push(run[i - 1] + Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y));
  const total = run[run.length - 1] || 1;

  const at = (t: number): VinePoint => {
    const s = Math.max(0, Math.min(1, t)) * total;
    let lo = 0, hi = run.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (run[mid] <= s) lo = mid; else hi = mid; }
    const span = run[hi] - run[lo] || 1;
    const f = (s - run[lo]) / span;
    return { x: out[lo].x + (out[hi].x - out[lo].x) * f, y: out[lo].y + (out[hi].y - out[lo].y) * f, angle: out[lo].angle };
  };
  const d = 'M' + out.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L');
  const frac = (idx: number) => run[idx] / total;
  return { d, length: total, at, bottomEdgeEnd: frac(bottomEdgeEndIdx), leftEnd: frac(leftEndIdx), archEnd: frac(archEndIdx), windowEnd: frac(windowEndIdx), bottomEnd: frac(bottomEndIdx) };
}

/** Leaves, shoots and flowers at fixed distances along the vine, so they do not move as the vine grows. */
export interface VineLeaf { t: number; x: number; y: number; /** degrees, the way the leaf points */ rot: number; /** 1 = a window leaf, smaller on the shelves */ size: number; flower: boolean; /** a small curling shoot grows from the other side of the vine */ shoot: boolean; side: 1 | -1 }

export function vineLeaves(v: Vine): VineLeaf[] {
  const leaves: VineLeaf[] = [];
  const gap = 23; // px between leaves
  const n = Math.max(1, Math.floor(v.length / gap));
  for (let k = 0; k < n; k++) {
    const t = (k + 0.6) / (n + 0.2);
    const p = v.at(t);
    const side: 1 | -1 = k % 2 ? 1 : -1;
    const onShelf = t > v.windowEnd;
    // pointing forward along the vine and out to one side; the very last leaf grows straight on, so the vine ends in a leaf
    const last = k === n - 1;
    leaves.push({ t, x: p.x, y: p.y, rot: (p.angle * 180) / Math.PI + (last ? 0 : side * (onShelf ? 62 : 48)), size: onShelf ? 0.6 : 0.85, flower: !last && k % 4 === 2, shoot: !last && k % 3 === 1, side });
  }
  return leaves;
}

/**
 * Where the drawn stem ends: at the last leaf the growing tip has reached (`lead` is how early a leaf shows, as in the drawing), or 0
 * before any leaf. The stem never runs on past its final leaf, so there is no bare trailing stem, and nothing is drawn before the
 * first earned leaf. Leaves sit at fixed fractions, so the stem reaches each one as the tip passes it.
 */
export function stemEnd(leaves: readonly { t: number }[], shown: number, lead: number): number {
  let end = 0;
  for (const l of leaves) if (shown >= l.t - lead && l.t > end) end = l.t;
  return end;
}

/** Fairy-light bulbs strung along the vine, a little off the stem on alternate sides. Fixed positions, like the leaves. */
export interface VineLight { t: number; x: number; y: number }
export function vineLights(v: Vine, gap = 34): VineLight[] {
  const n = Math.max(1, Math.floor(v.length / gap));
  return Array.from({ length: n }, (_, k) => {
    const t = (k + 0.5) / (n + 0.1), p = v.at(t), off = k % 2 ? 4 : -4;
    return { t, x: p.x - Math.sin(p.angle) * off, y: p.y + Math.cos(p.angle) * off };
  });
}
