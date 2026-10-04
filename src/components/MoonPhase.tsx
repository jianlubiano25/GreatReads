import React, { useId } from 'react';

/**
 * The night-time moon in the window shows the real phase for today's date
 * (new, crescent, quarter, gibbous, full), drawn as one tiny SVG. No timers or animation loops.
 * Shown as seen from the northern hemisphere: waxing moons are lit on the right, waning on the left.
 */

const SYNODIC_DAYS = 29.530588853;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
export const MOON_PHASE_NAMES = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];

export const MOON_PHASE_EMOJI = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];

export function moonPhase(date: Date): { frac: number; index: number; name: string } {
  const days = (date.getTime() - KNOWN_NEW_MOON) / 86400000;
  const frac = (((days % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS) / SYNODIC_DAYS; // 0 = new, 0.5 = full
  const index = Math.floor(frac * 8 + 0.5) % 8;
  return { frac, index, name: MOON_PHASE_NAMES[index] };
}

const R = 10;

/**
 * The lit part of the disc: the right half-circle plus (or minus) an ellipse for the day/night edge.
 * Crescents and the slim side of gibbous moons are drawn a little fuller than the real maths gives, so a
 * crescent reads as a proper, chunky crescent at this tiny size instead of a hairline.
 */
function litShape(frac: number): string | null {
  const f = frac < 0.5 ? frac : 1 - frac; // 0 (new) .. 0.5 (full)
  if (f < 0.02) return null; // new moon: nothing lit
  if (f > 0.48) return `M12 ${12 - R} A${R} ${R} 0 1 1 12 ${12 + R} A${R} ${R} 0 1 1 12 ${12 - R} Z`; // full
  const c = Math.cos(f * 2 * Math.PI);
  const sliver = Math.min(1 - Math.abs(c), 1) * 1.45; // how thin the slim part is (0 = none .. 1 = half the disc)
  const rx = Math.max(0.12, 1 - Math.min(sliver, 0.82)) * R;
  return `M12 ${12 - R} A${R} ${R} 0 0 1 12 ${12 + R} A${rx.toFixed(2)} ${R} 0 0 ${c > 0 ? 0 : 1} 12 ${12 - R} Z`;
}

/** `phase` (0..7, same order as MOON_PHASE_NAMES) shows that phase instead of the one for `date`. */
export const MoonPhase = React.memo(function MoonPhase({ date, phase }: { date: Date; phase?: number | null }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const frac = phase == null ? moonPhase(date).frac : phase / 8;
  const waning = frac >= 0.5;
  const lit = litShape(frac);
  const glow = (1 - Math.cos(frac * 2 * Math.PI)) / 2; // 0 new .. 1 full
  return (
    <div
      className="absolute pointer-events-none"
      style={{ top: '15%', right: '13%', width: '33%', aspectRatio: '1' }}
    >
      <svg
        viewBox="0 0 24 24"
        width="100%"
        height="100%"
        aria-hidden="true"
        style={{ overflow: 'visible', filter: `drop-shadow(0 0 ${2.5 + glow * 5}px rgba(248, 244, 219, ${0.3 + glow * 0.5}))` }}
      >
        <defs>
          <radialGradient id={`moon-fill-${uid}`} cx="0.62" cy="0.4" r="0.75">
            <stop offset="0" stopColor="#fffdf0" />
            <stop offset="0.65" stopColor="#f6efc9" />
            <stop offset="1" stopColor="#e6dba8" />
          </radialGradient>
          <clipPath id={`moon-lit-${uid}`}>{lit && <path d={lit} />}</clipPath>
        </defs>
        {/* the unlit side: just a whisper of earthshine, so a crescent still sits inside a round moon */}
        <circle cx={12} cy={12} r={R} fill="rgba(248, 244, 219, 0.07)" stroke="rgba(248, 244, 219, 0.16)" strokeWidth={0.3} />
        {lit && (
          <g transform={waning ? 'translate(24 0) scale(-1 1)' : undefined}>
            <path d={lit} fill={`url(#moon-fill-${uid})`} stroke="#f6efc9" strokeWidth={0.35} strokeLinejoin="round" />
            <g clipPath={`url(#moon-lit-${uid})`}>
              <circle cx={9} cy={9} r={2.2} fill="rgba(205, 192, 150, 0.42)" />
              <circle cx={14.5} cy={14.5} r={1.6} fill="rgba(205, 192, 150, 0.42)" />
              <circle cx={10} cy={15.5} r={1.2} fill="rgba(205, 192, 150, 0.42)" />
              <circle cx={15.5} cy={8} r={1} fill="rgba(205, 192, 150, 0.34)" />
            </g>
          </g>
        )}
      </svg>
    </div>
  );
});
