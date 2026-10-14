import React from 'react';
import type { Vine, VineLeaf } from '../services/vinePath';
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

interface DrawProps { vine: Vine; parts: VineLeaf[]; width: number; /** how much of the route is grown, 0..1 */ shown: number; animate: boolean }

/**
 * The drawing only: the vine's stroke up to `shown`, and each leaf, shoot and flower once the growing tip has reached it.
 * Purely decorative: it never takes a tap (pointer-events: none on the svg and so on everything inside it), and it sits in front
 * of the books (z-10) so the vine can wind over them.
 */
export function VineDrawing({ vine, parts, width, shown, animate }: DrawProps) {
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
      {shown > 0.0005 && (
        <path d={vine.d} stroke="#2e5934" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={clip(shown, vine.length)} />
      )}
      {parts.map((l, i) => {
        const origin = `${l.x}px ${l.y}px`;
        return (
          <g key={i}>
            <g style={grow(shown >= l.t - 0.004, animate, origin)}>
              <g transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) rotate(${l.rot.toFixed(1)}) scale(${l.size})`}>
                <path d={LEAF_D} fill={i % 2 ? '#4e7f55' : '#71ab7a'} />
                <path d={LEAF_VEIN} stroke="rgba(255,255,255,0.28)" strokeWidth={0.7} strokeLinecap="round" />
              </g>
            </g>
            {l.shoot && (
              <g style={grow(shown >= l.t + 0.012, animate, origin)}>
                <g transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) rotate(${(l.rot - l.side * 105).toFixed(1)}) scale(${l.size > 0.7 ? 1 : 0.8})`}>
                  <path d={SHOOT_D} stroke="#3f6b46" strokeWidth={1} strokeLinecap="round" />
                  <g transform="translate(9 -4.5) rotate(-40) scale(0.38)">
                    <path d={LEAF_D} fill="#8cc48f" />
                  </g>
                </g>
              </g>
            )}
            {l.flower && (
              <g style={grow(shown >= l.t + 0.02, animate, origin)}>
                <g transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) scale(${l.size > 0.7 ? 1 : 0.75})`}>
                  {[0, 72, 144, 216, 288].map(a => (
                    <ellipse key={a} cx={0} cy={-2.3} rx={1.5} ry={2.2} transform={`rotate(${a})`} fill={FLOWER_COLORS[i % FLOWER_COLORS.length]} />
                  ))}
                  <circle r={1.1} fill="#ffd66b" />
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
export function VineLayer({ vine, parts, width, target }: { vine: Vine; parts: VineLeaf[]; width: number; target: number }) {
  const reduced = useReducedMotion();
  const shown = useVineReveal(target, reduced);
  return <VineDrawing vine={vine} parts={parts} width={width} shown={shown} animate={!reduced} />;
}

/**
 * The classic window vine from main: a short climbing vine that stays inside the window (viewBox 0 0 100 133, bottom-left up to the top).
 * It uses the same growth and the same opening animation as the nook vine, so switching looks never changes how much has grown.
 */
const classicPt = (t: number) => ({ x: 14 + 9 * Math.sin(t * 6.5) + t * 16, y: 128 - t * 114 });
const CLASSIC_PTS = Array.from({ length: 41 }, (_, i) => classicPt(i / 40));
const CLASSIC_D = 'M' + CLASSIC_PTS.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L');
const CLASSIC_LEN = CLASSIC_PTS.reduce((n, p, i) => (i ? n + Math.hypot(p.x - CLASSIC_PTS[i - 1].x, p.y - CLASSIC_PTS[i - 1].y) : 0), 0);
const CLASSIC_LEAVES = Array.from({ length: 10 }, (_, k) => { const t = (k + 1) / 11; return { t, ...classicPt(t), side: k % 2 ? 1 : -1 }; });
const CLASSIC_FLOWERS = [
  { k: 1, c: '#f4a6bd' }, { k: 3, c: '#fff4c9' }, { k: 5, c: '#c9b2f0' }, { k: 7, c: '#f4a6bd' }, { k: 9, c: '#fff4c9' },
].map(({ k, c }) => { const t = (k + 1) / 11; const p = classicPt(t); const side = k % 2 ? 1 : -1; return { t, c, x: p.x + side * 3.2, y: p.y - 5 }; });

export function ClassicVineDrawing({ shown, animate }: { shown: number; animate: boolean }) {
  return (
    <svg
      viewBox="0 0 100 133"
      preserveAspectRatio="xMinYMax meet"
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ pointerEvents: 'none' }}
      fill="none"
      role="img"
      aria-label="Window vine, grows as you read and keeps what it has grown"
    >
      {shown > 0.0005 && (
        <path d={CLASSIC_D} stroke="#2e5934" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={clip(shown, CLASSIC_LEN)} />
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

export function ClassicVineLayer({ target }: { target: number }) {
  const reduced = useReducedMotion();
  const shown = useVineReveal(target, reduced);
  return <ClassicVineDrawing shown={shown} animate={!reduced} />;
}
