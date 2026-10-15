import React from 'react';
import { stemEnd, tipIndex, restAt, vineLights, type Vine, type VineLeaf } from '../services/vinePath';
import type { VineStyle } from '../services/nookPrefs';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useVineReveal } from '../hooks/useVineReveal';

/**
 * A pointed vine leaf: round at the stem end, drawn to a sharp tip, with a faint centre vein. It points along +x from (0, 0).
 */
const LEAF_LEN = 17.1;
const LEAF_HALF = 4.6;
const LEAF_D = `M0 0 C${(LEAF_LEN * 0.14).toFixed(1)} ${(-LEAF_HALF * 1.45).toFixed(1)} ${(LEAF_LEN * 0.62).toFixed(1)} ${(-LEAF_HALF * 1.1).toFixed(1)} ${LEAF_LEN} 0 C${(LEAF_LEN * 0.62).toFixed(1)} ${(LEAF_HALF * 1.1).toFixed(1)} ${(LEAF_LEN * 0.14).toFixed(1)} ${(LEAF_HALF * 1.45).toFixed(1)} 0 0Z`;
const LEAF_VEIN = `M1 0 L${LEAF_LEN * 0.82} 0`;
const SHOOT_D = 'M0 0 C3 0 6.5 -1.2 9 -4.5'; // a short curling shoot, along +x from the vine
const FLOWER_COLORS = ['#f4a6bd', '#fff4c9', '#c9b2f0'];

const grow = (visible: boolean, animate: boolean, origin: string): React.CSSProperties => ({
  opacity: visible ? 1 : 0,
  transform: visible ? 'scale(1)' : 'scale(0.2)',
  transition: animate ? 'opacity .7s ease, transform .7s ease' : 'none',
  transformOrigin: origin,
});

/**
 * The stroke up to `shown` (0..1) of a path that is `length` px long, as a stroke-dasharray in real px.
 * Not pathLength: Safari (iPhone and iPad) ignores pathLength for dashes, which made the dash pattern repeat along the shelves and
 * draw bare vine where there are no leaves. The gap is longer than the whole path, so the pattern can never come round again.
 * A full vine overshoots by a few px so the last round cap is never clipped.
 */
export const clip = (shown: number, length: number): string => `${(shown >= 0.999 ? length + 4 : shown * length).toFixed(1)} ${(length + 10).toFixed(1)}`;

/** How the nook vine is dressed. Every look shares one path, one growth and one set of leaf positions: only colours and the little extras differ. */
export type NookVineLook = Exclude<VineStyle, 'classic'>;
interface LookDef { stem: string; leafA: string; leafB: string; shoot: string; shootLeaf: string; bloom: 'blossom' | 'pumpkin' | 'berry'; lights: boolean }
export const VINE_LOOKS: Record<NookVineLook, LookDef> = {
  nook: { stem: '#2e5934', leafA: '#71ab7a', leafB: '#4e7f55', shoot: '#3f6b46', shootLeaf: '#8cc48f', bloom: 'blossom', lights: false },
  lights: { stem: '#2e5934', leafA: '#71ab7a', leafB: '#4e7f55', shoot: '#3f6b46', shootLeaf: '#8cc48f', bloom: 'blossom', lights: true },
  halloween: { stem: '#4a3a24', leafA: '#b0702a', leafB: '#6f5a2c', shoot: '#5a4528', shootLeaf: '#c9923f', bloom: 'pumpkin', lights: false },
  christmas: { stem: '#245030', leafA: '#2f7a46', leafB: '#1f5634', shoot: '#2c5d3a', shootLeaf: '#4f9a5c', bloom: 'berry', lights: false },
};
const FLAKE = 'M0 -1.6 V1.6 M-1.4 -0.8 L1.4 0.8 M-1.4 0.8 L1.4 -0.8';

function Bloom({ kind, color }: { kind: LookDef['bloom']; color: string }) {
  if (kind === 'pumpkin') {
    return (
      <>
        <ellipse cx={0} cy={0} rx={2.7} ry={2.2} fill="#e8832a" />
        <path d="M0 -2.1 V2.1 M-1.4 -1.8 Q-2.4 0 -1.4 1.8 M1.4 -1.8 Q2.4 0 1.4 1.8" stroke="#b85a14" strokeWidth={0.45} fill="none" />
        <path d="M0 -2.1 q0.2 -1.2 1.1 -1.5" stroke="#5a7a34" strokeWidth={0.8} strokeLinecap="round" fill="none" />
      </>
    );
  }
  if (kind === 'berry') {
    return (
      <>
        {[[-1.3, 0.7], [1.3, 0.7], [0, -1.0]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={1.25} fill="#c0283d" />)}
        <circle cx={-0.6} cy={-1.5} r={0.35} fill="#fff" opacity={0.55} />
        <path d={FLAKE} stroke="#f2c14e" strokeWidth={0.4} transform="translate(2.6 -2.6)" strokeLinecap="round" />
      </>
    );
  }
  return (
    <>
      {[0, 72, 144, 216, 288].map(a => <ellipse key={a} cx={0} cy={-2.3} rx={1.5} ry={2.2} transform={`rotate(${a})`} fill={color} />)}
      <circle r={1.1} fill="#ffd66b" />
    </>
  );
}

