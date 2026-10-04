import React from 'react';
import type { PlantDef, PotStyle } from '../../data/gardenCatalog';

/**
 * Lightweight inline SVG plant artwork. A handful of "families" are recoloured per plant.
 * Standing plants use a 48x68 box (pot top at y=48). A hanging basket adds room for the ropes (48x86), and
 * trailing vines hang from a pot at the top (48x78). `g` is growth from 0.2 (just earned) to 1 (fully grown).
 */

const STAND_H = 68;
const HANG_H = 86; // standing plant in a hanging basket
const TRAIL_H = 78; // vines hanging below a basket
const TRAIL_POT_Y = 16;
const BASKET_SHIFT = 16;

type P = { g: number; d: PlantDef };

const count = (g: number, max: number, min = 1) => Math.max(min, Math.min(max, Math.round(g * max)));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const frac = (g: number) => Math.min(1, Math.max(0, (g - 0.2) / 0.8)); // 0 when just earned, 1 when fully grown

// ---------------------------------------------------------------------------------------------
// Leaf shapes (pointy by default)
// ---------------------------------------------------------------------------------------------

/** A pointed leaf blade from (x,y) pointing up, rotated `rot` degrees clockwise. `bend` curls the tip sideways. */
function Blade({ x, y, len, w, rot = 0, bend = 0, fill, vein, edge }: { x: number; y: number; len: number; w: number; rot?: number; bend?: number; fill: string; vein?: string; edge?: string }) {
  const d = `M0 0 C${w + bend * 0.2} ${-len * 0.28} ${w * 0.7 + bend * 0.7} ${-len * 0.78} ${bend} ${-len} C${-w * 0.7 + bend * 0.7} ${-len * 0.78} ${-w + bend * 0.2} ${-len * 0.28} 0 0Z`;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <path d={d} fill={fill} stroke={edge} strokeWidth={edge ? 0.6 : 0} strokeLinejoin="round" />
      {vein && <path d={`M0 -1 Q${bend * 0.5} ${-len * 0.5} ${bend} ${-len * 0.9}`} stroke={vein} strokeWidth={0.8} fill="none" opacity={0.55} />}
    </g>
  );
}

/** Heart-shaped leaf with a pointed tip: the stem joins at the notch (x,y), tip points up. */
function HeartLeaf({ x, y, rot = 0, s = 1, fill, vein }: { x: number; y: number; rot?: number; s?: number; fill: string; vein?: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
      <path d="M0 0 C-3 3 -11 2 -11 -6 C-11 -14 -4 -17 0 -25 C4 -17 11 -14 11 -6 C11 2 3 3 0 0Z" fill={fill} />
      {vein && <path d="M0 -1 L0 -21 M0 -8 L-6 -12 M0 -8 L6 -12" stroke={vein} strokeWidth={0.8} fill="none" opacity={0.5} />}
    </g>
  );
}

const Petal5 = ({ r, ry, rx, fill, n = 5, offset = 0 }: { r: number; ry: number; rx: number; fill: string; n?: number; offset?: number }) => (
  <>
    {Array.from({ length: n }, (_, i) => (
      <ellipse key={i} cx={0} cy={-r} rx={rx} ry={ry} transform={`rotate(${offset + (i * 360) / n})`} fill={fill} />
    ))}
  </>
);

// ---------------------------------------------------------------------------------------------
// Pots
// ---------------------------------------------------------------------------------------------
function Pot({ pot, y, basket }: { pot: PotStyle; y: number; basket?: boolean }) {
  const st = pot.stroke ? { stroke: pot.stroke, strokeWidth: 1.2 } : {};
  if (pot.shape === 'cylinder') {
    return (
      <g>
        <rect x={15} y={y - 1} width={18} height={17} rx={3} fill={pot.body} {...st} />
        <rect x={15} y={y - 1} width={18} height={3} rx={1} fill={pot.rim} />
      </g>
    );
  }
  if (pot.shape === 'bowl') {
    return (
      <g>
        <path d={`M13 ${y} H35 Q34 ${y + 16} 24 ${y + 16} Q14 ${y + 16} 13 ${y} Z`} fill={pot.body} {...st} />
        {basket && <path d={`M16 ${y + 4} H32 M17 ${y + 8} H31 M19 ${y + 12} H29`} stroke="#00000022" strokeWidth={1} />}
        <rect x={12.5} y={y} width={23} height={3.5} rx={1} fill={pot.rim} />
      </g>
    );
  }
  return (
    <g>
      <path d={`M14 ${y} H34 L31 ${y + 16} H17 Z`} fill={pot.body} {...st} />
      <rect x={13.5} y={y} width={21} height={3.5} rx={1} fill={pot.rim} />
    </g>
  );
}

// ---------------------------------------------------------------------------------------------
// Families that stand on the shelf (drawn above y=48)
// ---------------------------------------------------------------------------------------------
const TONES = ['#3f6b45', '#4e7f55', '#5b9363', '#71ab7a'];

function Sprout({ g, d }: P) {
  const n = count(g, 8);
  const top = 46 - n * 3.4;
  return (
    <g>
      <path d={`M24 48 L24 ${top}`} stroke={d.leaf2} strokeWidth={2.4} strokeLinecap="round" />
      {Array.from({ length: n }, (_, i) => {
        const side = i % 2 ? 1 : -1;
        return <Blade key={i} x={24} y={45 - i * 3.4} len={11 + (i % 3)} w={3.6} rot={side * 62} fill={TONES[i % 4]} vein={d.leaf2} />;
      })}
      <Blade x={24} y={top + 1} len={9} w={3.2} rot={0} fill={TONES[3]} />
      {g >= 1 && (
        <g transform={`translate(24 ${top - 5})`}>
          <Petal5 r={5.5} rx={4.4} ry={5.6} fill={d.bloom ?? '#e7a1b4'} />
          <circle r={3.2} fill="#ffd66b" />
        </g>
      )}
    </g>
  );
}

function Blossom({ g, d }: P) {
  const f = frac(g);
  const top = 46 - (18 + f * 18);
  return (
    <g>
      <path d={`M24 48 C25 ${(48 + top) / 2 + 3} 23 ${(48 + top) / 2 - 3} 24 ${top}`} stroke={d.leaf2} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      {[0.25, 0.45, 0.65].map((t, i) =>
        f >= t - 0.2 ? <Blade key={i} x={24} y={46 - (18 + f * 18) * t} len={10} w={3.4} rot={(i % 2 ? 1 : -1) * 58} fill={i % 2 ? d.leaf : TONES[0]} vein={d.leaf2} /> : null,
      )}
      {f >= 0.25 && f < 0.7 && (
        <g transform={`translate(24 ${top})`}>
          <ellipse cx={0} cy={-3} rx={3.6} ry={5.6} fill={d.bloom} />
          <path d="M-3 0 L0 -9 L3 0Z" fill={d.bloom2} opacity={0.8} />
        </g>
      )}
      {f >= 0.7 && (
        <g transform={`translate(24 ${top - 1}) scale(${0.8 + 0.3 * f})`}>
          <Petal5 r={6.5} rx={5.3} ry={6.8} fill={f >= 1 ? d.bloom! : d.bloom2!} offset={36} />
          <Petal5 r={3} rx={2.6} ry={3.6} fill={d.bloom2!} />
          <circle r={2.4} fill="#ffd66b" />
        </g>
      )}
    </g>
  );
}

