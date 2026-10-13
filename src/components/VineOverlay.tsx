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
      <path
        d={vine.d}
        stroke="#2e5934"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={100}
        strokeDasharray={`${(shown * 100).toFixed(2)} 100`}
      />
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
