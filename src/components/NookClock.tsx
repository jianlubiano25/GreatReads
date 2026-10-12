import React, { useEffect, useState, useSyncExternalStore } from 'react';
import type { WeatherData } from '../services/weather';
import { cycleClockTheme, getClockTheme, subscribeClockTheme } from '../services/nookPrefs';

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

/** Five looks, cycled by tapping the clock: digits, screen and casing colours (+ glow for the LED ones). */
type ClockLook = { name: string; led: string; ledDark?: string; screen: string; casing: string; edge: string; glow: boolean };
export const CLOCK_LOOKS: ClockLook[] = [
  { name: 'Amber', led: '#ffad33', ledDark: '#ffc766', screen: '#120f14', casing: '#2a2630', edge: '#4d4658', glow: true },
  { name: 'Green', led: '#4dff88', screen: '#06150c', casing: '#1d2b23', edge: '#3d5446', glow: true },
  { name: 'Ice blue', led: '#6fd3ff', screen: '#08121d', casing: '#222b38', edge: '#46566b', glow: true },
  { name: 'Rose', led: '#ff7fb8', screen: '#1a0b15', casing: '#33202d', edge: '#5e3b51', glow: true },
  { name: 'Retro LCD', led: '#2f3a28', screen: '#c9d3a3', casing: '#5a554b', edge: '#7d776a', glow: false },
];

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
  const look = CLOCK_LOOKS[useSyncExternalStore(subscribeClockTheme, getClockTheme, getClockTheme)] ?? CLOCK_LOOKS[0];
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

  // LEDs are a touch brighter and glowier when the nook is dark
  const led = dark && look.ledDark ? look.ledDark : look.led;
  const ledGlow = look.glow ? `drop-shadow(0 0 ${dark ? 2.2 : 1.2}px ${led}${dark ? 'cc' : '88'})` : 'none';

  return (
    <button
      type="button"
      onClick={cycleClockTheme}
      className="self-center shrink-0 block p-0 border-0 bg-transparent cursor-pointer"
      style={{
        width: large ? 168 : 120,
        marginTop: 2,
        marginBottom: 5,
        // it hangs on the wall, so it casts a soft shadow behind itself
        filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.35))',
      }}
      aria-label={`${spoken}. Tap to change the clock colours (${look.name})`}
      title={`${weather.description}${sun}`}
    >
      <svg viewBox="0 0 140 40" width="100%" style={{ display: 'block', overflow: 'visible' }} aria-hidden="true">
        {/* casing */}
        <rect x={0.5} y={0.5} width={139} height={39} rx={7} fill={look.casing} stroke={look.edge} strokeWidth={1} />
        <rect x={8} y={1.6} width={124} height={1.1} rx={0.55} fill="#ffffff" opacity={0.14} />
        {/* screen */}
        <rect x={4.5} y={4.5} width={131} height={31} rx={4} fill={look.screen} stroke="#000" strokeOpacity={0.6} />
        <g style={{ filter: ledGlow }}>
          <Digit ch={hh[0]} x={11} y={11} color={led} />
          <Digit ch={hh[1]} x={25} y={11} color={led} />
          <g className="rl-colon" fill={led}>
            <rect x={39.3} y={15.6} width={2.3} height={2.3} rx={0.5} />
            <rect x={39.3} y={23.4} width={2.3} height={2.3} rx={0.5} />
          </g>
          <Digit ch={mm[0]} x={46} y={11} color={led} />
          <Digit ch={mm[1]} x={60} y={11} color={led} />
        </g>
        {/* AM/PM beside the minutes; weather icon (big) above the temperature on the right */}
        <line x1={82} y1={9} x2={82} y2={31} stroke={led} strokeOpacity={0.22} />
        {uses12h && (
          <text x={71.5} y={18} fill={led} fontSize={6.5} fontWeight={700} fontFamily={MONO} style={{ filter: ledGlow }}>
            {ampm}
          </text>
        )}
        <text x={108.5} y={temp ? 22.5 : 26} textAnchor="middle" fontSize={temp ? 15 : 17}>{icon}</text>
        {temp && (
          <text x={108.5} y={32.5} textAnchor="middle" fill={led} fontSize={8.5} fontWeight={700} fontFamily={MONO} style={{ filter: ledGlow }}>
            {temp}C
          </text>
        )}
      </svg>
    </button>
  );
});