function Sunflower({ g, d }: P) {
  const f = frac(g);
  const stage = f < 0.34 ? 1 : f < 0.67 ? 2 : f < 1 ? 3 : 4;
  const hy = 48 - (24 + f * 6);
  const R = 4 + stage * 1.9;
  return (
    <g>
      <path d={`M24 48 L24 ${hy}`} stroke={d.leaf2} strokeWidth={3.2} strokeLinecap="round" />
      <Blade x={24} y={42} len={15} w={6.2} rot={-62} fill={d.leaf} vein={d.leaf2} />
      <Blade x={24} y={36} len={14} w={5.8} rot={64} fill="#589e62" vein={d.leaf2} />
      {stage >= 2 && (
        <g transform={`translate(24 ${hy})`}>
          {Array.from({ length: 16 }, (_, i) => (
            <Blade key={i} x={0} y={0} len={R + 5.5} w={2.5} rot={i * 22.5} fill={i % 2 ? d.bloom! : '#ffc83a'} />
          ))}
          <circle r={R * 0.62} fill="#5a3d1a" />
          <circle r={R * 0.4} fill="#3b260e" />
          <circle cx={-1.2} cy={-1.2} r={0.9} fill="#7a5628" />
          <circle cx={1.4} cy={0.8} r={0.9} fill="#7a5628" />
        </g>
      )}
      {stage === 1 && <ellipse cx={24} cy={hy - 2} rx={4} ry={5.5} fill="#5c8f48" />}
    </g>
  );
}

function Rose({ g, d }: P) {
  const f = frac(g);
  const top = 48 - (24 + f * 6);
  const full = f >= 0.55;
  return (
    <g>
      <path d={`M24 48 C25 ${(48 + top) / 2 + 2} 23 ${(48 + top) / 2 - 2} 24 ${top}`} stroke={d.leaf2} strokeWidth={2.6} strokeLinecap="round" fill="none" />
      <path d="M24 38 l-3 -2 M24 31 l3 -2" stroke={d.leaf2} strokeWidth={1.4} strokeLinecap="round" />
      {[{ y: 40, s: -1 }, { y: 32, s: 1 }].map((l, i) => (
        <g key={i}>
          <Blade x={24} y={l.y} len={11} w={3.8} rot={l.s * 58} fill={i ? '#46824f' : d.leaf} vein={d.leaf2} />
          <Blade x={24 + l.s * 6} y={l.y - 3} len={8} w={3} rot={l.s * 38} fill={d.leaf} />
        </g>
      ))}
      <g transform={`translate(24 ${top - 2}) scale(${0.65 + 0.4 * f})`}>
        {full ? (
          <>
            <circle r={12.5} fill="#a3173a" />
            <circle cx={-2} cy={-1} r={10} fill="#c81f47" />
            <circle cx={2.5} cy={1} r={8} fill="#df2f57" />
            <path d="M-7 -2 C-4 -9 4 -9 7 -2 C4 -5 -4 -5 -7 -2Z" fill="#e94b72" />
            <path d="M-6 3 C-5 -3 5 -3 6 3 C3 0 -3 0 -6 3Z" fill="#b81d3f" />
            <circle cx={0} cy={0} r={3.4} fill="#8a1230" />
            <path d="M-2 -1 C0 -3 2 -3 2 0" stroke="#e94b72" strokeWidth={0.9} fill="none" />
          </>
        ) : (
          <>
            <ellipse cx={0} cy={0} rx={7} ry={9} fill="#c42549" />
            <path d="M-7 3 C-6 -6 0 -9 0 -9 C0 -9 6 -6 7 3 Z" fill="#9e1534" />
            <path d="M-8 4 C-9 -2 -5 -5 -3 -2 M8 4 C9 -2 5 -5 3 -2" stroke={d.leaf} strokeWidth={2.2} fill="none" strokeLinecap="round" />
          </>
        )}
      </g>
    </g>
  );
}

const SPEARS = [
  { x0: 24, tx: 24, ty: 8 }, { x0: 21, tx: 16, ty: 12 }, { x0: 27, tx: 32, ty: 12 },
  { x0: 19, tx: 11, ty: 22 }, { x0: 29, tx: 37, ty: 22 },
];
function Spears({ g, d }: P) {
  if (d.opt?.trim) return <SnakePlant g={g} d={d} />;
  const n = count(g, 5, 2);
  const w = d.opt?.fat ? 3.6 : 1.9;
  const tones = [d.leaf2, d.leaf, d.leaf, '#4d9462', '#4d9462'];
  return (
    <g>
      {SPEARS.slice(0, n).map((s, i) => {
        const mx = (s.x0 + s.tx) / 2;
        const my = (48 + s.ty) / 2;
        return (
          <g key={i}>
            <path
              d={`M${s.x0 - w} 48 Q${mx - w - 2} ${my} ${s.tx} ${s.ty} Q${mx + w + 2} ${my} ${s.x0 + w} 48 Z`}
              fill={tones[i]}
              stroke={d.opt?.trim ? d.bloom : undefined}
              strokeWidth={d.opt?.trim ? 1.1 : 0}
            />
            {d.opt?.fat && <path d={`M${mx} ${my + 6} l-1 -2 M${mx + 1} ${my - 2} l1 -2`} stroke="#fff" strokeWidth={0.9} opacity={0.5} />}
          </g>
        );
      }).reverse()}
    </g>
  );
}

