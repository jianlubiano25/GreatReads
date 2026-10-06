import React, { useEffect, useRef, useState, useSyncExternalStore, useMemo } from 'react';
import { Book, GardenState } from '../types';
import { subscribeCovers, getCoversVersion } from '../services/books';
import { CoverFace } from './BookMeta';
import { fetchLocalWeather, setWeatherOverride, getTimePeriod, describeWeather, PERIOD_LABEL, TIME_PERIODS, WEATHER_MODES, WeatherData, WeatherCondition, TimePeriod } from '../services/weather';
import { subscribeNookPrefs, getNookPrefsVersion, getNookMatchesTheme, getWindowFollowsTime } from '../services/nookPrefs';
import { GardenArea } from './garden/GardenView';
import { NookClock } from './NookClock';
import { MoonPhase, moonPhase, MOON_PHASE_NAMES, MOON_PHASE_EMOJI } from './MoonPhase';

interface Props {
  books: Book[];
  streak: number;
  todayPages: number;
  goal: number;
  garden: GardenState;
  dailyLog?: Record<string, number>;
  onOpenBook: (b: Book) => void;
}

/**
 * A pointed vine leaf: round at the stem end, drawn to a sharp tip, with a faint centre vein.
 * (x, y) is where the stem meets the vine; `side` is -1 (left) or 1 (right); `r` tilts the tip upwards.
 * Size is 5% smaller than the old oval leaf.
 */
const LEAF_LEN = 17.1;
const LEAF_HALF = 4.6;
const LEAF_D = `M0 0 C${(LEAF_LEN * 0.14).toFixed(1)} ${(-LEAF_HALF * 1.45).toFixed(1)} ${(LEAF_LEN * 0.62).toFixed(1)} ${(-LEAF_HALF * 1.1).toFixed(1)} ${LEAF_LEN} 0 C${(LEAF_LEN * 0.62).toFixed(1)} ${(LEAF_HALF * 1.1).toFixed(1)} ${(LEAF_LEN * 0.14).toFixed(1)} ${(LEAF_HALF * 1.45).toFixed(1)} 0 0Z`;
const Leaf = ({ x, y, side, r, c }: { x: number; y: number; side: number; r: number; c: string }) => (
  <g transform={`translate(${x} ${y}) scale(${side} 1) rotate(${-Math.abs(r)})`}>
    <path d={LEAF_D} fill={c} />
    <path d={`M1 0 L${LEAF_LEN * 0.82} 0`} stroke="rgba(255,255,255,0.28)" strokeWidth={0.7} strokeLinecap="round" />
  </g>
);

// Window climbing vine
const vinePt = (t: number) => ({ x: 14 + 9 * Math.sin(t * 6.5) + t * 16, y: 128 - t * 114 });
const VINE_D = 'M' + Array.from({ length: 41 }, (_, i) => { const p = vinePt(i / 40); return `${p.x.toFixed(1)} ${p.y.toFixed(1)}`; }).join(' L');
const VINE_LEAVES = Array.from({ length: 10 }, (_, k) => { const t = (k + 1) / 11; return { t, ...vinePt(t), side: k % 2 ? 1 : -1 }; });
// Little flowers dotted along the vine (they appear as the vine reaches them and stay once grown)
const VINE_FLOWERS = [
  { k: 1, c: '#f4a6bd' }, { k: 3, c: '#fff4c9' }, { k: 5, c: '#c9b2f0' }, { k: 7, c: '#f4a6bd' }, { k: 9, c: '#fff4c9' },
].map(({ k, c }) => { const t = (k + 1) / 11; const p = vinePt(t); const side = k % 2 ? 1 : -1; return { t, c, x: p.x + side * 3.2, y: p.y - 5 }; });
const grow = (on: boolean, visible: boolean, extra = ''): React.CSSProperties => ({
  opacity: on && visible ? 1 : 0,
  transform: on && visible ? 'scale(1)' : 'scale(0.2)',
  transition: 'opacity .7s ease, transform .7s ease',
  ...(extra ? { transformOrigin: extra } : {}),
});