interface DrawProps { vine: Vine; parts: VineLeaf[]; width: number; /** how much of the route is grown, 0..1 */ shown: number; animate: boolean; /** still growing: the stem follows the tip. At rest it ends exactly at its last leaf. */ growing?: boolean; look?: NookVineLook; /** let the fairy lights twinkle (only while the scene is on screen and motion is allowed) */ twinkle?: boolean }

/**
 * The drawing only: the vine's stroke, and each leaf, shoot and flower once the growing tip has reached it.
 * The stem ends exactly at the last leaf that has appeared (see stemEnd), so it never runs on bare, and nothing is drawn before the first leaf.
 * Purely decorative: it never takes a tap (pointer-events: none on the svg and so on everything inside it), and it sits in front
 * of the books (z-10) so the vine can wind over them.
 */
export function VineDrawing({ vine, parts, width, shown, animate, growing = false, look = 'nook', twinkle = false }: DrawProps) {
  const L = VINE_LOOKS[look] ?? VINE_LOOKS.nook;
  const stemT = growing ? Math.max(stemEnd(parts, shown, 0.004), shown) : stemEnd(parts, shown, 0.004);
  const tip = tipIndex(parts, shown, 0.004);
  const lights = L.lights ? vineLights(vine) : [];
  return (
    <svg
      width={width}
      height="100%"
      className="absolute left-0 top-0 pointer-events-none z-10"
      style={{ height: '100%', overflow: 'visible', pointerEvents: 'none' }}
      fill="none"
      role="img"
      aria-label="Vine along the window and shelves, grows with every day you meet your reading goal"
    >
      {stemT > 0 && (
        <path d={vine.dTo(stemT)} stroke={L.stem} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {lights.map((b, i) => stemT >= b.t && (
        // two tiny dots per bulb (no blur filters): cheap to draw, and only opacity ever animates, in three shared phases
        <g key={`l${i}`} className={twinkle ? `rl-twinkle rl-twinkle-${i % 3}` : undefined} opacity={twinkle ? undefined : 0.85}>
          <circle cx={b.x} cy={b.y} r={3.6} fill="#ffe6a8" opacity={0.2} />
          <circle cx={b.x} cy={b.y} r={1.6} fill={['#ffe3a1', '#fff1c8', '#ffd3a1'][i % 3]} />
        </g>
      ))}
      {parts.map((l, i) => {
        const origin = `${l.x}px ${l.y}px`;
        const isTip = i === tip; // the newest leaf continues the stem, so the stem ends in a leaf
        return (
          <g key={i}>
            <g style={grow(shown >= l.t - 0.004, animate, origin)}>
              <g transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) rotate(${(isTip ? l.ang : l.rot).toFixed(1)}) scale(${l.size})`}>
                <path d={LEAF_D} fill={i % 2 ? L.leafB : L.leafA} />
                <path d={LEAF_VEIN} stroke="rgba(255,255,255,0.28)" strokeWidth={0.7} strokeLinecap="round" />
              </g>
            </g>
            {l.shoot && !isTip && (
              <g style={grow(shown >= l.t + 0.012, animate, origin)}>
                <g transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) rotate(${(l.ang + 62).toFixed(1)}) scale(${l.size > 0.7 ? 1 : 0.8})`}>
                  <path d={SHOOT_D} stroke={L.shoot} strokeWidth={1} strokeLinecap="round" />
                  <g transform="translate(9 -4.5) rotate(-40) scale(0.55)">
                    <path d={LEAF_D} fill={L.shootLeaf} />
                  </g>
                </g>
              </g>
            )}
            {l.flower && !isTip && (
              <g style={grow(shown >= l.t + 0.02, animate, origin)}>
                <g transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) scale(${l.size > 0.7 ? 1 : 0.75})`}>
                  <Bloom kind={L.bloom} color={FLOWER_COLORS[i % FLOWER_COLORS.length]} />
                </g>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The vine: it grows to `target` (from your goal-met days) when the Garden Nook opens, then keeps growing as days are added.
 * The animation state lives here, so frames re-render only this small layer and never the rest of the scene.
 */
export function VineLayer({ vine, parts, width, target, look = 'nook', live = true }: { vine: Vine; parts: VineLeaf[]; width: number; target: number; look?: NookVineLook; live?: boolean }) {
  const reduced = useReducedMotion();
  const rest = restAt(parts, target, 0.004); // the growth settles exactly on a leaf, so the stem ends where its last leaf is
  const shown = useVineReveal(rest, reduced, live);
  return <VineDrawing vine={vine} parts={parts} width={width} shown={shown} animate={!reduced} growing={shown < rest - 1e-6} look={look} twinkle={live && !reduced} />;
}

/**
 * The classic window vine from main: a short climbing vine that stays inside the window (viewBox 0 0 100 133, bottom-left up to the top).
 * It uses the same growth and the same opening animation as the nook vine, so switching looks never changes how much has grown.
 */
// The original classic path, moved 3 units left (the leaves that lean left reach past the svg's edge, so it does not clip them: overflow is visible).
const classicPt = (t: number) => ({ x: 11 + 9 * Math.sin(t * 6.5) + t * 16, y: 128 - t * 114 });
export const CLASSIC_PTS = Array.from({ length: 41 }, (_, i) => classicPt(i / 40));
const CLASSIC_D = 'M' + CLASSIC_PTS.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L');
const CLASSIC_LEN = CLASSIC_PTS.reduce((n, p, i) => (i ? n + Math.hypot(p.x - CLASSIC_PTS[i - 1].x, p.y - CLASSIC_PTS[i - 1].y) : 0), 0);
export const CLASSIC_LEAVES = Array.from({ length: 10 }, (_, k) => { const t = (k + 1) / 11; return { t, ...classicPt(t), side: k % 2 ? 1 : -1 }; });
const CLASSIC_FLOWERS = [
  { k: 1, c: '#f4a6bd' }, { k: 3, c: '#fff4c9' }, { k: 5, c: '#c9b2f0' }, { k: 7, c: '#f4a6bd' }, { k: 9, c: '#fff4c9' },
].map(({ k, c }) => { const t = (k + 1) / 11; const p = classicPt(t); const side = k % 2 ? 1 : -1; return { t, c, x: p.x + side * 3.2, y: p.y - 5 }; });

export function ClassicVineDrawing({ shown, animate, growing = false }: { shown: number; animate: boolean; growing?: boolean }) {
  // At rest the stem ends exactly at its last leaf; while it is growing it follows the tip, like the original.
  const stemT = growing ? Math.max(stemEnd(CLASSIC_LEAVES, shown, 0.02), shown) : stemEnd(CLASSIC_LEAVES, shown, 0.02);
  return (
    <svg
      viewBox="0 0 100 133"
      preserveAspectRatio="xMinYMax meet"
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ pointerEvents: 'none', overflow: 'visible' }}
      fill="none"
      role="img"
      aria-label="Window vine, grows as you read and keeps what it has grown"
    >
      {stemT > 0.0005 && (
        <path d={CLASSIC_D} stroke="#2e5934" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={clip(stemT, CLASSIC_LEN)} />
      )}
      {CLASSIC_LEAVES.map((l, i) => (
        <g key={i} style={grow(shown >= l.t - 0.02, animate, `${l.x}px ${l.y}px`)}>
          <g transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) scale(${l.side} 1) rotate(-35)`}>
            <path d={LEAF_D} fill={i % 2 ? '#4e7f55' : '#71ab7a'} />
            <path d={LEAF_VEIN} stroke="rgba(255,255,255,0.28)" strokeWidth={0.7} strokeLinecap="round" />
          </g>
        </g>
      ))}
      {CLASSIC_FLOWERS.map((f, i) => (
        <g key={`f${i}`} style={grow(shown >= f.t + 0.04, animate, `${f.x}px ${f.y}px`)}>
          <g transform={`translate(${f.x.toFixed(1)} ${f.y.toFixed(1)})`}>
            {[0, 72, 144, 216, 288].map(a => (
              <ellipse key={a} cx={0} cy={-2.3} rx={1.5} ry={2.2} transform={`rotate(${a})`} fill={f.c} />
            ))}
            <circle r={1.1} fill="#ffd66b" />
          </g>
        </g>
      ))}
    </svg>
  );
}

export function ClassicVineLayer({ target, live = true }: { target: number; live?: boolean }) {
  const reduced = useReducedMotion();
  const rest = restAt(CLASSIC_LEAVES, target, 0.02);
  const shown = useVineReveal(rest, reduced, live);
  return <ClassicVineDrawing shown={shown} animate={!reduced} growing={shown < rest - 1e-6} />;
}