/** One snake-plant sword leaf: a tapered blade along a curved spine, with darker cross bands and a golden edge. */
function SwordLeaf({ x0, tx, ty, w, fill, band, edge }: { x0: number; tx: number; ty: number; w: number; fill: string; band: string; edge?: string }) {
  const cx = x0 + (tx - x0) * 0.25;
  const cy = 48 + (ty - 48) * 0.55;
  const spine = (t: number) => ({
    x: (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * tx,
    y: (1 - t) * (1 - t) * 48 + 2 * (1 - t) * t * cy + t * t * ty,
  });
  const half = (t: number) => w * (0.4 + 0.6 * Math.sin(Math.PI * Math.pow(t, 0.7))) * (1 - Math.pow(t, 3));
  const N = 14;
  const L: string[] = [];
  const R: string[] = [];
  const bands: React.ReactNode[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = spine(t);
    const b = spine(Math.min(1, t + 0.01));
    const c = spine(Math.max(0, t - 0.01));
    const dx = b.x - c.x;
    const dy = b.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const h = half(t);
    L.push(`${(a.x + nx * h).toFixed(1)} ${(a.y + ny * h).toFixed(1)}`);
    R.push(`${(a.x - nx * h).toFixed(1)} ${(a.y - ny * h).toFixed(1)}`);
    if (i >= 2 && i <= N - 3 && i % 2 === 0) {
      bands.push(
        <path
          key={i}
          d={`M${(a.x + nx * h * 0.8).toFixed(1)} ${(a.y + ny * h * 0.8).toFixed(1)} L${(a.x - nx * h * 0.8).toFixed(1)} ${(a.y - ny * h * 0.8).toFixed(1)}`}
          stroke={band}
          strokeWidth={0.9}
          strokeLinecap="round"
          opacity={0.45}
        />,
      );
    }
  }
  const d = 'M' + L.join(' L') + ' L' + R.reverse().join(' L') + ' Z';
  return (
    <g>
      <path d={d} fill={fill} stroke={edge} strokeWidth={edge ? 1 : 0} strokeLinejoin="round" />
      {bands}
    </g>
  );
}

const SWORDS = [
  { x0: 24, tx: 24, ty: 3, w: 4.6 }, { x0: 21, tx: 14, ty: 9, w: 4.2 }, { x0: 27, tx: 34, ty: 9, w: 4.2 },
  { x0: 19, tx: 9, ty: 19, w: 3.8 }, { x0: 29, tx: 39, ty: 19, w: 3.8 }, { x0: 23, tx: 19, ty: 15, w: 3.4 }, { x0: 25, tx: 29, ty: 15, w: 3.4 },
];
function SnakePlant({ g, d }: P) {
  const n = count(g, 7, 3);
  const order = [0, 1, 2, 3, 4, 5, 6].slice(0, n);
  const tones = [d.leaf, d.leaf2, d.leaf, d.leaf2, d.leaf, '#4d9462', '#4d9462'];
  // outer leaves first so the tall centre leaf is in front
  return (
    <g>
      {order.slice().reverse().map(i => (
        <SwordLeaf key={i} {...SWORDS[i]} fill={tones[i]} band="#173d28" edge={d.bloom} />
      ))}
    </g>
  );
}

const FAN = [
  { bx: 20, by: 26, r: -20, s: 0.78 }, { bx: 28, by: 26, r: 20, s: 0.78 },
  { bx: 18, by: 34, r: -46, s: 0.92 }, { bx: 30, by: 34, r: 46, s: 0.92 }, { bx: 24, by: 30, r: 0, s: 1 },
];
function Fan({ g, d }: P) {
  const n = count(g, 5, 2);
  const shape = String(d.opt?.shape ?? 'heart');
  const order = [4, 2, 3, 0, 1].filter(i => i < n || i === 4);
  const shown = FAN.map((l, i) => ({ ...l, i })).filter(l => (l.i === 4 ? true : l.i < n));
  const draw = (l: (typeof FAN)[number] & { i: number }) => {
    const fill = l.i % 2 ? d.leaf : d.leaf2;
    return (
      <g key={l.i}>
        <path d={`M24 48 Q${(24 + l.bx) / 2 - Math.sign(l.r) * 2} ${(48 + l.by) / 2} ${l.bx} ${l.by}`} stroke={d.leaf2} strokeWidth={1.5} fill="none" strokeLinecap="round" />
        {shape === 'stripe' ? (
          <g transform={`translate(${l.bx} ${l.by}) rotate(${l.r}) scale(${l.s})`}>
            <Blade x={0} y={0} len={27} w={8} fill={fill} />
            <path d="M0 -2 L0 -24 M0 -7 L-5 -11 M0 -7 L5 -11 M0 -13 L-4 -17 M0 -13 L4 -17" stroke={d.bloom} strokeWidth={1.1} strokeLinecap="round" fill="none" />
          </g>
        ) : (
          <>
            <HeartLeaf x={l.bx} y={l.by} rot={l.r} s={l.s * (shape === 'split' ? 1 : 0.92)} fill={fill} vein={shape === 'heart' ? d.leaf2 : undefined} />
            {shape === 'split' && (
              <g transform={`translate(${l.bx} ${l.by}) rotate(${l.r}) scale(${l.s})`} stroke="#efe7d3" strokeWidth={1.7} strokeLinecap="round" opacity={0.7}>
                <path d="M-11 -6 L-4 -7 M-10 -12 L-3 -11 M11 -6 L4 -7 M10 -12 L3 -11 M-6 -17 L-2 -15 M6 -17 L2 -15" />
                <circle cx={-3} cy={-3} r={1} fill="#efe7d3" stroke="none" />
                <circle cx={3} cy={-3} r={1} fill="#efe7d3" stroke="none" />
              </g>
            )}
          </>
        )}
      </g>
    );
  };
  void order;
  return <g>{[...shown].sort((a, b) => [4, 2, 3, 0, 1].indexOf(b.i) - [4, 2, 3, 0, 1].indexOf(a.i)).map(draw)}</g>;
}

const FRONDS = [
  { cx: 24, cy: 30, tx: 24, ty: 10 }, { cx: 14, cy: 33, tx: 6, ty: 18 }, { cx: 34, cy: 33, tx: 42, ty: 18 },
  { cx: 11, cy: 41, tx: 2, ty: 33 }, { cx: 37, cy: 41, tx: 46, ty: 33 },
];
function Fern({ g, d }: P) {
  const n = count(g, 5, 2);
  let stems = '';
  let leaflets = '';
  FRONDS.slice(0, n).forEach(f => {
    stems += `M24 48 Q${f.cx} ${f.cy} ${f.tx} ${f.ty} `;
    for (let t = 0.28; t <= 0.97; t += 0.1) {
      const x = (1 - t) * (1 - t) * 24 + 2 * (1 - t) * t * f.cx + t * t * f.tx;
      const y = (1 - t) * (1 - t) * 48 + 2 * (1 - t) * t * f.cy + t * t * f.ty;
      const dx = 2 * (1 - t) * (f.cx - 24) + 2 * t * (f.tx - f.cx);
      const dy = 2 * (1 - t) * (f.cy - 48) + 2 * t * (f.ty - f.cy);
      const len = Math.hypot(dx, dy) || 1;
      const k = 5.2 * (1 - t * 0.5);
      const nx = (-dy / len) * k;
      const ny = (dx / len) * k;
      // leaflets slant toward the tip so they read as pointed
      const tx = (dx / len) * 2.2;
      const ty = (dy / len) * 2.2;
      leaflets += `M${x.toFixed(1)} ${y.toFixed(1)} L${(x - nx + tx).toFixed(1)} ${(y - ny + ty).toFixed(1)} M${x.toFixed(1)} ${y.toFixed(1)} L${(x + nx + tx).toFixed(1)} ${(y + ny + ty).toFixed(1)} `;
    }
  });
  return (
    <g fill="none" strokeLinecap="round">
      <path d={stems} stroke={d.leaf2} strokeWidth={1.4} />
      <path d={leaflets} stroke={d.leaf} strokeWidth={2.6} />
    </g>
  );
}

const STEMS = [{ x: 24, h: 28 }, { x: 17, h: 22 }, { x: 31, h: 22 }, { x: 11, h: 15 }, { x: 37, h: 15 }];
function Bush({ g, d }: P) {
  const n = count(g, 5, 2);
  const shape = String(d.opt?.shape ?? 'round');
  return (
    <g>
      {STEMS.slice(0, n).map((s, i) => {
        const bx = 24 + (s.x - 24) * 0.3;
        const pairs = Math.max(2, Math.floor(s.h / 5.5));
        return (
          <g key={i}>
            <path d={`M${bx} 48 L${s.x} ${48 - s.h}`} stroke={d.leaf2} strokeWidth={1.5} strokeLinecap="round" />
            {Array.from({ length: pairs }, (_, k) => {
              const t = (k + 1) / pairs;
              const x = bx + (s.x - bx) * t;
              const y = 48 - s.h * t;
              if (shape === 'needle') {
                return <path key={k} d={`M${x} ${y} l-6 -4 M${x} ${y} l6 -4 M${x} ${y} l-5 1 M${x} ${y} l5 1`} stroke={d.leaf} strokeWidth={1.3} strokeLinecap="round" />;
              }
              const len = shape === 'oval' ? 9 : 10;
              const w = shape === 'oval' ? 3.6 : 4.4;
              return (
                <g key={k}>
                  <Blade x={x} y={y} len={len} w={w} rot={-58} fill={k % 2 ? d.leaf : d.leaf2} vein={d.leaf2} />
                  <Blade x={x} y={y} len={len} w={w} rot={58} fill={k % 2 ? d.leaf2 : d.leaf} vein={d.leaf2} />
                </g>
              );
            })}
            {shape === 'needle' ? (
              <path d={`M${s.x} ${48 - s.h} l0 -5`} stroke={d.leaf} strokeWidth={1.4} strokeLinecap="round" />
            ) : (
              <Blade x={s.x} y={48 - s.h} len={8} w={3.2} rot={0} fill={d.leaf} />
            )}
          </g>
        );
      })}
      {shape === 'needle' && g >= 1 && [[24, 18], [17, 24], [31, 24]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={1.6} fill="#9bb7e6" />)}
    </g>
  );
}

/** Flower stem with its height following growth; returns the head position. */
function useStem(g: number, d: PlantDef, leafy = true) {
  const f = frac(g);
  const h = 18 + f * 17;
  const top = 48 - h;
  const s = 0.62 + f * 0.5;
  const stem = (
    <g>
      <path d={`M24 48 C25 ${(48 + top) / 2 + 3} 23 ${(48 + top) / 2 - 3} 24 ${top}`} stroke={d.leaf2} strokeWidth={2.3} strokeLinecap="round" fill="none" />
      {leafy && <Blade x={24} y={47} len={14 + f * 8} w={5} rot={-44} bend={-3} fill={d.leaf} vein={d.leaf2} />}
      {leafy && f > 0.3 && <Blade x={24} y={47} len={12 + f * 8} w={4.6} rot={40} bend={3} fill={d.leaf2} />}
    </g>
  );
  return { top, s, f, stem };
}

function Daisy({ g, d }: P) {
  const { top, s, stem } = useStem(g, d);
  return (
    <g>
      {stem}
      <g transform={`translate(24 ${top - 2}) scale(${s})`}>
        {Array.from({ length: 14 }, (_, i) => (
          <Blade key={i} x={0} y={0} len={13} w={2.6} rot={i * (360 / 14)} fill={d.bloom!} edge="#cfc3a3" />
        ))}
        {Array.from({ length: 14 }, (_, i) => (
          <path key={'l' + i} d="M0 -3 L0 -10" transform={`rotate(${i * (360 / 14)})`} stroke="#e8dec3" strokeWidth={0.6} />
        ))}
        <circle r={4.6} fill={d.bloom2} />
        <circle r={2.2} fill="#d9a21a" />
      </g>
    </g>
  );
}

/** The tulip: long pointed blade leaves and a big cup flower. */
function Tulip({ g, d }: P) {
  const f = frac(g);
  const top = 48 - (12 + f * 13);
  const s = 0.56 + f * 0.42; // a smaller cup than before (fully grown is about 80% of the old size)
  return (
    <g>
      <Blade x={24} y={48} len={22 + f * 12} w={6.4} rot={-26} bend={-6} fill={d.leaf} vein={d.leaf2} />
      <Blade x={24} y={48} len={20 + f * 12} w={6.2} rot={24} bend={6} fill={d.leaf2} vein={d.leaf} />
      <Blade x={24} y={48} len={16 + f * 12} w={5.2} rot={-5} bend={-1.5} fill="#5fb06b" vein={d.leaf2} />
      <path d={`M24 48 C25 ${(48 + top) / 2 + 2} 23 ${(48 + top) / 2 - 2} 24 ${top}`} stroke={d.leaf2} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      <g transform={`translate(24 ${top + 1}) scale(${s})`}>
        <path d="M-9.5 -2 C-12 -14 -7.5 -21 -5 -24 L0 -16 L5 -24 C7.5 -21 12 -14 9.5 -2 C6.5 7 -6.5 7 -9.5 -2 Z" fill={d.bloom} />
        <path d="M-3.4 -18 Q0 -4 3.4 -18 Q6 -8 0 4 Q-6 -8 -3.4 -18Z" fill={d.bloom2} />
        <path d="M-9.5 -2 C-6 4 6 4 9.5 -2" stroke="#00000018" strokeWidth={1.2} fill="none" />
      </g>
    </g>
  );
}

function Hibiscus({ g, d }: P) {
  const { top, s, stem, f } = useStem(g, d, false);
  return (
    <g>
      {stem}
      <Blade x={24} y={top + 14} len={11} w={4.4} rot={-60} fill={d.leaf} vein={d.leaf2} />
      <Blade x={24} y={top + 20} len={11} w={4.4} rot={60} fill={d.leaf2} vein={d.leaf} />
      <Blade x={24} y={46} len={13} w={4.6} rot={-48} fill={d.leaf2} />
      <g transform={`translate(24 ${top - 1}) scale(${s * 1.05})`}>
        {f > 0.3 ? (
          <>
            <Petal5 r={7.5} rx={7} ry={8.5} fill={d.bloom!} offset={12} />
            <Petal5 r={4} rx={3.4} ry={4.6} fill="#c2294a" offset={12} />
            <circle r={2} fill="#7a0f2b" />
            <path d="M0 0 Q4 -6 9 -10" stroke={d.bloom2} strokeWidth={1.4} strokeLinecap="round" fill="none" />
            {[[9, -10], [7.2, -8.6], [10.4, -8.4]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={1.3} fill={d.bloom2} />)}
          </>
        ) : (
          <ellipse cx={0} cy={-4} rx={4} ry={7} fill={d.bloom} />
        )}
      </g>
    </g>
  );
}

function Lavender({ g, d }: P) {
  const n = count(g, 5, 2);
  const spikes = [{ x: 24, h: 34 }, { x: 16, h: 28 }, { x: 32, h: 28 }, { x: 10, h: 21 }, { x: 38, h: 21 }].slice(0, n);
  return (
    <g>
      <Blade x={24} y={48} len={16} w={2.6} rot={-38} fill={d.leaf} />
      <Blade x={24} y={48} len={16} w={2.6} rot={38} fill={d.leaf} />
      <Blade x={24} y={48} len={20} w={2.6} rot={-16} fill={d.leaf2} />
      <Blade x={24} y={48} len={20} w={2.6} rot={16} fill={d.leaf2} />
      {spikes.map((s, i) => {
        const bx = 24 + (s.x - 24) * 0.3;
        const top = 48 - s.h;
        return (
          <g key={i}>
            <path d={`M${bx} 48 L${s.x} ${top}`} stroke={d.leaf} strokeWidth={1.6} strokeLinecap="round" />
            {Array.from({ length: 7 }, (_, k) => (
              <g key={k}>
                <ellipse cx={s.x - 2.4} cy={top + k * 2.7} rx={2.4} ry={1.8} transform={`rotate(-25 ${s.x - 2.4} ${top + k * 2.7})`} fill={k % 2 ? d.bloom : d.bloom2} />
                <ellipse cx={s.x + 2.4} cy={top + k * 2.7 + 1.3} rx={2.4} ry={1.8} transform={`rotate(25 ${s.x + 2.4} ${top + k * 2.7 + 1.3})`} fill={k % 2 ? d.bloom2 : d.bloom} />
              </g>
            ))}
            <Blade x={s.x} y={top} len={6} w={2} fill={d.bloom!} />
          </g>
        );
      })}
    </g>
  );
}

function Poppy({ g, d }: P) {
  const { top, s, f, stem } = useStem(g, d, false);
  return (
    <g>
      {stem}
      {[-1, 1].map(side => (
        <g key={side}>
          <Blade x={24} y={47} len={17} w={5} rot={side * 48} bend={side * 3} fill={side < 0 ? d.leaf : d.leaf2} />
          <path d={`M24 47 l${side * 7} -10 l-3 0 M24 47 l${side * 11} -6`} stroke={d.leaf2} strokeWidth={0.8} opacity={0.5} fill="none" />
        </g>
      ))}
      <g transform={`translate(24 ${top - 1}) scale(${s * 1.1})`}>
        {f > 0.3 ? (
          <>
            <circle cx={-4.5} cy={-3} r={8} fill={d.bloom} />
            <circle cx={4.5} cy={-3} r={8} fill="#f0553f" />
            <circle cx={-3.5} cy={4} r={7.2} fill="#f0553f" />
            <circle cx={3.5} cy={4} r={7.2} fill={d.bloom} />
            <circle r={3.8} fill={d.bloom2} />
            {Array.from({ length: 8 }, (_, i) => <circle key={i} cx={Math.cos((i * Math.PI) / 4) * 6} cy={Math.sin((i * Math.PI) / 4) * 6} r={0.9} fill={d.bloom2} />)}
          </>
        ) : (
          <ellipse cx={0} cy={-3} rx={4.5} ry={6.5} fill="#d0402d" />
        )}
      </g>
    </g>
  );
}

function Orchid({ g, d }: P) {
  const f = frac(g);
  const n = count(f + 0.2, 4, 1);
  const pts = [{ x: 27, y: 24 }, { x: 33, y: 17 }, { x: 37, y: 28 }, { x: 22, y: 14 }].slice(0, n);
  return (
    <g>
      <Blade x={24} y={48} len={20} w={7} rot={-46} bend={-4} fill={d.leaf} vein={d.leaf2} />
      <Blade x={24} y={48} len={19} w={6.6} rot={44} bend={4} fill={d.leaf2} vein={d.leaf} />
      <Blade x={24} y={48} len={15} w={6} rot={-12} fill={d.leaf} />
      <path d="M24 48 C22 34 26 22 34 12" stroke="#5a8a54" strokeWidth={1.8} fill="none" strokeLinecap="round" />
      {pts.map((p, i) => (
        <g key={i} transform={`translate(${p.x} ${p.y}) rotate(${i * 18 - 20}) scale(${0.72 + 0.3 * f})`}>
          <ellipse cx={-5} cy={-3} rx={6} ry={4.4} transform="rotate(-24 -5 -3)" fill={d.bloom} stroke="#cfa9d6" strokeWidth={0.7} />
          <ellipse cx={5} cy={-3} rx={6} ry={4.4} transform="rotate(24 5 -3)" fill={d.bloom} stroke="#cfa9d6" strokeWidth={0.7} />
          <ellipse cx={0} cy={-6} rx={3.4} ry={5} fill={d.bloom} stroke="#cfa9d6" strokeWidth={0.7} />
          <path d="M-3.6 0 C-2 6 2 6 3.6 0 C2 -2 -2 -2 -3.6 0Z" fill={d.bloom2} />
          <circle cx={0} cy={-1} r={1.3} fill="#f2d96b" />
        </g>
      ))}
    </g>
  );
}

function Lily({ g, d }: P) {
  const f = frac(g);
  const n = count(g, 5, 3);
  const leaves = [{ r: 0, len: 26 }, { r: -30, len: 24 }, { r: 30, len: 24 }, { r: -55, len: 20 }, { r: 55, len: 20 }].slice(0, n);
  return (
    <g>
      {leaves.map((l, i) => <Blade key={i} x={24} y={48} len={l.len} w={7} rot={l.r} bend={l.r / 18} fill={i % 2 ? d.leaf : d.leaf2} vein="#9fd0a8" />).reverse()}
      {f > 0.25 && (
        <g>
          <path d="M26 48 C27 38 29 28 29 20" stroke={d.leaf2} strokeWidth={1.8} fill="none" strokeLinecap="round" />
          <g transform="translate(29 21) rotate(8)">
            <path d="M0 3 C-8 0 -9 -13 0 -21 C9 -13 8 0 0 3Z" fill={d.bloom} stroke="#c9c3a6" strokeWidth={0.8} />
            <path d="M0 -1 L0 -14" stroke="#e1ddc8" strokeWidth={0.8} />
            <rect x={-1.6} y={-13} width={3.2} height={10} rx={1.6} fill={d.bloom2} />
          </g>
        </g>
      )}
      {f > 0.7 && (
        <g>
          <path d="M22 48 C20 40 17 33 16 27" stroke={d.leaf2} strokeWidth={1.6} fill="none" strokeLinecap="round" />
          <g transform="translate(16 28) rotate(-10) scale(0.75)">
            <path d="M0 3 C-8 0 -9 -13 0 -21 C9 -13 8 0 0 3Z" fill={d.bloom} stroke="#c9c3a6" strokeWidth={0.8} />
            <rect x={-1.6} y={-13} width={3.2} height={10} rx={1.6} fill={d.bloom2} />
          </g>
        </g>
      )}
    </g>
  );
}

function Clover({ g, d }: P) {
  const spots = [{ x: 24, y: 22 }, { x: 12, y: 32 }, { x: 36, y: 32 }, { x: 18, y: 18 }, { x: 31, y: 17 }].slice(0, count(g, 5, 2));
  const lucky = g >= 1;
  return (
    <g>
      {spots.map((p, i) => (
        <g key={i}>
          <path d={`M24 48 Q${(24 + p.x) / 2} ${(48 + p.y) / 2 + 5} ${p.x} ${p.y + 5}`} stroke={d.leaf2} strokeWidth={1.6} fill="none" strokeLinecap="round" />
          <g transform={`translate(${p.x} ${p.y + 2}) scale(0.82)`}>
            {(lucky && i === 0 ? [0, 90, 180, 270] : [0, 120, 240]).map(a => (
              <g key={a} transform={`rotate(${a + 180})`}>
                <path d="M0 0 C-9 -2 -9 -12 0 -9 C9 -12 9 -2 0 0Z" fill={i % 2 ? d.leaf : '#5cc06d'} />
                <path d="M0 -1 L0 -7" stroke="#2f7d41" strokeWidth={0.7} opacity={0.5} />
              </g>
            ))}
          </g>
        </g>
      ))}
    </g>
  );
}

function Mushroom({ g, d }: P) {
  const caps = [{ x: 24, h: 17, r: 11 }, { x: 11, h: 9, r: 7.5 }, { x: 37, h: 12, r: 8.5 }].slice(0, count(g, 3));
  return (
    <g>
      {caps.map((c, i) => (
        <g key={i}>
          <path d={`M${c.x - 2.8} ${49} Q${c.x - 1.6} ${48 - c.h / 2} ${c.x - 2.2} ${48 - c.h} L${c.x + 2.2} ${48 - c.h} Q${c.x + 1.6} ${48 - c.h / 2} ${c.x + 2.8} ${49}Z`} fill="#f4ecd8" />
          <path d={`M${c.x - c.r} ${48 - c.h + 1.5} Q${c.x} ${48 - c.h - c.r * 1.55} ${c.x + c.r} ${48 - c.h + 1.5} Q${c.x} ${48 - c.h + 4} ${c.x - c.r} ${48 - c.h + 1.5}Z`} fill={d.bloom} />
          <circle cx={c.x - c.r * 0.38} cy={48 - c.h - c.r * 0.5} r={c.r * 0.17} fill="#fff" />
          <circle cx={c.x + c.r * 0.34} cy={48 - c.h - c.r * 0.34} r={c.r * 0.13} fill="#fff" />
          <circle cx={c.x + c.r * 0.02} cy={48 - c.h - c.r * 0.9} r={c.r * 0.11} fill="#fff" />
        </g>
      ))}
    </g>
  );
}

function Bamboo({ g, d }: P) {
  const stalks = [{ x: 24, h: 38 }, { x: 17, h: 29 }, { x: 31, h: 31 }].slice(0, count(g, 3));
  return (
    <g>
      {stalks.map((s, i) => {
        const h = s.h * (0.55 + 0.45 * g);
        return (
          <g key={i}>
            <rect x={s.x - 2.2} y={48 - h} width={4.4} height={h + 1} rx={1.7} fill={d.leaf} />
            {[0.28, 0.55, 0.82].map(t => <rect key={t} x={s.x - 2.7} y={48 - h * t} width={5.4} height={1.5} rx={0.7} fill={d.leaf2} />)}
            <Blade x={s.x} y={48 - h * 0.82} len={11} w={2.8} rot={62} fill={d.leaf2} />
            <Blade x={s.x} y={48 - h * 0.55} len={10} w={2.6} rot={-62} fill={d.leaf2} />
            <Blade x={s.x} y={48 - h} len={9} w={2.6} rot={-14} fill={d.leaf} />
            <Blade x={s.x} y={48 - h} len={9} w={2.6} rot={20} fill={d.leaf} />
          </g>
        );
      })}
    </g>
  );
}

function Cactus({ g, d }: P) {
  const f = frac(g);
  const h = 22 + f * 12;
  const spines = (x: number, y0: number, y1: number) =>
    Array.from({ length: Math.floor((y0 - y1) / 5) }, (_, i) => <path key={i} d={`M${x - 3} ${y0 - i * 5 - 2} l-1.6 -0.9 M${x + 3} ${y0 - i * 5 - 4.5} l1.6 -0.9`} stroke="#f3ecd2" strokeWidth={0.8} strokeLinecap="round" />);
  return (
    <g>
      {f > 0.45 && (
        <>
          <path d={`M21 ${48 - h * 0.45} C13 ${48 - h * 0.45} 12 ${48 - h * 0.55} 12 ${48 - h * 0.85} a3.2 3.2 0 0 1 6.4 0 C18.4 ${48 - h * 0.6} 19 ${48 - h * 0.62} 22 ${48 - h * 0.62}Z`} fill={d.leaf} />
        </>
      )}
      {f > 0.7 && (
        <path d={`M27 ${48 - h * 0.35} C35 ${48 - h * 0.35} 36 ${48 - h * 0.45} 36 ${48 - h * 0.7} a3.2 3.2 0 0 0 -6.4 0 C29.6 ${48 - h * 0.5} 29 ${48 - h * 0.52} 26 ${48 - h * 0.52}Z`} fill={d.leaf} />
      )}
      <path d={`M19 49 L19 ${48 - h + 6} a5 5 0 0 1 10 0 L29 49Z`} fill={d.leaf} />
      <path d={`M24 49 L24 ${48 - h + 1} M21.5 49 L21.5 ${48 - h + 3} M26.5 49 L26.5 ${48 - h + 3}`} stroke={d.leaf2} strokeWidth={1} opacity={0.7} />
      {spines(24, 46, 48 - h + 5)}
      {f >= 0.85 && (
        <g transform={`translate(24 ${48 - h - 1})`}>
          <Petal5 r={4.4} rx={3.4} ry={4.6} fill={d.bloom!} />
          <circle r={2.2} fill="#ffd66b" />
        </g>
      )}
    </g>
  );
}

function Jade({ g, d }: P) {
  const f = frac(g);
  const clusters = [{ x: 24, y: 17 }, { x: 14, y: 26 }, { x: 34, y: 25 }, { x: 19, y: 32 }, { x: 30, y: 33 }].slice(0, count(g, 5, 2));
  return (
    <g>
      <path d="M24 49 C23 40 24 30 24 20 M24 38 C20 34 16 30 14 27 M24 36 C28 32 32 29 34 26 M23 42 L19 33 M25 42 L30 34" stroke={d.bloom} strokeWidth={3} strokeLinecap="round" fill="none" />
      {clusters.map((c, i) => (
        <g key={i}>
          {[[-4.4, 1.5, -28], [4.4, 1.5, 28], [0, -4.6, 0], [-3.2, -3, -14], [3.2, -3, 14]].map(([dx, dy, r], k) => (
            <ellipse key={k} cx={c.x + dx} cy={c.y + dy} rx={4} ry={5.4} transform={`rotate(${r} ${c.x + dx} ${c.y + dy})`} fill={(i + k) % 2 ? d.leaf : '#5ab36e'} stroke={d.leaf2} strokeWidth={0.6} />
          ))}
        </g>
      ))}
      {f >= 1 && [[24, 8], [14, 19], [34, 18]].map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}><Petal5 r={2.4} rx={1.5} ry={2.4} fill="#ffe3ee" /><circle r={1} fill="#f2a1bd" /></g>
      ))}
    </g>
  );
}