// Is the app itself in its dark (Night) appearance? Watches the class the theme code puts on <html>.
const subscribeTheme = (cb: () => void) => {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  return () => mo.disconnect();
};
const isAppDark = () => document.documentElement.classList.contains('dark');

const PERIOD_ICON: Record<TimePeriod, string> = { morning: '🌅', day: '☀️', sunset: '🌇', night: '🌙' };

/** Sky behind the window for a time of day and weather. */
function skyFor(period: TimePeriod, cond: WeatherCondition): string {
  if (period === 'night') {
    return cond === 'clear' ? 'linear-gradient(180deg, #0f1629 0%, #202644 100%)'
      : cond === 'snow' ? 'linear-gradient(180deg, #1c2540 0%, #3b4766 100%)'
      : 'linear-gradient(180deg, #141b30 0%, #2a3150 100%)';
  }
  if (period === 'sunset') {
    return cond === 'clear' ? 'linear-gradient(180deg, #e76f51 0%, #f4a261 50%, #fde2b4 100%)'
      : cond === 'snow' ? 'linear-gradient(180deg, #b98a9a 0%, #e3b9a8 55%, #f3e3df 100%)'
      : 'linear-gradient(180deg, #b6694f 0%, #d79a73 55%, #ecc9a4 100%)';
  }
  if (cond === 'rain') return 'linear-gradient(180deg, #6c7c8c 0%, #9cb2c4 100%)';
  if (cond === 'snow') return 'linear-gradient(180deg, #9fb0c2 0%, #e8eff5 100%)';
  if (cond === 'clouds') return 'linear-gradient(180deg, #8ba8b7 0%, #d8e6ed 100%)';
  if (period === 'morning') return 'linear-gradient(180deg, #f2b5a0 0%, #f9d9b4 45%, #cfe6f3 100%)';
  return 'linear-gradient(180deg, #68b3e8 0%, #d6edfc 100%)';
}

// Night-sky stars: classic 5-point stars and 4-point sparkles. The moon sits in the top-right
// (about x 54-87%, y 15-40% of the window), so none of these are placed there.
const STAR5 = 'M0 -1 L0.294 -0.405 L0.951 -0.309 L0.476 0.155 L0.588 0.809 L0 0.5 L-0.588 0.809 L-0.476 0.155 L-0.951 -0.309 L-0.294 -0.405 Z';
const STAR4 = 'M0 -1 C0.1 -0.3 0.3 -0.1 1 0 C0.3 0.1 0.1 0.3 0 1 C-0.1 0.3 -0.3 0.1 -1 0 C-0.3 -0.1 -0.1 -0.3 0 -1 Z';
const NIGHT_STARS: { x: string; y: string; k: 5 | 4; s: number; d: string; c: string }[] = [
  { x: '17%', y: '14%', k: 5, s: 6, d: '0s', c: '#fff1a8' },
  { x: '37%', y: '11%', k: 4, s: 6, d: '0.7s', c: '#ffffff' },
  { x: '28%', y: '31%', k: 5, s: 5, d: '1.3s', c: '#fff6c8' },
  { x: '10%', y: '40%', k: 4, s: 5, d: '0.3s', c: '#ffffff' },
  { x: '90%', y: '55%', k: 5, s: 5.5, d: '1.0s', c: '#fff1a8' },
  { x: '67%', y: '60%', k: 4, s: 6.5, d: '1.6s', c: '#ffffff' },
  { x: '22%', y: '66%', k: 5, s: 5.5, d: '0.5s', c: '#fff6c8' },
  { x: '42%', y: '80%', k: 4, s: 5, d: '1.9s', c: '#ffffff' },
  { x: '78%', y: '83%', k: 5, s: 5, d: '0.9s', c: '#fff1a8' },
  { x: '9%', y: '86%', k: 4, s: 4.5, d: '1.4s', c: '#ffffff' },
];

