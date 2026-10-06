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

export const NookClock = React.memo(function NookClock({ weather, dark }: { weather: WeatherData; dark: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    return () => clearTimeout(timer);
  }, []);

  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const icon = weatherIcon(weather.condition, weather.isNight);
  const temperature = weather.source === 'location' && typeof weather.temperature === 'number' ? `${weather.temperature}°C` : null;
  const sun = weather.source === 'location' && weather.sun
    ? ` · Sunrise ${fmtMinutes(weather.sun.rise)}, sunset ${fmtMinutes(weather.sun.set)}`
    : '';

  return (
    <div
      className="self-start mx-1 mt-1 mb-1.5 inline-flex items-center gap-2 rounded-lg px-2.5 py-1 font-sans tabular-nums"
      style={{
        background: dark ? 'rgba(0,0,0,.28)' : 'rgba(255,255,255,.45)',
        border: `1px solid ${dark ? 'rgba(255,255,255,.12)' : 'rgba(146,88,56,.25)'}`,
        color: dark ? '#f3e6d3' : '#3b2a1d',
      }}
      role="group"
      aria-label={`${time}, ${weather.description}${temperature ? `, ${temperature}` : ''}`}
      title={`${weather.description}${sun}`}
    >
      <span className="text-sm font-semibold leading-none" aria-hidden="true">{time}</span>
      <span className="text-base leading-none" aria-hidden="true">{icon}</span>
      {temperature && <span className="text-sm font-semibold leading-none" aria-hidden="true">{temperature}</span>}
    </div>
  );
});