function Bonsai({ g, d }: P) {
  const f = frac(g);
  const s = 0.62 + f * 0.38;
  return (
    <g>
      <path d="M24 49 C22 44 27 41 24 36 C21 31 27 27 25 21" stroke={d.bloom} strokeWidth={3.6} strokeLinecap="round" fill="none" />
      <path d="M25 36 C31 35 33 31 36 29" stroke={d.bloom} strokeWidth={2.2} strokeLinecap="round" fill="none" />
      <path d="M23 30 C18 29 15 27 12 26" stroke={d.bloom} strokeWidth={2} strokeLinecap="round" fill="none" />
      <g transform={`translate(0 ${(1 - s) * 16})`}>
        {[[25, 16, 12, 8.5], [12, 23, 8.5, 6], [37, 25, 8.5, 6.2]].map(([x, y, rx, ry], i) => (
          <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
            <ellipse cx={0} cy={0} rx={rx} ry={ry} fill={i % 2 ? d.leaf : d.leaf2} />
            <ellipse cx={-rx * 0.28} cy={-ry * 0.3} rx={rx * 0.6} ry={ry * 0.55} fill={d.leaf} opacity={0.9} />
            <circle cx={rx * 0.3} cy={-ry * 0.25} r={1} fill="#7fcf8a" />
            <circle cx={-rx * 0.5} cy={ry * 0.2} r={0.9} fill="#7fcf8a" />
          </g>
        ))}
      </g>
    </g>
  );
}