const SNOWFLAKES = [
  { l: '8%', d: '0s', dur: '4.4s', s: 3 }, { l: '20%', d: '1.1s', dur: '3.8s', s: 2 }, { l: '32%', d: '2.2s', dur: '4.8s', s: 4 },
  { l: '45%', d: '0.5s', dur: '4s', s: 2.5 }, { l: '58%', d: '1.7s', dur: '4.6s', s: 3.5 }, { l: '70%', d: '2.9s', dur: '3.9s', s: 2 },
  { l: '82%', d: '0.9s', dur: '4.2s', s: 3 }, { l: '92%', d: '2.4s', dur: '5s', s: 2.5 }, { l: '14%', d: '3.3s', dur: '4.5s', s: 2 },
  { l: '64%', d: '3.6s', dur: '4.1s', s: 3 },
];

export function ReadingScene({
  books,
  streak,
  todayPages,
  goal,
  garden,
  dailyLog = {},
  onOpenBook,
}: Props) {
  useSyncExternalStore(subscribeCovers, getCoversVersion, getCoversVersion);
  const met = todayPages >= goal;

  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // The vine shows everything you have read so far (a saved high-water mark), so a streak reset never shrinks it.
  const vineG = grown ? garden.vine : 0;

  // Weather and Day/Night Engine
  const [weather, setWeather] = useState<WeatherData>(() => {
    const tp = getTimePeriod(new Date());
    return {
      condition: 'clear',
      period: tp.period,
      isNight: tp.isNight,
      description: describeWeather('clear', tp.period),
      source: 'time',
    };
  });
  const [tip, setTip] = useState<string | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Every lookup gets a number. A tap bumps it, so a slow location lookup that started earlier can never overwrite the tap.
  const reqId = useRef(0);

  // Nook preferences from Settings (they re-render the scene the moment they change)
  const prefsVersion = useSyncExternalStore(subscribeNookPrefs, getNookPrefsVersion, getNookPrefsVersion);
  const matchTheme = useSyncExternalStore(subscribeNookPrefs, getNookMatchesTheme, () => false);
  const followTime = useSyncExternalStore(subscribeNookPrefs, getWindowFollowsTime, () => true);
  const appDark = useSyncExternalStore(subscribeTheme, isAppDark, () => false);
  const [previewPeriod, setPreviewPeriod] = useState<TimePeriod | null>(null);
  const [previewMoon, setPreviewMoon] = useState<number | null>(null); // 0..7, a moon phase you stepped to
  useEffect(() => {
    if (followTime) {
      setPreviewPeriod(null); // back to the real time of day...
      setPreviewMoon(null); // ...and today's real moon
    }
  }, [followTime]);

  useEffect(() => {
    let mounted = true;
    const load = () => {
      const id = ++reqId.current;
      fetchLocalWeather().then(w => {
        if (mounted && w && id === reqId.current) setWeather(w);
      });
    };
    load();
    const interval = setInterval(load, 60_000); // 1 min refresh for time and light transitions
    return () => {
      mounted = false;
      clearInterval(interval);
      clearTimeout(tipTimer.current);
    };
    // prefsVersion: re-read the weather when "Match weather to my location" is switched
  }, [prefsVersion]);

  // Screen width & shelves. Phones keep the compact 7-books-wide, 2-shelf nook. On wider screens (iPad, desktop) the
  // shelves are measured, so every row is filled with as many books as really fit.
  const [viewW, setViewW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 390));
  useEffect(() => {
    const onResize = () => setViewW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const wide = viewW >= 640;
  const shelfRef = useRef<HTMLDivElement>(null);
  const [shelfW, setShelfW] = useState(0);
  useEffect(() => {
    const el = shelfRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => setShelfW(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // iPad-size screens keep two shelves but use bigger covers, with a little air between the shelves.
  const big = viewW >= 768;
  const SPINE_W = big ? 56 : 44;
  const SPINE_H = Math.round(SPINE_W * 1.5);
  const SHELF_GAP = big ? 14 : 0; // space between the two shelves
  const SPINE_GAP = 3;
  const SHELF_PAD = 8; // px-1 on each side
  const fit = shelfW > 0 ? Math.floor((shelfW - SHELF_PAD + SPINE_GAP) / (SPINE_W + SPINE_GAP)) : 8;
  const perShelf = wide ? Math.min(24, Math.max(6, fit)) : 7;
  const shelves = [0, 1].map(i => books.slice(i * perShelf, (i + 1) * perShelf));

  // Count total days with 10+ pages
  const tenPageDays = useMemo(() => {
    return Object.values(dailyLog).filter(pages => Number(pages) >= 10).length;
  }, [dailyLog]);

  const showTip = (text: string) => {
    setTip(text);
    clearTimeout(tipTimer.current);
    tipTimer.current = setTimeout(() => setTip(null), 2400);
  };

  // Time of day actually shown in the window: the real one, unless you are previewing other times
  const period: TimePeriod = !followTime && previewPeriod ? previewPeriod : weather.period;
  const windowNight = period === 'night';
  const todaysMoon = moonPhase(new Date());
  const shownMoon = !followTime && previewMoon != null ? previewMoon : todaysMoon.index;
  const moonName = MOON_PHASE_NAMES[shownMoon];
  const describe = (cond: WeatherCondition, per: TimePeriod) =>
    `${describeWeather(cond, per)}${per === 'night' && cond === 'clear' ? ` · ${moonName}` : ''}`;

  const handleCycleWeather = () => {
    const nextIndex = WEATHER_MODES.indexOf(weather.condition) + 1;
    if (weather.source === 'manual' && nextIndex === WEATHER_MODES.length) {
      const id = ++reqId.current;
      setWeatherOverride('auto');
      fetchLocalWeather().then(nextWeather => {
        if (nextWeather && id === reqId.current) setWeather(nextWeather);
      });
      showTip('Automatic weather');
      return;
    }
    const nextCond = WEATHER_MODES[nextIndex % WEATHER_MODES.length];
    reqId.current++;
    setWeatherOverride(nextCond);
    setWeather(prev => ({ ...prev, condition: nextCond, description: describeWeather(nextCond, prev.period), source: 'manual' }));
    showTip(describe(nextCond, period));
  };

  const handleCycleTime = () => {
    const next = TIME_PERIODS[(TIME_PERIODS.indexOf(period) + 1) % TIME_PERIODS.length];
    setPreviewPeriod(next);
    showTip(`${PERIOD_LABEL[next]} · ${describe(weather.condition, next)}`);
  };

  const handleCycleMoon = () => {
    const next = (shownMoon + 1) % MOON_PHASE_NAMES.length;
    setPreviewMoon(next);
    showTip(MOON_PHASE_NAMES[next]);
  };

  // The window shows the sky; the nook (wall, shelves, plants) is dark either by the theme or by the time of day
  const nookDark = matchTheme ? appDark : windowNight;
  const isRain = weather.condition === 'rain';
  const isSnow = weather.condition === 'snow';
  const isCloudy = weather.condition === 'clouds';
  const showClouds = isCloudy || isRain || isSnow;
  const skyBackground = skyFor(period, weather.condition);

  return (
    <div
      className="rl-scene relative rounded-2xl overflow-hidden border border-[#e3d7c3] dark:border-[#382f25] shadow-sm select-none"
      style={{
        background: nookDark ? 'linear-gradient(#2b2233,#3a2c2c)' : 'linear-gradient(#f7ecd6,#efdcbc)',
      }}
    >
      {/* Hanging plants: a rail above the window and bookshelf (scrolls sideways; hidden until something hangs) */}
      <GardenArea garden={garden} night={nookDark} areaId="hanging" />

      <div className="flex items-end gap-2 sm:gap-4 px-3 pt-3">
        {/* Cozy Arched Window with Weather, Sun, Moon, Stars, Clouds, Rain & Snow */}
        <div className="relative shrink-0" style={{ width: '28%', maxWidth: 155 }}>
          <div
            className="relative cursor-pointer group scene-window"
            onClick={handleCycleWeather}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleCycleWeather();
              }
            }}
            title="Tap the window to switch the weather (sun, clouds, rain, snow)"
            role="button"
            tabIndex={0}
            aria-label={`Window showing ${describe(weather.condition, period)}. Press to change the weather.`}
          >
            <div
              style={{
                border: '5px solid #8a5a3b',
                borderRadius: '60px 60px 4px 4px',
                aspectRatio: '3/4',
                position: 'relative',
                overflow: 'hidden',
                background: skyBackground,
                transition: 'background .6s ease',
              }}
            >
              {/* Stars at night: 5-point stars and 4-point sparkles, kept clear of the moon */}
              {windowNight && (
                <div className="absolute inset-0 pointer-events-none" style={{ opacity: weather.condition === 'clear' ? 1 : 0.4 }}>
                  {NIGHT_STARS.map((st, i) => (
                    <svg
                      key={i}
                      className="absolute animate-twinkle"
                      viewBox="-1.2 -1.2 2.4 2.4"
                      width={st.s * 2}
                      height={st.s * 2}
                      aria-hidden="true"
                      style={{ left: st.x, top: st.y, marginLeft: -st.s, marginTop: -st.s, animationDelay: st.d, overflow: 'visible', filter: `drop-shadow(0 0 1.5px ${st.c})` }}
                    >
                      <path d={st.k === 5 ? STAR5 : STAR4} fill={st.c} stroke={st.k === 5 ? st.c : undefined} strokeWidth={st.k === 5 ? 0.08 : 0} strokeLinejoin="round" />
                    </svg>
                  ))}
                </div>
              )}

              {/* The real moon phase at night, otherwise the sun (low and rosy at sunrise and sunset) */}
              {windowNight ? (
                <div style={{ opacity: weather.condition === 'clear' ? 1 : 0.6 }}>
                  <MoonPhase date={new Date()} phase={!followTime ? previewMoon : null} />
                </div>
              ) : (
                <div
                  className="absolute"
                  style={{
                    top: period === 'day' ? '12%' : period === 'morning' ? '32%' : '44%',
                    right: period === 'morning' ? 'auto' : '13%',
                    left: period === 'morning' ? '12%' : 'auto',
                    width: '35%',
                    aspectRatio: '1',
                    borderRadius: '50%',
                    background: period === 'day' ? '#ffd152' : period === 'morning' ? '#ffcf8a' : '#ff9a4d',
                    boxShadow:
                      period === 'day'
                        ? '0 0 22px #ffc107, 0 0 38px rgba(255, 214, 107, 0.65)'
                        : '0 0 20px rgba(255, 154, 77, 0.9), 0 0 34px rgba(255, 190, 120, 0.6)',
                    opacity: weather.condition === 'clear' ? 1 : 0.5,
                    transition: 'top .6s ease, opacity .6s ease',
                  }}
                />
              )}

              {/* Drifting Clouds */}
              {showClouds && (
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  <div className="absolute animate-cloud" style={{ top: '24%', left: '10%' }}>
                    <svg width="48" height="24" viewBox="0 0 48 24" fill="none">
                      <path
                        d="M10 20 H38 C42 20 45 17 45 13 C45 9.5 42 6.5 38.5 6.5 C37.8 3.5 35 1 31.5 1 C28.5 1 26 2.8 25 5 C24 3.8 22.5 3 20.8 3 C17.5 3 15 5.5 15 8.8 C12.5 9 10 11.5 10 14.5 C7.5 14.8 5 17 5 19.5 C5 19.8 5.2 20 10 20 Z"
                        fill={windowNight ? 'rgba(180,195,220,0.35)' : isRain ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.85)'}
                      />
                    </svg>
                  </div>
                  <div className="absolute animate-cloud" style={{ top: '48%', left: '35%', animationDuration: '18s', animationDelay: '-6s' }}>
                    <svg width="40" height="20" viewBox="0 0 48 24" fill="none">
                      <path
                        d="M10 20 H38 C42 20 45 17 45 13 C45 9.5 42 6.5 38.5 6.5 C37.8 3.5 35 1 31.5 1 C28.5 1 26 2.8 25 5 C24 3.8 22.5 3 20.8 3 C17.5 3 15 5.5 15 8.8 C12.5 9 10 11.5 10 14.5 C7.5 14.8 5 17 5 19.5 Z"
                        fill={windowNight ? 'rgba(140,160,190,0.3)' : 'rgba(255,255,255,0.65)'}
                      />
                    </svg>
                  </div>
                </div>
              )}

              {/* Falling Animated Rain */}
              {isRain && (
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  {[
                    { l: '15%', d: '0s', dur: '0.65s' },
                    { l: '35%', d: '0.2s', dur: '0.7s' },
                    { l: '55%', d: '0.4s', dur: '0.6s' },
                    { l: '75%', d: '0.1s', dur: '0.8s' },
                    { l: '25%', d: '0.5s', dur: '0.68s' },
                    { l: '65%', d: '0.35s', dur: '0.72s' },
                    { l: '85%', d: '0.25s', dur: '0.62s' },
                  ].map((drop, i) => (
                    <div
                      key={i}
                      className="absolute animate-rain"
                      style={{
                        left: drop.l,
                        top: 0,
                        width: 1.5,
                        height: 12,
                        background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(200,230,255,0.9) 100%)',
                        borderRadius: 1,
                        transform: 'rotate(15deg)',
                        animationDelay: drop.d,
                        animationDuration: drop.dur,
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Gently falling snow, settling on the sill */}
              {isSnow && (
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                  {SNOWFLAKES.map((f, i) => (
                    <div
                      key={i}
                      className="absolute animate-snow rounded-full bg-white"
                      style={{ left: f.l, top: 0, width: f.s, height: f.s, animationDelay: f.d, animationDuration: f.dur, boxShadow: '0 0 3px rgba(255,255,255,0.9)' }}
                    />
                  ))}
                  <div
                    className="absolute left-[-6%] right-[-6%] bottom-0"
                    style={{ height: 11, background: 'linear-gradient(180deg, #ffffff 0%, #dfe9f2 100%)', borderRadius: '60% 60% 0 0 / 100% 100% 0 0' }}
                  />
                </div>
              )}

              {/* Wooden Window Grids / Mullions */}
              <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 4, background: '#8a5a3b' }} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 4, background: '#8a5a3b' }} />
            </div>

            {/* Creeping Window Vine */}
            <svg
              viewBox="0 0 100 133"
              preserveAspectRatio="xMinYMax meet"
              className="absolute inset-0 w-full h-full pointer-events-none"
              fill="none"
              aria-label="Window vine, grows as you read and keeps what it has grown"
            >
              <path
                d={VINE_D}
                stroke="#2e5934"
                strokeWidth={2.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={100}
                strokeDasharray={`${Math.round(vineG * 100)} 100`}
                style={{ transition: 'stroke-dasharray 1.4s ease' }}
              />
              {VINE_LEAVES.map((l, i) => (
                <g key={i} style={grow(true, vineG >= l.t - 0.02, `${l.x}px ${l.y}px`)}>
                  <Leaf x={l.x} y={l.y} side={l.side} r={35} c={i % 2 ? '#4e7f55' : '#71ab7a'} />
                </g>
              ))}
              {VINE_FLOWERS.map((f, i) => (
                <g key={`f${i}`} style={grow(true, vineG >= f.t + 0.04, `${f.x}px ${f.y}px`)}>
                  {[0, 72, 144, 216, 288].map(a => (
                    <ellipse key={a} cx={f.x} cy={f.y - 2.3} rx={1.5} ry={2.2} transform={`rotate(${a} ${f.x} ${f.y})`} fill={f.c} />
                  ))}
                  <circle cx={f.x} cy={f.y} r={1.1} fill="#ffd66b" />
                </g>
              ))}
            </svg>

            {/* Quick weather / time indicator pill on tap */}
            {tip && (
              <div role="status" className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-2 py-0.5 rounded-full bg-black/75 text-white text-[10px] font-sans whitespace-nowrap shadow-md">
                {tip}
              </div>
            )}
          </div>

          {/* Only when "Window follows the real time of day" is off in Settings: step through morning, day, sunset, night
              and (at night) through the moon phases */}
          {!followTime && (
            <div className="absolute z-20 flex items-center gap-1.5" style={{ bottom: 7, right: 7 }}>
              {windowNight && (
                <button
                  type="button"
                  onClick={handleCycleMoon}
                  className="scene-time flex items-center justify-center rounded-full bg-black/55 text-white shadow-md active:scale-90 transition-transform"
                  style={{ width: 26, height: 26, fontSize: 14, lineHeight: 1 }}
                  aria-label={`Moon: ${moonName}. Press to change the moon phase.`}
                  title="Change the moon phase"
                >
                  <span aria-hidden="true">{MOON_PHASE_EMOJI[shownMoon]}</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleCycleTime}
                className="scene-time flex items-center justify-center rounded-full bg-black/55 text-white shadow-md active:scale-90 transition-transform"
                style={{ width: 26, height: 26, fontSize: 14, lineHeight: 1 }}
                aria-label={`Showing ${PERIOD_LABEL[period]}. Press to change the time of day.`}
                title="Change the time of day in the window"
              >
                <span aria-hidden="true">{PERIOD_ICON[period]}</span>
              </button>
            </div>
          )}
        </div>

        {/* Bookshelves */}
        <div className="flex-1 min-w-0 flex flex-col">
          <NookClock weather={weather} dark={nookDark} large={big} />
          <div ref={shelfRef} className="flex flex-col">
          {shelves.map((row, i) => (
            <div key={i} className="flex items-end gap-[3px] justify-start px-1" style={{ borderBottom: '7px solid #8a5a3b', minHeight: SPINE_H, marginTop: i > 0 ? SHELF_GAP : 0 }}>
              {row.map(b => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onOpenBook(b)}
                  title={b.title}
                  aria-label={b.title}
                  className="scene-book shrink-0 relative overflow-hidden flex flex-col justify-between p-0.5 text-white"
                  style={{
                    width: !wide ? 'calc((100% - 18px) / 7)' : SPINE_W,
                    maxWidth: SPINE_W,
                    aspectRatio: '2/3',
                    borderRadius: 2,
                    background: b.spineColor || '#2e5934',
                    boxShadow: '1px 0 2px rgba(0,0,0,.35)',
                    transform: i === 0 && Number(b.id) % 5 === 0 ? 'rotate(-4deg)' : 'none',
                  }}
                >
                  <CoverFace book={b} size="nook" badge={false} eager={true} />
                </button>
              ))}
            </div>
          ))}
          </div>
        </div>
      </div>

      {/* Garden shelf below the window and bookshelf: every standing plant you have earned, scrolling sideways */}
      <GardenArea garden={garden} night={nookDark} areaId="shelf" />

      {/* Garden Status & Encouragement Bar */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pb-3 pt-2" style={{ background: 'rgba(146,88,56,.12)' }}>
        <span className="italic text-sm" style={{ color: nookDark ? '#e8dcc6' : '#706256' }}>
          {met ? '🌿 Your garden is thriving today' : `🌱 ${Math.max(0, goal - todayPages)} more pages to water your plants`}
        </span>
        <span className="text-sm font-semibold flex items-center gap-2" style={{ color: nookDark ? '#a9d8a3' : '#2e5934' }}>
          <span>{streak > 0 ? `🔥 ${streak}-day streak` : 'Start your streak today'}</span>
          <span className="text-xs opacity-75">· {tenPageDays} days of 10+ pages</span>
        </span>
      </div>
    </div>
  );
}
