/**
 * Two small, device-level reading-nook preferences (kept in localStorage like the weather options):
 * - nookMatchesTheme: off = the whole nook (wall, shelves, plants) follows the window's time of day;
 *                     on  = it follows your Appearance setting (Parchment / Night / System).
 * - windowFollowsTime: on (default) = the window shows the real time of day;
 *                      off = tapping the window's time button cycles morning / day / sunset / night to preview them.
 * A tiny subscribe/notify store lets the nook react immediately when Settings changes one of them.
 */
const THEME_KEY = 'greatreads_nook_match_theme'; // '1' = match the app theme
const TIME_KEY = 'greatreads_window_follows_time'; // '0' = free to cycle; anything else = follow the clock

let version = 0;
const subs = new Set<() => void>();

export const subscribeNookPrefs = (cb: () => void) => {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
};

/** Bumps whenever a nook/weather preference changes, so the scene can re-read the weather. */
export const getNookPrefsVersion = () => version;

export function notifyNookPrefs() {
  version++;
  subs.forEach(f => f());
}

export function getNookMatchesTheme(): boolean {
  try {
    return localStorage.getItem(THEME_KEY) === '1';
  } catch {
    return false;
  }
}

export function setNookMatchesTheme(on: boolean) {
  try {
    if (on) localStorage.setItem(THEME_KEY, '1');
    else localStorage.removeItem(THEME_KEY);
  } catch {}
  notifyNookPrefs();
}

export function getWindowFollowsTime(): boolean {
  try {
    return localStorage.getItem(TIME_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setWindowFollowsTime(on: boolean) {
  try {
    if (on) localStorage.removeItem(TIME_KEY);
    else localStorage.setItem(TIME_KEY, '0');
  } catch {}
  notifyNookPrefs();
}

/* ---- Clock colours: tap the wall clock to cycle through a few looks (remembered on this device) ---- */
export const CLOCK_THEME_COUNT = 5;
const CLOCK_KEY = 'greatreads_clock_theme';
let clockTheme = (() => {
  try {
    const n = Number(localStorage.getItem(CLOCK_KEY));
    return Number.isInteger(n) && n >= 0 && n < CLOCK_THEME_COUNT ? n : 0;
  } catch {
    return 0;
  }
})();
const clockSubs = new Set<() => void>();

export const subscribeClockTheme = (cb: () => void) => {
  clockSubs.add(cb);
  return () => {
    clockSubs.delete(cb);
  };
};
export const getClockTheme = () => clockTheme;
export function cycleClockTheme() {
  clockTheme = (clockTheme + 1) % CLOCK_THEME_COUNT;
  try {
    localStorage.setItem(CLOCK_KEY, String(clockTheme));
  } catch {}
  clockSubs.forEach(f => f());
}
