/**
 * The theme (accent) colour: the green of the Today goal, the Reading now card's tint and progress, the day dots. Chosen in Profile > Appearance
 * (a few ready-made colours, or any colour), saved on this device, and applied as CSS variables so nothing needs to redraw. Unset = the
 * original green; the components carry that green as the variable's fallback.
 */
export const DEFAULT_THEME_COLOR = '#2e5934';
export const THEME_COLORS: readonly { name: string; hex: string }[] = [
  { name: 'Forest', hex: '#2e5934' },
  { name: 'Ocean', hex: '#2f6f9f' },
  { name: 'Plum', hex: '#7a4a8c' },
  { name: 'Terracotta', hex: '#b5573a' },
  { name: 'Slate', hex: '#4a5a6a' },
  { name: 'Rose', hex: '#b04a6a' },
];
const KEY = 'readlife.themecolor1';

/** "#2E5934" / "2e5934" / "#2e5" -> "#2e5934"; anything else -> null */
export function normalizeHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let h = v.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(h)) h = h.split('').map(c => c + c).join('');
  return /^[0-9a-f]{6}$/.test(h) ? `#${h}` : null;
}

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (c: number[]) => `#${c.map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`;

/** The colour mixed toward white: readable as text and fills on the dark theme. */
export function lighten(hex: string, amount = 0.45): string {
  return toHex(rgb(hex).map(x => x + (255 - x) * amount));
}
/** The colour mixed toward black: the pressed / hover shade. */
export function darken(hex: string, amount = 0.2): string {
  return toHex(rgb(hex).map(x => x * (1 - amount)));
}

export function getThemeColor(): string {
  try { return normalizeHex(localStorage.getItem(KEY)) ?? DEFAULT_THEME_COLOR; } catch { return DEFAULT_THEME_COLOR; }
}

/** Put a colour on the page (called at start and after every change). Safe outside a browser. */
export function applyThemeColor(hex: string = getThemeColor()): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  const c = normalizeHex(hex) ?? DEFAULT_THEME_COLOR;
  if (c === DEFAULT_THEME_COLOR) { root.removeProperty('--rl-accent'); root.removeProperty('--rl-accent-light'); root.removeProperty('--rl-accent-dark'); return; }
  root.setProperty('--rl-accent', c);
  root.setProperty('--rl-accent-light', lighten(c));
  root.setProperty('--rl-accent-dark', darken(c));
}

export function setThemeColor(hex: string): string {
  const c = normalizeHex(hex) ?? DEFAULT_THEME_COLOR;
  try { c === DEFAULT_THEME_COLOR ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, c); } catch {}
  applyThemeColor(c);
  return c;
}
