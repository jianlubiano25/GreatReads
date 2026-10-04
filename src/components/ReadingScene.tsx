import React, { useEffect, useState, useSyncExternalStore, useMemo } from 'react';
import { Book, GardenState } from '../types';
import { subscribeCovers, getCoversVersion } from '../services/coverRepair';
import { CoverFace } from './BookMeta';
import { fetchLocalWeather, setWeatherOverride, getTimePeriod, WeatherData, WeatherCondition } from '../services/weather';
import { GardenArea } from './garden/GardenView';

interface Props {
  books: Book[];
  streak: number;
  todayPages: number;
  goal: number;
  garden: GardenState;
  dailyLog?: Record<string, number>;
  onOpenBook: (b: Book) => void;
}

const Leaf = ({ x, y, r, c, s = 1.5 }: { x: number; y: number; r: number; c: string; s?: number }) => (
  <ellipse cx={x} cy={y} rx={6 * s} ry={3.2 * s} transform={`rotate(${r} ${x} ${y})`} fill={c} />
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
      description: tp.isNight ? 'Starlit Night' : tp.period === 'sunset' ? 'Golden Twilight' : 'Pleasant Day',
      source: 'time',
    };
  });
  const [showWeatherTip, setShowWeatherTip] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetchLocalWeather().then(w => {
      if (mounted && w) setWeather(w);
    });
    const interval = setInterval(() => {
      fetchLocalWeather().then(w => {
        if (mounted && w) setWeather(w);
      });
    }, 60_000); // 1 min refresh for time and light transitions
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Screen width & shelves
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 640);
  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const perShelf = wide ? 12 : 7;
  const shelves = [0, 1].map(i => books.slice(i * perShelf, (i + 1) * perShelf));

  // Count total days with 10+ pages
  const tenPageDays = useMemo(() => {
    return Object.values(dailyLog).filter(pages => Number(pages) >= 10).length;
  }, [dailyLog]);

  const handleCycleWeather = () => {
    const modes: WeatherCondition[] = ['clear', 'clouds', 'rain'];
    const curIdx = modes.indexOf(weather.condition);
    const nextCond = modes[(curIdx + 1) % modes.length];
    setWeatherOverride(nextCond);
    setWeather(prev => ({
      ...prev,
      condition: nextCond,
      description: nextCond === 'rain' ? 'Cozy Rain' : nextCond === 'clouds' ? 'Drifting Clouds' : prev.isNight ? 'Starlit Night' : 'Sunny Reading Day',
      source: 'manual',
    }));
    setShowWeatherTip(true);
    setTimeout(() => setShowWeatherTip(false), 2400);
  };

  const night = weather.isNight;
  const isRain = weather.condition === 'rain';
  const isCloudy = weather.condition === 'clouds';

  // Sky gradient styling
  const skyBackground = night
    ? 'linear-gradient(180deg, #0f1629 0%, #202644 100%)'
    : weather.period === 'sunset'
    ? 'linear-gradient(180deg, #e76f51 0%, #f4a261 50%, #fde2b4 100%)'
    : isRain
    ? 'linear-gradient(180deg, #6c7c8c 0%, #9cb2c4 100%)'
    : isCloudy
    ? 'linear-gradient(180deg, #8ba8b7 0%, #d8e6ed 100%)'
    : 'linear-gradient(180deg, #68b3e8 0%, #d6edfc 100%)';

  return (
    <div
      className="rl-scene relative rounded-2xl overflow-hidden border border-[#e3d7c3] dark:border-[#382f25] shadow-sm select-none"
      style={{
        background: night ? 'linear-gradient(#2b2233,#3a2c2c)' : 'linear-gradient(#f7ecd6,#efdcbc)',
      }}
    >
      {/* Hanging plants: a rail above the window and bookshelf (scrolls sideways; hidden until something hangs) */}
      <GardenArea garden={garden} night={night} areaId="hanging" />

      <div className="flex items-end gap-2 sm:gap-4 px-3 pt-3">
        {/* Cozy Arched Window with Weather, Sun, Moon, Stars, Clouds & Rain */}
        <div
          className="relative shrink-0 cursor-pointer group scene-window"
          style={{ width: '28%', maxWidth: 155 }}
          onClick={handleCycleWeather}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleCycleWeather();
            }
          }}
          title="Tap window to switch cozy weather ambiance (Sun, Clouds, Rain)"
          role="button"
          tabIndex={0}
          aria-label={`Window showing ${weather.description}. Press to change the weather.`}
        >
          <div
            style={{
              border: '5px solid #8a5a3b',
              borderRadius: '60px 60px 4px 4px',
              aspectRatio: '3/4',
              position: 'relative',
              overflow: 'hidden',
              background: skyBackground,
            }}
          >
            {/* Stars at night */}
            {night && (
              <div className="absolute inset-0 pointer-events-none">
                {[
                  { x: '18%', y: '15%', d: '0s', s: 3 },
                  { x: '72%', y: '22%', d: '0.4s', s: 2.5 },
                  { x: '35%', y: '32%', d: '0.8s', s: 2 },
                  { x: '82%', y: '45%', d: '1.2s', s: 3 },
                  { x: '24%', y: '60%', d: '0.6s', s: 2 },
                  { x: '65%', y: '70%', d: '1.5s', s: 2.8 },
                ].map((st, i) => (
                  <div
                    key={i}
                    className="absolute bg-white rounded-full animate-twinkle"
                    style={{
                      left: st.x,
                      top: st.y,
                      width: st.s,
                      height: st.s,
                      animationDelay: st.d,
                      boxShadow: '0 0 4px #ffffff',
                    }}
                  />
                ))}
              </div>
            )}

            {/* Sun or Moon */}
            {night ? (
              // Glowing Moon with crater detail
              <div
                className="absolute"
                style={{
                  top: '14%',
                  right: '18%',
                  width: '24%',
                  aspectRatio: '1',
                  borderRadius: '50%',
                  background: '#f8f4db',
                  boxShadow: '0 0 16px rgba(248, 244, 219, 0.85), inset -3px -3px 4px rgba(200, 190, 150, 0.4)',
                }}
              >
                {/* Subtle moon crater */}
                <div style={{ position: 'absolute', top: '28%', left: '26%', width: '22%', height: '22%', borderRadius: '50%', background: 'rgba(215, 205, 175, 0.35)' }} />
              </div>
            ) : (
              // Glowing Sun with warmth
              <div
                className="absolute"
                style={{
                  top: '12%',
                  right: '16%',
                  width: '26%',
                  aspectRatio: '1',
                  borderRadius: '50%',
                  background: '#ffd152',
                  boxShadow: '0 0 22px #ffc107, 0 0 38px rgba(255, 214, 107, 0.65)',
                }}
              />
            )}

            {/* Drifting Clouds */}
            {(isCloudy || isRain) && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute animate-cloud" style={{ top: '24%', left: '10%' }}>
                  <svg width="48" height="24" viewBox="0 0 48 24" fill="none">
                    <path
                      d="M10 20 H38 C42 20 45 17 45 13 C45 9.5 42 6.5 38.5 6.5 C37.8 3.5 35 1 31.5 1 C28.5 1 26 2.8 25 5 C24 3.8 22.5 3 20.8 3 C17.5 3 15 5.5 15 8.8 C12.5 9 10 11.5 10 14.5 C7.5 14.8 5 17 5 19.5 C5 19.8 5.2 20 10 20 Z"
                      fill={night ? 'rgba(180,195,220,0.35)' : isRain ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.85)'}
                    />
                  </svg>
                </div>
                <div className="absolute animate-cloud" style={{ top: '48%', left: '35%', animationDuration: '18s', animationDelay: '-6s' }}>
                  <svg width="40" height="20" viewBox="0 0 48 24" fill="none">
                    <path
                      d="M10 20 H38 C42 20 45 17 45 13 C45 9.5 42 6.5 38.5 6.5 C37.8 3.5 35 1 31.5 1 C28.5 1 26 2.8 25 5 C24 3.8 22.5 3 20.8 3 C17.5 3 15 5.5 15 8.8 C12.5 9 10 11.5 10 14.5 C7.5 14.8 5 17 5 19.5 Z"
                      fill={night ? 'rgba(140,160,190,0.3)' : 'rgba(255,255,255,0.65)'}
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
                <Leaf x={l.x + l.side * 6} y={l.y} r={l.side * 35} c={i % 2 ? '#4e7f55' : '#71ab7a'} s={1.5} />
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

          {/* Quick weather indicator pill on tap */}
          {showWeatherTip && (
            <div role="status" className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-2 py-0.5 rounded-full bg-black/75 text-white text-[10px] font-sans whitespace-nowrap shadow-md">
              {weather.description}
            </div>
          )}
        </div>

        {/* Bookshelves */}
        <div className="flex-1 min-w-0 flex flex-col">
          {shelves.map((row, i) => (
            <div key={i} className="flex items-end gap-[3px] justify-start px-1" style={{ borderBottom: '7px solid #8a5a3b', minHeight: 66 }}>
              {row.map(b => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onOpenBook(b)}
                  title={b.title}
                  aria-label={b.title}
                  className="scene-book shrink-0 relative overflow-hidden flex flex-col justify-between p-0.5 text-white"
                  style={{
                    width: perShelf === 7 ? 'calc((100% - 18px) / 7)' : 44,
                    maxWidth: 44,
                    aspectRatio: '2/3',
                    borderRadius: 2,
                    background: b.spineColor || '#2e5934',
                    boxShadow: '1px 0 2px rgba(0,0,0,.35)',
                    transform: i === 0 && Number(b.id) % 5 === 0 ? 'rotate(-4deg)' : 'none',
                  }}
                >
                  <CoverFace book={b} size="xs" badge={false} eager={true} />
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Garden shelf below the window and bookshelf: every standing plant you have earned, scrolling sideways */}
      <GardenArea garden={garden} night={night} areaId="shelf" />

      {/* Garden Status & Encouragement Bar */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pb-3 pt-2" style={{ background: 'rgba(146,88,56,.12)' }}>
        <span className="italic text-sm" style={{ color: night ? '#e8dcc6' : '#706256' }}>
          {met ? '🌿 Your garden is thriving today' : `🌱 ${Math.max(0, goal - todayPages)} more pages to water your plants`}
        </span>
        <span className="text-sm font-semibold flex items-center gap-2" style={{ color: night ? '#a9d8a3' : '#2e5934' }}>
          <span>{streak > 0 ? `🔥 ${streak}-day streak` : 'Start your streak today'}</span>
          <span className="text-xs opacity-75">· {tenPageDays} days of 10+ pages</span>
        </span>
      </div>
    </div>
  );
}
