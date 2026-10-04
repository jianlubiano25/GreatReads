import React from 'react';

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

/** The lit part of the disc: the right half-circle plus (or minus) an ellipse for the day/night edge. */
function litShape(frac: number): string | null {
  const f = frac < 0.5 ? frac : 1 - frac; // 0 (new) .. 0.5 (full)
  if (f < 0.02) return null; // new moon: nothing lit
  const c = Math.cos(f * 2 * Math.PI);
  if (f > 0.48) return `M12 ${12 - R} A${R} ${R} 0 1 1 12 ${12 + R} A${R} ${R} 0 1 1 12 ${12 - R} Z`; // full
  return `M12 ${12 - R} A${R} ${R} 0 0 1 12 ${12 + R} A${Math.abs(c) * R} ${R} 0 0 ${c > 0 ? 0 : 1} 12 ${12 - R} Z`;
}

/** `phase` (0..7, same order as MOON_PHASE_NAMES) shows that phase instead of the one for `date`. */
export const MoonPhase = React.memo(function MoonPhase({ date, phase }: { date: Date; phase?: number | null }) {
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
        style={{ overflow: 'visible', filter: `drop-shadow(0 0 ${3 + glow * 6}px rgba(248, 244, 219, ${0.25 + glow * 0.6}))` }}
      >
        {/* the dark side, faintly visible */}
        <circle cx={12} cy={12} r={R} fill="rgba(248, 244, 219, 0.14)" stroke="rgba(248, 244, 219, 0.35)" strokeWidth={0.5} />
        {lit && (
          <g transform={waning ? 'translate(24 0) scale(-1 1)' : undefined}>
            <clipPath id="moon-lit">
              <path d={lit} />
            </clipPath>
            <path d={lit} fill="#f8f4db" />
            <g clipPath="url(#moon-lit)">
              <circle cx={9} cy={9} r={2.2} fill="rgba(215, 205, 175, 0.5)" />
              <circle cx={14.5} cy={14.5} r={1.6} fill="rgba(215, 205, 175, 0.5)" />
              <circle cx={10} cy={15.5} r={1.2} fill="rgba(215, 205, 175, 0.5)" />
              <circle cx={15.5} cy={8} r={1} fill="rgba(215, 205, 175, 0.4)" />
            </g>
          </g>
        )}
      </svg>
    </div>
  );
});