const STANDING: Record<string, React.FC<P>> = {
  sprout: Sprout, blossom: Blossom, sunflower: Sunflower, rose: Rose, spears: Spears, fan: Fan, fern: Fern,
  bush: Bush, daisy: Daisy, tulip: Tulip, hibiscus: Hibiscus, lavender: Lavender, poppy: Poppy, orchid: Orchid,
  lily: Lily, clover: Clover, mushroom: Mushroom, bamboo: Bamboo, cactus: Cactus, jade: Jade, bonsai: Bonsai,
};

// ---------------------------------------------------------------------------------------------
// Trailing plants (pot at the top, growth hangs below)
// ---------------------------------------------------------------------------------------------
const VINES = [{ x: 15, len: 38 }, { x: 33, len: 32 }, { x: 24, len: 44 }, { x: 19, len: 26 }, { x: 29, len: 22 }];
const POTHOS_LEAF = 'M0 0 C-3 3 -11 2 -11 -6 C-11 -14 -4 -17 0 -25 C4 -17 11 -14 11 -6 C11 2 3 3 0 0Z';
function Trailing({ g, d }: P) {
  const n = count(g, 5, 2);
  const shape = String(d.opt?.shape ?? 'heart');
  const potY = TRAIL_POT_Y;
  const pothos = shape === 'heart';
  return (
    <g>
      {VINES.slice(0, n).map((v, i) => {
        const len = v.len * (0.55 + 0.45 * g);
        const pts = Array.from({ length: 9 }, (_, k) => {
          const t = k / 8;
          return { x: v.x + Math.sin(t * 3 + i) * 3, y: potY + 12 + t * len };
        });
        const path = 'M' + pts.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L');
        return (
          <g key={i}>
            <path d={path} stroke={d.leaf2} strokeWidth={shape === 'pearl' ? 0.9 : pothos ? 1.6 : 1.3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            {pts.slice(1).map((p, k) => {
              const side = (k + i) % 2 ? 1 : -1; // alternate left / right all the way down (offset per vine so neighbours differ)
              if (shape === 'pearl') return <circle key={k} cx={p.x} cy={p.y} r={2.6} fill={k % 2 ? d.leaf : '#9ad6a6'} />;
              if (shape === 'ivy') {
                return (
                  <g key={k} transform={`translate(${p.x + side * 1.5} ${p.y}) rotate(${side * 28}) scale(0.62)`}>
                    <path d="M0 0 C-6 -1 -8 5 -4 7 C-8 9 -4 14 -1 13 C-2 17 0 20 0 22 C0 20 2 17 1 13 C4 14 8 9 4 7 C8 5 6 -1 0 0Z" fill={k % 2 ? d.leaf : d.leaf2} />
                    <path d="M0 1 L0 19" stroke="#bfe3c4" strokeWidth={0.9} opacity={0.6} />
                  </g>
                );
              }
              // pothos: the fuller heart leaves from before, but they fan out to both sides and vary in angle and size,
              // each on a short stalk so the vine itself still shows between them
              if (k % 4 === 3 && k < 7) return null; // a small gap now and then lets the vine show
              const tilt = 32 + ((k * 7 + i * 5) % 4) * 7; // 32..53 degrees out from straight down
              const sz = 0.52 - k * 0.012 + (((k + i) % 3) - 1) * 0.03;
              const sx = p.x + side * 2.2;
              return (
                <g key={k}>
                  <path d={`M${p.x.toFixed(1)} ${p.y.toFixed(1)} L${sx.toFixed(1)} ${(p.y + 0.8).toFixed(1)}`} stroke={d.leaf2} strokeWidth={0.9} strokeLinecap="round" />
                  <g transform={`translate(${sx.toFixed(1)} ${(p.y + 0.8).toFixed(1)}) rotate(${180 + side * tilt}) scale(${sz.toFixed(2)})`}>
                    <path d={POTHOS_LEAF} fill={(k + i) % 3 === 0 ? d.leaf2 : d.leaf} />
                    <path d="M0 -2 L0 -20" stroke="#cfe9a6" strokeWidth={1.5} opacity={0.7} />
                  </g>
                </g>
              );
            })}
            {pothos && (
              // a young leaf at the very tip, pointing down
              <g transform={`translate(${pts[8].x.toFixed(1)} ${(pts[8].y + 0.5).toFixed(1)}) rotate(${180 + (i % 2 ? 14 : -14)}) scale(0.4)`}>
                <path d={POTHOS_LEAF} fill={d.leaf} />
                <path d="M0 -2 L0 -20" stroke="#cfe9a6" strokeWidth={1.5} opacity={0.7} />
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

/**
 * One arching spider-plant leaf, drawn as a FILLED tapered shape along a curve (not a thick stroke), so it keeps its green
 * body on a light nook just like on a dark one. A pale stripe runs down the middle, fully inside the green.
 */
function ArchLeaf({ x0, y0, cx, cy, x1, y1, w, fill, edge, stripe }: { x0: number; y0: number; cx: number; cy: number; x1: number; y1: number; w: number; fill: string; edge: string; stripe: string }) {
  const at = (t: number) => ({
    x: (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1,
    y: (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1,
  });
  const N = 12;
  const L: string[] = [];
  const R: string[] = [];
  const SL: string[] = [];
  const SR: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = at(t);
    const b = at(Math.min(1, t + 0.02));
    const c = at(Math.max(0, t - 0.02));
    const len = Math.hypot(b.x - c.x, b.y - c.y) || 1;
    const nx = -(b.y - c.y) / len;
    const ny = (b.x - c.x) / len;
    const h = w * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, 0.18 + 0.82 * t))) * (1 - Math.pow(t, 3.2) * 0.96);
    const sh = h * 0.34;
    L.push(`${(a.x + nx * h).toFixed(1)} ${(a.y + ny * h).toFixed(1)}`);
    R.push(`${(a.x - nx * h).toFixed(1)} ${(a.y - ny * h).toFixed(1)}`);
    if (t > 0.04 && t < 0.88) {
      SL.push(`${(a.x + nx * sh).toFixed(1)} ${(a.y + ny * sh).toFixed(1)}`);
      SR.push(`${(a.x - nx * sh).toFixed(1)} ${(a.y - ny * sh).toFixed(1)}`);
    }
  }
  const body = 'M' + L.join(' L') + ' L' + R.slice().reverse().join(' L') + ' Z';
  const mid = 'M' + SL.join(' L') + ' L' + SR.slice().reverse().join(' L') + ' Z';
  return (
    <g>
      <path d={body} fill={fill} stroke={edge} strokeWidth={0.7} strokeLinejoin="round" />
      <path d={mid} fill={stripe} />
    </g>
  );
}

/** Spider plant: arching striped blades with little plantlets on runners. */
function Spider({ g, d }: P) {
  const n = count(g, 8, 4);
  const potY = TRAIL_POT_Y;
  const blades = [
    { x: -17, y: 34 }, { x: 17, y: 36 }, { x: -24, y: 22 }, { x: 24, y: 24 },
    { x: -8, y: 48 }, { x: 8, y: 50 }, { x: -21, y: 44 }, { x: 21, y: 46 },
  ].slice(0, n);
  const sc = 0.65 + 0.35 * g;
  return (
    <g>
      {blades.map((b, i) => {
        const ex = 24 + b.x * sc;
        const ey = potY + 8 + b.y * sc;
        const cx = 24 + b.x * 0.6 * sc;
        const cy = potY - 9 - Math.abs(b.x) * 0.1;
        return (
          <ArchLeaf
            key={i}
            x0={24 + b.x * 0.08} y0={potY + 3} cx={cx} cy={cy} x1={ex} y1={ey}
            w={3.1}
            fill={i % 2 ? d.leaf : '#5fae58'}
            edge={d.leaf2}
            stripe="#eef5bd"
          />
        );
      })}
      {g >= 0.8 && (
        <g>
          <path d={`M24 ${potY + 3} Q40 ${potY + 6} 41 ${potY + 28}`} stroke={d.leaf2} strokeWidth={1} fill="none" strokeLinecap="round" />
          <g transform={`translate(41 ${potY + 29})`}>
            {[-40, -15, 15, 40].map(r => <Blade key={r} x={0} y={0} len={9} w={2.2} rot={180 + r} fill={d.leaf} edge={d.leaf2} />)}
          </g>
        </g>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------------------------
interface PlantArtProps {
  def: PlantDef;
  growth: number; // 0.2 .. 1
  /** Where it stands. Defaults to the plant's own kind of spot. */
  mount?: 'shelf' | 'hanging';
  /** Not earned yet: a small seedling in the plant's own pot, with a progress badge. */
  seedling?: boolean;
  badge?: string;
  width?: number;
  title?: string;
  className?: string;
}

export const PlantArt = React.memo(function PlantArt({ def, growth, mount, seedling, badge, width = 48, title, className }: PlantArtProps) {
  const where = mount ?? def.mount;
  const hanging = where === 'hanging';
  const trailing = def.family === 'trailing' || def.family === 'spider';
  const h = !hanging ? STAND_H : trailing ? TRAIL_H : HANG_H;
  const shift = hanging && !trailing ? BASKET_SHIFT : 0;
  const potY = trailing ? TRAIL_POT_Y : 48 + shift;
  const Body = def.family === 'trailing' ? Trailing : def.family === 'spider' ? Spider : STANDING[def.family] ?? Bush;
  const potDef: PotStyle = hanging && def.pot.shape === 'taper' && !trailing ? { ...def.pot, shape: 'bowl' } : def.pot;

  return (
    <svg
      width={width}
      height={Math.round((width * h) / 48)}
      viewBox={`0 0 48 ${h}`}
      role="img"
      aria-label={title ?? def.name}
      className={className}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {hanging && (
        <g stroke="#8a5a3b" strokeWidth={1.1} fill="none" strokeLinecap="round">
          <path d={`M24 1 L13 ${potY} M24 1 L35 ${potY}`} />
          <circle cx={24} cy={1.8} r={1.6} fill="#8a5a3b" />
        </g>
      )}
      <g transform={shift ? `translate(0 ${shift})` : undefined}>
        {seedling ? (
          <g>
            <path d={`M24 48 L24 38`} stroke={def.leaf2} strokeWidth={2} strokeLinecap="round" />
            <Blade x={24} y={40} len={9} w={3.2} rot={-50} fill={def.leaf} />
            <Blade x={24} y={40} len={9} w={3.2} rot={50} fill={def.leaf} />
          </g>
        ) : (
          <Body g={growth} d={def} />
        )}
      </g>
      <Pot pot={potDef} y={potY} basket={hanging} />
      {seedling && badge && (
        <text x={24} y={potY + 11} textAnchor="middle" fontSize={badge.length > 3 ? 7 : 9} fontWeight="bold" fill={def.pot.text ?? '#fff'}>
          {badge}
        </text>
      )}
    </svg>
  );
});
