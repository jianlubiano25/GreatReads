import React, { useEffect, useState } from 'react';
import type { WeatherData } from '../services/weather';

export function weatherIcon(condition: WeatherData['condition'], night: boolean): string {
  if (condition === 'rain') return '🌧️';
  if (condition === 'snow') return '❄️';
  if (condition === 'clouds') return night ? '☁️' : '⛅';
  return night ? '🌙' : '☀️';
}

const fmtMinutes = (minutes: number) => {
  const date = new Date(2000, 0, 1, Math.floor(minutes / 60) % 24, minutes % 60);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

// ---- Seven-segment digits ---------------------------------------------------------------------------
// Each digit is 7 small hexagon-ended bars (a..g). Unlit bars stay faintly visible, like a real LED display.
const W = 10; // digit width
const H = 18; // digit height
const T = 2.1; // bar thickness
const G = 0.35; // gap between bars

const hBar = (x: number, y: number, len: number) =>
  `${x},${y + T / 2} ${x + T / 2},${y} ${x + len - T / 2},${y} ${x + len},${y + T / 2} ${x + len - T / 2},${y + T} ${x + T / 2},${y + T}`;
const vBar = (x: number, y: number, len: number) =>
  `${x + T / 2},${y} ${x + T},${y + T / 2} ${x + T},${y + len - T / 2} ${x + T / 2},${y + len} ${x},${y + len - T / 2} ${x},${y + T / 2}`;

const LH = W - T - 2 * G; // length of the horizontal bars
const LV = H / 2 - T / 2 - 2 * G; // length of the vertical bars
const SEGMENTS: Record<string, string> = {
  a: hBar(T / 2 + G, 0, LH),
  b: vBar(W - T, T / 2 + G, LV),
  c: vBar(W - T, H / 2 + G, LV),
  d: hBar(T / 2 + G, H - T, LH),
  e: vBar(0, H / 2 + G, LV),
  f: vBar(0, T / 2 + G, LV),
  g: hBar(T / 2 + G, (H - T) / 2, LH),
};
const LIT: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
  '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', ' ': '',
};

function Digit({ ch, x, y, color }: { ch: string; x: number; y: number; color: string }) {
  const on = LIT[ch] ?? '';
  return (
    // a slight lean, like the italic digits on real LED clocks
    <g transform={`translate(${x} ${y}) skewX(-5)`}>
      {Object.keys(SEGMENTS).map(k => (
        <polygon key={k} points={SEGMENTS[k]} fill={color} opacity={on.includes(k) ? 1 : 0.09} />
      ))}
    </g>
  );
}

const uses12h = (() => {
  try {
    return !!new Intl.DateTimeFormat([], { hour: 'numeric' }).resolvedOptions().hour12;
  } catch {
    return true;
  }
})();

const MONO = "ui-monospace, 'SF Mono', Menlo, monospace";

/**
 * A digital clock hung on the wall above the shelves: dark casing, glowing LED digits, a blinking colon,
 * AM/PM, and the weather + temperature beside the time. `now` is only for previews and tests.
 */
export const NookClock = React.memo(function NookClock({
  weather,
  dark,
  large = false,
  now: fixedNow,
}: {
  weather: WeatherData;
  dark: boolean;
  large?: boolean;
  now?: Date;
}) {
  const [tick, setTick] = useState(() => new Date());
  useEffect(() => {
    if (fixedNow) return;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => 60_000 - (Date.now() % 60_000) + 50; // wake up just after each minute changes
    const run = () => {
      setTick(new Date());
      timer = setTimeout(run, next());
    };
    timer = setTimeout(run, next());
    // a phone that slept comes back to the right time straight away
    const onVisible = () => { if (document.visibilityState === 'visible') setTick(new Date()); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fixedNow]);

  const now = fixedNow ?? tick;
  const h24 = now.getHours();
  const mm = String(now.getMinutes()).padStart(2, '0');
  const h = uses12h ? h24 % 12 || 12 : h24;
  const hh = uses12h ? (h < 10 ? ` ${h}` : String(h)) : String(h).padStart(2, '0');
  const ampm = h24 < 12 ? 'AM' : 'PM';

  const icon = weatherIcon(weather.condition, weather.isNight);
  const temp = weather.source === 'location' && typeof weather.temperature === 'number' ? `${weather.temperature}°` : '';
  const sun = weather.source === 'location' && weather.sun
    ? ` · Sunrise ${fmtMinutes(weather.sun.rise)}, sunset ${fmtMinutes(weather.sun.set)}`
    : '';
  const spoken = `${uses12h ? `${h}:${mm} ${ampm}` : `${hh}:${mm}`}, ${weather.description}${temp ? `, ${temp.replace('°', ' degrees')}` : ''}`;

  // Amber LEDs: a touch brighter and glowier when the nook is dark
  const led = dark ? '#ffc766' : '#ffad33';
  const glow = dark ? 'drop-shadow(0 0 2.2px rgba(255,170,60,.85))' : 'drop-shadow(0 0 1.2px rgba(255,150,30,.55))';

  return (
    <div
      className="self-center shrink-0"
      style={{
        width: large ? 168 : 120,
        marginTop: 2,
        marginBottom: 5,
        // it hangs on the wall, so it casts a soft shadow behind itself
        filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.35))',
      }}
      role="img"
      aria-label={spoken}
      title={`${weather.description}${sun}`}
    >
      <svg viewBox="0 0 140 40" width="100%" style={{ display: 'block', overflow: 'visible' }} aria-hidden="true">
        {/* casing */}
        <rect x={0.5} y={0.5} width={139} height={39} rx={7} fill="#2a2630" stroke="#4d4658" strokeWidth={1} />
        <rect x={8} y={1.6} width={124} height={1.1} rx={0.55} fill="#ffffff" opacity={0.14} />
        {/* screen */}
        <rect x={4.5} y={4.5} width={131} height={31} rx={4} fill="#120f14" stroke="#000" strokeOpacity={0.6} />
        <g style={{ filter: glow }}>
          <Digit ch={hh[0]} x={11} y={11} color={led} />
          <Digit ch={hh[1]} x={25} y={11} color={led} />
          <g className="rl-colon" fill={led}>
            <rect x={39.3} y={15.6} width={2.3} height={2.3} rx={0.5} />
            <rect x={39.3} y={23.4} width={2.3} height={2.3} rx={0.5} />
          </g>
          <Digit ch={mm[0]} x={46} y={11} color={led} />
          <Digit ch={mm[1]} x={60} y={11} color={led} />
        </g>
        {/* side panel: AM/PM, then weather and temperature */}
        <line x1={78} y1={9} x2={78} y2={31} stroke={led} strokeOpacity={0.22} />
        {uses12h && (
          <text x={83} y={18.5} fill={led} fontSize={8} fontWeight={700} fontFamily={MONO} letterSpacing={0.6} style={{ filter: glow }}>
            {ampm}
          </text>
        )}
        <text x={83} y={31.5} fontSize={9.5}>{icon}</text>
        {temp && (
          <text x={98} y={31} fill={led} fontSize={9} fontWeight={700} fontFamily={MONO} style={{ filter: glow }}>
            {temp}C
          </text>
        )}
      </svg>
    </div>
  );
});
