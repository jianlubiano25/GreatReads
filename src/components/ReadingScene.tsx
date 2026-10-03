import React, { useEffect, useState, useSyncExternalStore, useMemo } from 'react';
import { Book } from '../types';
import { subscribeCovers, getCoversVersion } from '../services/coverRepair';
import { CoverFace } from './BookMeta';
import { fetchLocalWeather, setWeatherOverride, getTimePeriod, WeatherData, WeatherCondition } from '../services/weather';

interface Props {
  books: Book[];
  streak: number;
  todayPages: number;
  goal: number;
  goalDaysThisWeek: number;
  finishedCount: number;
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
const grow = (on: boolean, visible: boolean, extra = ''): React.CSSProperties => ({
  opacity: on && visible ? 1 : 0,
  transform: on && visible ? 'scale(1)' : 'scale(0.2)',
  transition: 'opacity .7s ease, transform .7s ease',
  ...(extra ? { transformOrigin: extra } : {}),
});

interface PlantProps {
  streak: number;
  met: number;
  goalDaysThisWeek: number;
  tenPageDays: number;
  onTap: (name: string, emoji: string, id: string) => void;
  swayingId: string | null;
}

export function ReadingScene({
  books,
  streak,
  todayPages,
  goal,
  goalDaysThisWeek,
  finishedCount,
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

  const vineTarget = Math.min(1, 0.12 + (streak + finishedCount * 0.7) / 12);
  const vineG = grown ? vineTarget : 0;
  const flowerG = grown ? Math.min(7, Math.max(0, goalDaysThisWeek)) / 7 : 0;

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

  // Interactive plant sway state
  const [swayingId, setSwayingId] = useState<string | null>(null);
  const [floatingParticle, setFloatingParticle] = useState<{ id: string; emoji: string; text: string } | null>(null);

  const handlePlantTap = (plantName: string, emoji: string, id: string) => {
    try {
      navigator.vibrate?.([15, 25]);
    } catch {}
    setSwayingId(id);
    setFloatingParticle({ id, emoji, text: `${emoji} ${plantName}` });
    setTimeout(() => setSwayingId(null), 900);
    setTimeout(() => setFloatingParticle(null), 1200);
  };

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
      className="relative rounded-2xl overflow-hidden border border-[#e3d7c3] dark:border-[#382f25] shadow-sm select-none"
      style={{
        background: night ? 'linear-gradient(#2b2233,#3a2c2c)' : 'linear-gradient(#f7ecd6,#efdcbc)',
      }}
    >
      <div className="flex items-end gap-2 sm:gap-4 px-3 pt-3">
        {/* Cozy Arched Window with Weather, Sun, Moon, Stars, Clouds & Rain */}
        <div
          className="relative shrink-0 cursor-pointer group"
          style={{ width: '28%', maxWidth: 155 }}
          onClick={handleCycleWeather}
          title="Tap window to switch cozy weather ambiance (Sun, Clouds, Rain)"
          role="button"
          aria-label={`Window showing ${weather.description}. Tap to change weather.`}
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
            aria-label="Window vine, grows with your streak and finished books"
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
          </svg>

          {/* Quick weather indicator pill on tap */}
          {showWeatherTip && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-2 py-0.5 rounded-full bg-black/75 text-white text-[10px] font-sans whitespace-nowrap shadow-md">
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

      {/* Wooden Garden Shelf: Coffee + Interactive Variety Plant Pots resting on matching wooden shelf plank */}
      <div
        className="flex items-end gap-3 sm:gap-5 px-3 sm:px-4 pt-8 pb-0 overflow-x-auto overflow-y-visible scrollbar-none"
        style={{
          borderBottom: '7px solid #8a5a3b',
          minHeight: 90,
          background: 'rgba(146,88,56,.06)',
        }}
      >
        {/* Steaming Coffee Cup */}
        <div className="flex flex-col items-center shrink-0 cursor-default select-none" title="A warm cup of coffee">
          <svg width={30} height={18} viewBox="0 0 30 18" aria-hidden="true">
            {[6, 13, 20].map((x, i) => (
              <path
                key={i}
                d={`M${x} 16 q-3 -5 0 -9 q3 -4 0 -7`}
                stroke="#a89a8a"
                strokeWidth={1.4}
                fill="none"
                strokeLinecap="round"
                opacity={0.7}
                className={`steam-${i}`}
              />
            ))}
          </svg>
          <div
            style={{
              width: 30,
              height: 22,
              background: '#fbf7ee',
              border: '2px solid #cfbe9f',
              borderRadius: '2px 2px 12px 12px',
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                right: -9,
                top: 3,
                width: 9,
                height: 11,
                border: '2px solid #cfbe9f',
                borderLeft: 0,
                borderRadius: '0 8px 8px 0',
              }}
            />
            <div style={{ margin: '2px 3px', height: 4, background: '#523724', borderRadius: 4 }} />
          </div>
        </div>

        {/* POT 1: Streak Sprout (Base pot, sways on tap, blooms on goal met) */}
        <div
          className={`relative shrink-0 cursor-pointer select-none transition-transform ${swayingId === 'pot-sprout' ? 'animate-plant-sway' : 'hover:scale-105 active:scale-95'}`}
          onClick={() => handlePlantTap('Streak Sprout', '🌱', 'pot-sprout')}
          title={`Streak Sprout: ${streak}-day streak. Tap to sway!`}
          role="button"
          tabIndex={0}
        >
          {floatingParticle?.id === 'pot-sprout' && (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 pointer-events-none z-30 px-2.5 py-0.5 rounded-full bg-[#201a15]/90 dark:bg-[#fbf7ee]/95 text-white dark:text-[#201a15] text-[10px] font-sans font-bold shadow-md whitespace-nowrap animate-particle-float flex items-center gap-1 border border-white/20 dark:border-black/10">
              {floatingParticle.text}
            </div>
          )}
          <svg width={48} height={62} viewBox="0 0 50 62" aria-label={`Streak plant, ${streak} day streak`}>
            <path d={`M25 40 L25 ${40 - Math.min(8, 1 + streak) * 3}`} stroke="#2e5934" strokeWidth={2.5} strokeLinecap="round" />
            {Array.from({ length: Math.min(8, 1 + streak) }, (_, i) => (
              <Leaf key={i} x={25 + (i % 2 ? 9 : -9)} y={38 - i * 3.6} r={i % 2 ? -35 : 35} c={['#3f6b45', '#4e7f55', '#5b9363', '#71ab7a'][i % 4]} s={1.5} />
            ))}
            {met && (
              <g>
                <circle cx={25} cy={40 - Math.min(8, 1 + streak) * 3 - 2} r={6} fill="#e7a1b4" />
                <circle cx={25} cy={40 - Math.min(8, 1 + streak) * 3 - 2} r={2.6} fill="#ffd66b" />
              </g>
            )}
            {/* Terracotta Pot */}
            <path d="M14 42 H36 L33 60 H17 Z" fill="#c26d45" />
            <rect x={13.5} y={42} width={23} height={3.5} rx={1} fill="#ad5933" />
          </svg>
        </div>

        {/* POT 2: Weekly Pink Blossom (Grows with goal days this week) */}
        <div
          className={`relative shrink-0 cursor-pointer select-none transition-transform ${swayingId === 'pot-blossom' ? 'animate-plant-sway' : 'hover:scale-105 active:scale-95'}`}
          onClick={() => handlePlantTap('Pink Blossom', '🌸', 'pot-blossom')}
          title={`Pink Blossom: ${goalDaysThisWeek}/7 goal days this week. Tap to sway!`}
          role="button"
          tabIndex={0}
        >
          {floatingParticle?.id === 'pot-blossom' && (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 pointer-events-none z-30 px-2.5 py-0.5 rounded-full bg-[#201a15]/90 dark:bg-[#fbf7ee]/95 text-white dark:text-[#201a15] text-[10px] font-sans font-bold shadow-md whitespace-nowrap animate-particle-float flex items-center gap-1 border border-white/20 dark:border-black/10">
              {floatingParticle.text}
            </div>
          )}
          <svg width={46} height={66} viewBox="0 0 48 66" aria-label={`Flower, ${goalDaysThisWeek} goal days this week`}>
            <path
              d="M24 46 C24 36 27 26 24 14"
              stroke="#2e5934"
              strokeWidth={2.4}
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={`${Math.round((0.18 + flowerG * 0.82) * 100)} 100`}
              style={{ transition: 'stroke-dasharray 1.2s ease' }}
            />
            {[0.25, 0.4, 0.55, 0.7, 0.85].map((t, i) => {
              const y = 46 - t * 32;
              const side = i % 2 ? 1 : -1;
              return (
                <g key={i} style={grow(true, flowerG >= t - 0.12, `24px ${y}px`)}>
                  <Leaf x={24 + side * 7} y={y} r={side * 38} c={i % 2 ? '#5b9363' : '#3f6b45'} s={1.4} />
                </g>
              );
            })}
            <g style={grow(true, flowerG >= 0.7, '24px 14px')}>
              {[0, 72, 144, 216, 288].map(a => (
                <ellipse key={a} cx={24} cy={8} rx={3.2} ry={5} transform={`rotate(${a} 24 14)`} fill={flowerG >= 1 ? '#e7a1b4' : '#f0c4cf'} />
              ))}
              <circle cx={24} cy={14} r={3} fill="#ffd66b" />
            </g>
            <g style={grow(true, flowerG >= 0.3 && flowerG < 0.7, '24px 14px')}>
              <ellipse cx={24} cy={12} rx={3} ry={4.5} fill="#e7a1b4" />
            </g>
            <path d="M14 46 H34 L31 64 H17 Z" fill="#e8dcc6" stroke="#cfbe9f" strokeWidth={1} />
            <rect x={14.6} y={46} width={18.8} height={4} fill="#3a7d80" />
          </svg>
        </div>

        {/* POT 3: Golden Sunflower 🌻 (Unlocked at 7-day streak OR 7 days with 10+ pages) */}
        <SunflowerPot
          streak={streak}
          tenPageDays={tenPageDays}
          swayingId={swayingId}
          onTap={handlePlantTap}
          floatingParticle={floatingParticle}
        />

        {/* POT 4: Velvet Rose 🌹 (Unlocked at 14-day streak OR 14 days with 10+ pages) */}
        <RosePot
          streak={streak}
          tenPageDays={tenPageDays}
          swayingId={swayingId}
          onTap={handlePlantTap}
          floatingParticle={floatingParticle}
        />

        {/* POT 5: Modern Snake Plant 🪴 (Unlocked at 21-day streak OR 21 days with 10+ pages) */}
        <SnakePlantPot
          streak={streak}
          tenPageDays={tenPageDays}
          swayingId={swayingId}
          onTap={handlePlantTap}
          floatingParticle={floatingParticle}
        />
      </div>

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

// -------------------------------------------------------------
// VARIETY POT 3: Golden Sunflower Pot
// -------------------------------------------------------------
function SunflowerPot({
  streak,
  tenPageDays,
  swayingId,
  onTap,
  floatingParticle,
}: {
  streak: number;
  tenPageDays: number;
  swayingId: string | null;
  onTap: (name: string, emoji: string, id: string) => void;
  floatingParticle: { id: string; emoji: string; text: string } | null;
}) {
  const isUnlocked = streak >= 7 || tenPageDays >= 7;
  const progressDays = Math.max(streak, tenPageDays);
  // Growth stage: 1 to 4 depending on pages/streak progress
  const stage = !isUnlocked ? 0 : Math.min(4, 1 + Math.floor((progressDays - 7) / 3));

  if (!isUnlocked) {
    return (
      <div
        className="relative shrink-0 opacity-70 cursor-pointer hover:opacity-100 transition-opacity"
        onClick={() => onTap('Sunflower (Unlocks at 7 days)', '🌻', 'pot-sunflower')}
        title={`Golden Sunflower: Unlocks at 7-day streak or 7 days with 10+ pages (${Math.min(7, progressDays)}/7)`}
      >
        <svg width={46} height={66} viewBox="0 0 48 66" aria-label="Sunflower pot locked">
          {/* Baby seedling sprout with lock aura */}
          <path d="M24 48 L24 36" stroke="#5a8b5e" strokeWidth={2} strokeLinecap="round" />
          <ellipse cx={20} cy={35} rx={4} ry={2.5} transform="rotate(-30 20 35)" fill="#7fae82" />
          <ellipse cx={28} cy={35} rx={4} ry={2.5} transform="rotate(30 28 35)" fill="#7fae82" />
          {/* Golden striped pot */}
          <path d="M14 48 H34 L31 64 H17 Z" fill="#b88340" />
          <rect x={13.5} y={48} width={21} height={3.5} rx={1} fill="#e5a93c" />
          <text x={24} y={59} textAnchor="middle" fontSize={9} fill="#fff" fontWeight="bold">7d</text>
        </svg>
      </div>
    );
  }

  return (
    <div
      className={`relative shrink-0 cursor-pointer select-none transition-transform ${swayingId === 'pot-sunflower' ? 'animate-plant-sway' : 'hover:scale-105 active:scale-95'}`}
      onClick={() => onTap('Golden Sunflower', '🌻', 'pot-sunflower')}
      title={`Golden Sunflower (Stage ${stage}/4) · Tap to sway!`}
      role="button"
      tabIndex={0}
    >
      {floatingParticle?.id === 'pot-sunflower' && (
        <div className="absolute -top-7 left-1/2 -translate-x-1/2 pointer-events-none z-30 px-2.5 py-0.5 rounded-full bg-[#201a15]/90 dark:bg-[#fbf7ee]/95 text-white dark:text-[#201a15] text-[10px] font-sans font-bold shadow-md whitespace-nowrap animate-particle-float flex items-center gap-1 border border-white/20 dark:border-black/10">
          {floatingParticle.text}
        </div>
      )}
      <svg width={48} height={68} viewBox="0 0 48 68" aria-label="Golden Sunflower">
        {/* Tall Stalk */}
        <path d="M24 48 L24 18" stroke="#33663a" strokeWidth={3} strokeLinecap="round" />
        {/* Broad Sunflower Leaves */}
        <path d="M24 38 C15 38 12 30 10 32 C12 38 18 42 24 40" fill="#4d8c56" />
        <path d="M24 30 C33 30 36 22 38 24 C36 30 30 34 24 32" fill="#589e62" />

        {/* Sunflower Head */}
        {stage >= 2 && (
          <g>
            {/* 12 Radiant Golden Yellow Petals */}
            {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(deg => (
              <ellipse
                key={deg}
                cx={24}
                cy={18}
                rx={3.2}
                ry={stage >= 3 ? 7.5 : 5}
                transform={`rotate(${deg} 24 18)`}
                fill="#f5b722"
              />
            ))}
            {/* Deep Brown Seed Center */}
            <circle cx={24} cy={18} r={stage >= 3 ? 5.5 : 4} fill="#543818" />
            <circle cx={24} cy={18} r={stage >= 3 ? 3.5 : 2.5} fill="#3b260e" />
          </g>
        )}
        {/* Pot: Warm clay pot with sunny stripe */}
        <path d="M14 48 H34 L31 64 H17 Z" fill="#c06d3d" />
        <rect x={13.5} y={48} width={21} height={3.5} rx={1} fill="#f5b722" />
      </svg>
    </div>
  );
}

// -------------------------------------------------------------
// VARIETY POT 4: Velvet Crimson Rose Pot 🌹
// -------------------------------------------------------------
function RosePot({
  streak,
  tenPageDays,
  swayingId,
  onTap,
  floatingParticle,
}: {
  streak: number;
  tenPageDays: number;
  swayingId: string | null;
  onTap: (name: string, emoji: string, id: string) => void;
  floatingParticle: { id: string; emoji: string; text: string } | null;
}) {
  const isUnlocked = streak >= 14 || tenPageDays >= 14;
  const progressDays = Math.max(streak, tenPageDays);
  const stage = !isUnlocked ? 0 : Math.min(4, 1 + Math.floor((progressDays - 14) / 4));

  if (!isUnlocked) {
    return (
      <div
        className="relative shrink-0 opacity-70 cursor-pointer hover:opacity-100 transition-opacity"
        onClick={() => onTap('Velvet Rose (Unlocks at 14 days)', '🌹', 'pot-rose')}
        title={`Velvet Rose: Unlocks at 14-day streak or 14 days with 10+ pages (${Math.min(14, progressDays)}/14)`}
      >
        <svg width={46} height={66} viewBox="0 0 48 66" aria-label="Velvet Rose locked">
          <path d="M24 48 L24 38" stroke="#486e4d" strokeWidth={2} strokeLinecap="round" />
          <ellipse cx={21} cy={37} rx={3.5} ry={2} transform="rotate(-35 21 37)" fill="#5e8863" />
          <ellipse cx={27} cy={37} rx={3.5} ry={2} transform="rotate(35 27 37)" fill="#5e8863" />
          <path d="M14 48 H34 L31 64 H17 Z" fill="#9e4343" />
          <rect x={13.5} y={48} width={21} height={3.5} rx={1} fill="#d95d5d" />
          <text x={24} y={59} textAnchor="middle" fontSize={9} fill="#fff" fontWeight="bold">14d</text>
        </svg>
      </div>
    );
  }

  return (
    <div
      className={`relative shrink-0 cursor-pointer select-none transition-transform ${swayingId === 'pot-rose' ? 'animate-plant-sway' : 'hover:scale-105 active:scale-95'}`}
      onClick={() => onTap('Velvet Rose', '🌹', 'pot-rose')}
      title={`Velvet Rose (Stage ${stage}/4) · Tap to sway!`}
      role="button"
      tabIndex={0}
    >
      {floatingParticle?.id === 'pot-rose' && (
        <div className="absolute -top-7 left-1/2 -translate-x-1/2 pointer-events-none z-30 px-2.5 py-0.5 rounded-full bg-[#201a15]/90 dark:bg-[#fbf7ee]/95 text-white dark:text-[#201a15] text-[10px] font-sans font-bold shadow-md whitespace-nowrap animate-particle-float flex items-center gap-1 border border-white/20 dark:border-black/10">
          {floatingParticle.text}
        </div>
      )}
      <svg width={48} height={68} viewBox="0 0 48 68" aria-label="Velvet Rose">
        {/* Thorny Stem */}
        <path d="M24 48 C25 38 23 28 24 16" stroke="#2a5430" strokeWidth={2.6} strokeLinecap="round" />
        {/* Serrated Side Leaves */}
        <path d="M24 36 C18 34 14 36 12 32 C14 29 18 31 24 34" fill="#3d7345" />
        <path d="M24 28 C30 26 34 28 36 24 C34 21 30 23 24 26" fill="#46824f" />

        {/* Rose Flower Bloom */}
        <g transform="translate(24, 15)">
          {stage >= 3 ? (
            // Full Velvet Bloom
            <>
              <ellipse cx={0} cy={0} rx={9} ry={8} fill="#b81d3f" />
              <ellipse cx={-3} cy={-2} rx={6} ry={5} fill="#d12349" />
              <ellipse cx={3} cy={-1} rx={6} ry={5} fill="#e6345b" />
              <ellipse cx={0} cy={1} rx={5} ry={4} fill="#ad1435" />
              <circle cx={0} cy={-1} r={3} fill="#800a22" />
            </>
          ) : (
            // Rosebud
            <>
              <ellipse cx={0} cy={0} rx={5.5} ry={7} fill="#c42549" />
              <path d="M -5 3 C -4 -4 0 -6 0 -6 C 0 -6 4 -4 5 3 Z" fill="#9e1534" />
            </>
          )}
        </g>
        {/* Pot */}
        <path d="M14 48 H34 L31 64 H17 Z" fill="#755047" />
        <rect x={13.5} y={48} width={21} height={3.5} rx={1} fill="#b81d3f" />
      </svg>
    </div>
  );
}

// -------------------------------------------------------------
// VARIETY POT 5: Modern Snake Plant (Sansevieria) 🪴
// -------------------------------------------------------------
function SnakePlantPot({
  streak,
  tenPageDays,
  swayingId,
  onTap,
  floatingParticle,
}: {
  streak: number;
  tenPageDays: number;
  swayingId: string | null;
  onTap: (name: string, emoji: string, id: string) => void;
  floatingParticle: { id: string; emoji: string; text: string } | null;
}) {
  const isUnlocked = streak >= 21 || tenPageDays >= 21;
  const progressDays = Math.max(streak, tenPageDays);

  if (!isUnlocked) {
    return (
      <div
        className="relative shrink-0 opacity-70 cursor-pointer hover:opacity-100 transition-opacity"
        onClick={() => onTap('Snake Plant (Unlocks at 21 days)', '🪴', 'pot-snake')}
        title={`Snake Plant: Unlocks at 21-day streak or 21 days with 10+ pages (${Math.min(21, progressDays)}/21)`}
      >
        <svg width={46} height={66} viewBox="0 0 48 66" aria-label="Snake plant locked">
          <path d="M24 48 L24 38" stroke="#366345" strokeWidth={3} strokeLinecap="round" />
          <path d="M15 48 H33 L31 64 H17 Z" fill="#d9e0db" stroke="#9bb1a2" strokeWidth={1} />
          <rect x={14.5} y={48} width={19} height={3.5} rx={1} fill="#547d63" />
          <text x={24} y={59} textAnchor="middle" fontSize={9} fill="#335940" fontWeight="bold">21d</text>
        </svg>
      </div>
    );
  }

  return (
    <div
      className={`relative shrink-0 cursor-pointer select-none transition-transform ${swayingId === 'pot-snake' ? 'animate-plant-sway' : 'hover:scale-105 active:scale-95'}`}
      onClick={() => onTap('Sansevieria Snake Plant', '🪴', 'pot-snake')}
      title="Sansevieria Snake Plant · Tap to sway!"
      role="button"
      tabIndex={0}
    >
      {floatingParticle?.id === 'pot-snake' && (
        <div className="absolute -top-7 left-1/2 -translate-x-1/2 pointer-events-none z-30 px-2.5 py-0.5 rounded-full bg-[#201a15]/90 dark:bg-[#fbf7ee]/95 text-white dark:text-[#201a15] text-[10px] font-sans font-bold shadow-md whitespace-nowrap animate-particle-float flex items-center gap-1 border border-white/20 dark:border-black/10">
          {floatingParticle.text}
        </div>
      )}
      <svg width={48} height={68} viewBox="0 0 48 68" aria-label="Snake Plant">
        {/* Tall Architectural Spear Leaves */}
        {/* Center Spear */}
        <path d="M24 48 Q23 26 24 10 Q25 26 24 48 Z" fill="#2d5e3b" stroke="#e0c753" strokeWidth={1.2} />
        {/* Left Spear */}
        <path d="M21 48 Q15 28 17 14 Q20 28 21 48 Z" fill="#3b7a4e" stroke="#e0c753" strokeWidth={1.2} />
        {/* Right Spear */}
        <path d="M27 48 Q33 28 31 14 Q28 28 27 48 Z" fill="#3b7a4e" stroke="#e0c753" strokeWidth={1.2} />
        {/* Far Left Small Spear */}
        <path d="M19 48 Q11 36 13 22 Q17 35 19 48 Z" fill="#4d9462" stroke="#e0c753" strokeWidth={1} />
        {/* Far Right Small Spear */}
        <path d="M29 48 Q37 36 35 22 Q31 35 29 48 Z" fill="#4d9462" stroke="#e0c753" strokeWidth={1} />

        {/* Modern Minimalist Ivory Ceramic Cylinder Pot */}
        <rect x="15" y="47" width="18" height="17" rx="3" fill="#f4efe6" stroke="#cfbe9f" strokeWidth="1" />
        <rect x="15" y="47" width="18" height="3" rx="1" fill="#4a7c59" />
      </svg>
    </div>
  );
}
