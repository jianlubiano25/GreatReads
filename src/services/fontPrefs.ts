/**
 * Google Fonts choice (developer mode only: the picker sits under Appearance once the five-tap tools are on).
 * Two choices: the TITLE font (headings, the look of "font-serif-display") and the TEXT font (everything else).
 * Saved on this device. A font's stylesheet is fetched only when it is chosen (or while the picker is open, as a tiny
 * name-only preview), so the app's own load never waits for it; until it arrives the usual fonts show.
 */
export interface FontChoice { family: string; kind: 'serif' | 'sans' | 'display' | 'mono' }

export const TITLE_FONTS: readonly FontChoice[] = [
  { family: 'DM Serif Display', kind: 'serif' },
  { family: 'Playfair Display', kind: 'serif' },
  { family: 'Lora', kind: 'serif' },
  { family: 'Merriweather', kind: 'serif' },
  { family: 'Cormorant Garamond', kind: 'serif' },
  { family: 'Libre Baskerville', kind: 'serif' },
  { family: 'Abril Fatface', kind: 'display' },
  { family: 'Fraunces', kind: 'serif' },
  { family: 'Poppins', kind: 'sans' },
  { family: 'Montserrat', kind: 'sans' },
  { family: 'Space Grotesk', kind: 'sans' },
  { family: 'Bebas Neue', kind: 'display' },
];
export const TEXT_FONTS: readonly FontChoice[] = [
  { family: 'System (default)', kind: 'sans' },
  { family: 'Inter', kind: 'sans' },
  { family: 'Nunito', kind: 'sans' },
  { family: 'Lato', kind: 'sans' },
  { family: 'Open Sans', kind: 'sans' },
  { family: 'Source Serif 4', kind: 'serif' },
  { family: 'Literata', kind: 'serif' },
  { family: 'Merriweather', kind: 'serif' },
  { family: 'IBM Plex Sans', kind: 'sans' },
  { family: 'JetBrains Mono', kind: 'mono' },
];

export const DEFAULT_TITLE = 'DM Serif Display';
export const DEFAULT_TEXT = 'System (default)';
const KEY = 'readlife.fonts1';
const FALLBACK: Record<FontChoice['kind'], string> = { serif: 'Georgia, serif', sans: 'system-ui, sans-serif', display: 'Georgia, serif', mono: 'ui-monospace, monospace' };

export interface FontPrefs { title: string; text: string }

const known = (list: readonly FontChoice[], f: unknown): f is string => typeof f === 'string' && list.some(x => x.family === f);

export function getFontPrefs(): FontPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { title: known(TITLE_FONTS, v?.title) ? v.title : DEFAULT_TITLE, text: known(TEXT_FONTS, v?.text) ? v.text : DEFAULT_TEXT };
  } catch {
    return { title: DEFAULT_TITLE, text: DEFAULT_TEXT };
  }
}

const slug = (family: string) => family.trim().replace(/\s+/g, '+');

/** Google Fonts stylesheet URL for some families. `text` limits the download to the letters needed (a preview of the names). */
export function fontsUrl(families: readonly string[], text?: string): string {
  const fam = families.filter(f => f !== DEFAULT_TEXT).map(f => `family=${slug(f)}`).join('&');
  return `https://fonts.googleapis.com/css2?${fam}${text ? `&text=${encodeURIComponent(text)}` : ''}&display=swap`;
}

const loaded = new Set<string>();
/** Fetch a stylesheet once (an id keeps it from being added twice). */
function addSheet(id: string, href: string) {
  if (typeof document === 'undefined' || loaded.has(id)) return;
  loaded.add(id);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.id = `rl-font-${id}`;
  document.head.appendChild(link);
}

const stack = (family: string, list: readonly FontChoice[]): string => {
  const f = list.find(x => x.family === family);
  return family === DEFAULT_TEXT || !f ? '' : `"${family}", ${FALLBACK[f.kind]}`;
};

/** Put the saved choice on the page (called at start and after every change). Safe to call anywhere; no-ops outside a browser. */
export function applyFontPrefs(p: FontPrefs = getFontPrefs()): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  const title = p.title !== DEFAULT_TITLE ? stack(p.title, TITLE_FONTS) : '';
  const text = stack(p.text, TEXT_FONTS);
  title ? root.setProperty('--rl-title-font', title) : root.removeProperty('--rl-title-font');
  text ? root.setProperty('--rl-text-font', text) : root.removeProperty('--rl-text-font');
  if (p.title !== DEFAULT_TITLE) addSheet(`t-${slug(p.title)}`, fontsUrl([p.title]));
  if (p.text !== DEFAULT_TEXT) addSheet(`b-${slug(p.text)}`, fontsUrl([p.text]));
}

export function setFontPrefs(next: Partial<FontPrefs>): FontPrefs {
  const p = { ...getFontPrefs(), ...next };
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
  applyFontPrefs(p);
  return p;
}

/** The picker's previews: ONE small request that holds only the letters of the font names, loaded while the picker is open. */
export function loadFontPreviews(): void {
  const all = [...TITLE_FONTS, ...TEXT_FONTS].map(f => f.family);
  const uniq = [...new Set(all)].filter(f => f !== DEFAULT_TEXT);
  addSheet('previews', fontsUrl(uniq, [...new Set(uniq.join(''))].join('')));
}
