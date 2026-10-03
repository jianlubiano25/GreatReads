export type WeatherCondition = 'clear' | 'clouds' | 'rain' | 'snow';
export type TimePeriod = 'morning' | 'day' | 'sunset' | 'night';

export interface WeatherData {
  condition: WeatherCondition;
  period: TimePeriod;
  isNight: boolean;
  temperature?: number;
  description: string;
  source: 'location' | 'time' | 'manual';
}

const CACHE_KEY = 'greatreads_weather_v2';
const OVERRIDE_KEY = 'greatreads_weather_override';
const GEO_FAIL_KEY = 'greatreads_geo_failed';
const GEO_OPT_KEY = 'greatreads_weather_location'; // '1' only if you switched on "Match weather to my location"
const GEO_RETRY_MS = 60 * 60 * 1000; // after a refusal/timeout, don't ask the device for its location again for an hour

/**
 * Window daylight & celestial schedule:
 * - Morning: 05:00 - 08:30 (Dawn & gentle morning glow)
 * - Daytime: 08:30 - 17:30 (Radiant daylight sun)
 * - Sunset:  17:30 - 18:45 (Golden hour twilight & amber horizon)
 * - Night:   18:45 - 05:00 (Starlit night, deep navy sky & glowing moon)
 * (7:00 PM is 19:00, comfortably in Night mode!)
 */
export function getTimePeriod(now: Date = new Date()): { period: TimePeriod; isNight: boolean } {
  const hr = now.getHours();
  const min = now.getMinutes();
  const totalMinutes = hr * 60 + min;

  // 05:00 to 08:30: Morning
  if (totalMinutes >= 300 && totalMinutes < 510) {
    return { period: 'morning', isNight: false };
  }
  // 08:30 to 17:30: Daytime
  if (totalMinutes >= 510 && totalMinutes < 1050) {
    return { period: 'day', isNight: false };
  }
  // 17:30 to 18:45: Sunset / Golden Twilight
  if (totalMinutes >= 1050 && totalMinutes < 1125) {
    return { period: 'sunset', isNight: false };
  }
  // 18:45 to 05:00: Night (Moon & Stars)
  return { period: 'night', isNight: true };
}

export function parseWmoCode(code: number): { condition: WeatherCondition; label: string } {
  // WMO Weather interpretation codes (WW)
  if (code === 0) return { condition: 'clear', label: 'Clear Sky' };
  if (code === 1 || code === 2) return { condition: 'clouds', label: 'Partly Cloudy' };
  if (code === 3) return { condition: 'clouds', label: 'Overcast' };
  if ([51, 53, 55, 56, 57].includes(code)) return { condition: 'rain', label: 'Gentle Drizzle' };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { condition: 'rain', label: 'Rain' };
  if ([95, 96, 99].includes(code)) return { condition: 'rain', label: 'Thunderstorm' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { condition: 'snow', label: 'Snow' };
  return { condition: 'clear', label: 'Fair' };
}

export async function fetchLocalWeather(): Promise<WeatherData | null> {
  if (typeof window === 'undefined') return null;

  // Check manual override first (if user tapped window to choose a specific ambiance)
  try {
    const override = localStorage.getItem(OVERRIDE_KEY);
    if (override && override !== 'auto') {
      const { period, isNight } = getTimePeriod();
      const cond = override as WeatherCondition;
      return {
        condition: cond,
        period,
        isNight,
        description:
          cond === 'rain'
            ? 'Cozy Rain'
            : cond === 'clouds'
            ? 'Drifting Clouds'
            : isNight
            ? 'Starlit Night'
            : 'Sunny Reading Day',
        source: 'manual',
      };
    }
  } catch {}

  // Check cache (10 minutes)
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.timestamp < 10 * 60 * 1000) {
        return parsed.data;
      }
    }
  } catch {}

  // Try Geolocation with Open-Meteo (not again for a while if the device already said no, so iOS doesn't re-prompt)
  // Location is OFF unless you turn it on in Settings, so the app never asks for it by itself.
  let geoBlocked = !isLocationWeatherEnabled();
  try {
    geoBlocked = geoBlocked || Date.now() - Number(sessionStorage.getItem(GEO_FAIL_KEY) || 0) < GEO_RETRY_MS;
  } catch {}
  if ('geolocation' in navigator && !geoBlocked) {
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 4000,
          maximumAge: 15 * 60 * 1000,
        });
      });

      const { latitude, longitude } = pos.coords;
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(2)}&longitude=${longitude.toFixed(2)}&current=weather_code,is_day,precipitation,temperature_2m`,
        { headers: { Accept: 'application/json' } }
      );

      if (res.ok) {
        const json = await res.json();
        const current = json.current;
        const timeData = getTimePeriod(new Date());

        // Open-Meteo returns current.is_day (1 for day, 0 for night calculated for user coordinates)
        const isNight = typeof current.is_day === 'number' ? current.is_day === 0 : timeData.isNight;
        const period: TimePeriod = isNight ? 'night' : timeData.period;
        const { condition, label } = parseWmoCode(current.weather_code || 0);

        const data: WeatherData = {
          condition: current.precipitation > 0.2 ? 'rain' : condition,
          period,
          isNight,
          temperature: Math.round(current.temperature_2m),
          description: isNight && condition === 'clear' ? 'Starlit Night' : label,
          source: 'location',
        };

        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
        } catch {}

        return data;
      }
    } catch {
      try { sessionStorage.setItem(GEO_FAIL_KEY, String(Date.now())); } catch {}
    }
  }

  // Fallback based on local system time
  const timeData = getTimePeriod(new Date());
  return {
    condition: 'clear',
    period: timeData.period,
    isNight: timeData.isNight,
    description: timeData.isNight ? 'Starlit Night' : timeData.period === 'sunset' ? 'Golden Twilight' : 'Pleasant Day',
    source: 'time',
  };
}

export function setWeatherOverride(override: 'auto' | WeatherCondition) {
  try {
    if (override === 'auto') {
      localStorage.removeItem(OVERRIDE_KEY);
    } else {
      localStorage.setItem(OVERRIDE_KEY, override);
    }
    // Bust cache on override
    sessionStorage.removeItem(CACHE_KEY);
  } catch {}
}

export function getWeatherOverride(): string {
  try {
    return localStorage.getItem(OVERRIDE_KEY) || 'auto';
  } catch {
    return 'auto';
  }
}

/** Location-based weather is optional and off by default (the scene already follows the time of day). */
export function isLocationWeatherEnabled(): boolean {
  try {
    return localStorage.getItem(GEO_OPT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setLocationWeatherEnabled(on: boolean) {
  try {
    if (on) localStorage.setItem(GEO_OPT_KEY, '1');
    else localStorage.removeItem(GEO_OPT_KEY);
    sessionStorage.removeItem(CACHE_KEY);
    sessionStorage.removeItem(GEO_FAIL_KEY);
  } catch {}
}
