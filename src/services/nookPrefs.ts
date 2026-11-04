/**
 * Two small, device-level reading-nook preferences (kept in localStorage like the weather options):
 * - nookMatchesTheme: off = the whole nook (wall, shelves, plants) follows the window's time of day;
 *                     on  = it follows your Appearance setting (Parchment / Night / System).
 * - windowFollowsTime: on (default) = the window shows the real time of day;
 *                      off = tapping the window's time button cycles morning / day / sunset / night to preview them.
 * A tiny subscribe/notify store lets the nook react immediately when Settings changes one of them.
 */
import { announceLocalChange, stampSetting } from './settingsTimes';

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
  stampSetting('nookToggles');
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
  stampSetting('nookToggles');
  notifyNookPrefs();
}

/** The cloud or a backup changed the nook toggles: store them without counting it as a new edit. */
export function applyNookTogglesFromSync(t: { matchTheme: boolean; windowFollowsTime: boolean }): void {
  try {
    if (t.matchTheme) localStorage.setItem(THEME_KEY, '1'); else localStorage.removeItem(THEME_KEY);
    if (t.windowFollowsTime) localStorage.removeItem(TIME_KEY); else localStorage.setItem(TIME_KEY, '0');
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
/** Tells the cloud sync that a synced preference changed on this device, so it uploads soon instead of waiting for the next other edit. */
export const getClockTheme = () => clockTheme;
export function cycleClockTheme() {
  clockTheme = (clockTheme + 1) % CLOCK_THEME_COUNT;
  try {
    localStorage.setItem(CLOCK_KEY, String(clockTheme));
  } catch {}
  clockSubs.forEach(f => f());
  announceLocalChange();
}

/* ---- Vine look: the wraparound nook vine (default), the classic window vine, or a seasonal / lit variant (remembered on this device) ---- */
export type VineStyle = 'nook' | 'classic' | 'lights' | 'halloween' | 'christmas';
export const VINE_STYLES: readonly VineStyle[] = ['classic', 'nook', 'lights', 'halloween', 'christmas'];
const VINE_KEY = 'greatreads_vine_style'; // the style's id; missing or unknown = the nook vine
const vineSubs = new Set<() => void>();

export const subscribeVineStyle = (cb: () => void) => {
  vineSubs.add(cb);
  return () => {
    vineSubs.delete(cb);
  };
};
const asVineStyle = (v: unknown): VineStyle => (VINE_STYLES.includes(v as VineStyle) ? (v as VineStyle) : 'nook');
export function getVineStyle(): VineStyle {
  try {
    return asVineStyle(localStorage.getItem(VINE_KEY));
  } catch {
    return 'nook';
  }
}
export function setVineStyle(style: VineStyle) {
  try {
    if (style === 'nook') localStorage.removeItem(VINE_KEY);
    else localStorage.setItem(VINE_KEY, style);
  } catch {}
  vineSubs.forEach(f => f());
  announceLocalChange();
}

/* ---- Nook decorations: what hangs on the wall above the shelves and what sits on the garden shelf ---- */
export type DecorId = 'frame-thanks' | 'clock' | 'frame-art' | 'mug';
export type DecorArea = 'wall' | 'shelf';
export const DECOR_IDS: readonly DecorId[] = ['frame-thanks', 'clock', 'frame-art', 'mug'];
export const DECOR_AREAS: readonly DecorArea[] = ['wall', 'shelf'];
export const MUGS = ['coffee', 'tea', 'cocoa'] as const;
export const CLOCKS = ['digital', 'analog'] as const;
export const ARTS = ['books', 'moon', 'sunflower', 'hills', 'heart', 'words'] as const;
export const ART_TEXT_MAX = 28;
export interface NookDecor {
  /** Left-to-right order in each area. Every decoration is in exactly one area. */
  order: Record<DecorArea, DecorId[]>;
  /** Decorations taken down (they come back where they were in the order) */
  hidden: DecorId[];
  mug: (typeof MUGS)[number];
  clock: (typeof CLOCKS)[number];
  art: (typeof ARTS)[number];
  /** The words in the second frame when art is 'words' */
  artText: string;
}
export const DEFAULT_DECOR: NookDecor = {
  order: { wall: ['frame-thanks', 'clock', 'frame-art'], shelf: ['mug'] },
  hidden: [],
  mug: 'coffee',
  clock: 'digital',
  art: 'books',
  artText: 'Read a little every day',
};

const pick = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

/** Repairs anything read from storage or a pasted backup: unknown ids dropped, missing ones put back where they belong. */
export function sanitizeDecor(raw: unknown): NookDecor {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : {};
  const seen = new Set<DecorId>();
  const order = { wall: [] as DecorId[], shelf: [] as DecorId[] };
  for (const area of DECOR_AREAS) {
    const list = Array.isArray(r.order?.[area]) ? r.order[area] : [];
    for (const id of list) if (DECOR_IDS.includes(id) && !seen.has(id)) { seen.add(id); order[area].push(id); }
  }
  for (const area of DECOR_AREAS) for (const id of DEFAULT_DECOR.order[area]) if (!seen.has(id)) { seen.add(id); order[area].push(id); }
  const hidden = Array.isArray(r.hidden) ? [...new Set<DecorId>(r.hidden.filter((id: unknown) => DECOR_IDS.includes(id as DecorId)))] : [];
  const text = typeof r.artText === 'string' ? r.artText.replace(/\s+/g, ' ').trim().slice(0, ART_TEXT_MAX) : '';
  return {
    order, hidden,
    mug: pick(MUGS, r.mug, 'coffee'),
    clock: pick(CLOCKS, r.clock, 'digital'),
    art: pick(ARTS, r.art, 'books'),
    artText: text || DEFAULT_DECOR.artText,
  };
}

const DECOR_KEY = 'greatreads_nook_decor_v1';
let decor: NookDecor = (() => {
  try {
    const raw = localStorage.getItem(DECOR_KEY);
    return raw ? sanitizeDecor(JSON.parse(raw)) : DEFAULT_DECOR;
  } catch {
    return DEFAULT_DECOR;
  }
})();
const decorSubs = new Set<() => void>();
export const subscribeNookDecor = (cb: () => void) => {
  decorSubs.add(cb);
  return () => {
    decorSubs.delete(cb);
  };
};
export const getNookDecor = () => decor;
const isDefaultDecor = (d: NookDecor) => JSON.stringify(d) === JSON.stringify(DEFAULT_DECOR);
export function setNookDecor(next: NookDecor) {
  decor = sanitizeDecor(next);
  try {
    if (isDefaultDecor(decor)) localStorage.removeItem(DECOR_KEY);
    else localStorage.setItem(DECOR_KEY, JSON.stringify(decor));
  } catch {}
  decorSubs.forEach(f => f());
  announceLocalChange();
}

/** Decorations that are up, in order, for an area */
export const visibleDecor = (d: NookDecor, area: DecorArea): DecorId[] => d.order[area].filter(id => !d.hidden.includes(id));

/** Put `id` at `index` (0 = first) in `area`; every other decoration keeps its order. */
export function moveDecor(d: NookDecor, id: DecorId, area: DecorArea, index: number): NookDecor {
  const order = { wall: d.order.wall.filter(x => x !== id), shelf: d.order.shelf.filter(x => x !== id) };
  order[area].splice(Math.max(0, Math.min(order[area].length, Math.round(index))), 0, id);
  return { ...d, order };
}
export const toggleDecor = (d: NookDecor, id: DecorId): NookDecor => ({ ...d, hidden: d.hidden.includes(id) ? d.hidden.filter(x => x !== id) : [...d.hidden, id] });

/* ---- Backups: the nook's look travels with a backup like picked covers do; a default look adds nothing to it ---- */
export interface NookLookBackup { vine?: VineStyle; clockTheme?: number; decor?: NookDecor }
export function exportNookLook(): NookLookBackup | undefined {
  const out: NookLookBackup = {};
  if (getVineStyle() !== 'nook') out.vine = getVineStyle();
  if (clockTheme !== 0) out.clockTheme = clockTheme;
  if (!isDefaultDecor(decor)) out.decor = decor;
  return Object.keys(out).length ? out : undefined;
}
/** Restores the look from a backup's `nookLook`. A backup made before this existed leaves the current look alone. */
export function restoreNookLook(jsonStr: string) {
  let raw: any;
  try { raw = JSON.parse(jsonStr)?.nookLook; } catch { return; }
  if (!raw || typeof raw !== 'object') return;
  setVineStyle(asVineStyle(raw.vine));
  const n = Number(raw.clockTheme);
  clockTheme = Number.isInteger(n) && n >= 0 && n < CLOCK_THEME_COUNT ? n : 0;
  try { clockTheme ? localStorage.setItem(CLOCK_KEY, String(clockTheme)) : localStorage.removeItem(CLOCK_KEY); } catch {}
  clockSubs.forEach(f => f());
  setNookDecor(sanitizeDecor(raw.decor));
}
