/**
 * Stand-in covers (no picture yet, or none exists), in the manner of Apple Books: a flat colour, the FULL title in bold white,
 * the author beneath it in black. Six colour styles; a book always gets the same one (chosen from its title + author), so a
 * cover never changes colour between visits or screens. Pure functions only: BookMeta.tsx draws it.
 */

export interface PlaceholderStyle {
  id: number;
  /** flat background, with a soft top-to-bottom shade added on top */
  bg: string;
  /** a slightly deeper tone of the same colour, for the shade at the bottom edge */
  shade: string;
}

export const PLACEHOLDER_STYLES: readonly PlaceholderStyle[] = [
  { id: 0, bg: '#EF5B48', shade: '#D9432F' }, // coral
  { id: 1, bg: '#1E9E9A', shade: '#157E7B' }, // teal
  { id: 2, bg: '#8B6FE0', shade: '#6F52C9' }, // violet
  { id: 3, bg: '#3B9AE8', shade: '#2379C4' }, // sky
  { id: 4, bg: '#E8588C', shade: '#CC3E73' }, // pink
  { id: 5, bg: '#3FAE5F', shade: '#2D9049' }, // green
];

/** Small stable hash (FNV-1a) -> 0..2^32-1 */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // final mixing: without it the last letters barely change the low bits, and only some of the six colours would ever be used
  h ^= h >>> 16; h = Math.imul(h, 2246822507);
  h ^= h >>> 13; h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

export function placeholderStyleFor(book: { title?: string; author?: string }): PlaceholderStyle {
  const key = `${(book.title || '').trim()}|${(book.author || '').trim()}`.toLowerCase();
  return PLACEHOLDER_STYLES[hash(key) % PLACEHOLDER_STYLES.length];
}

/** How much larger the type is than the first version (about 20% at every size band) */
export const TITLE_SCALE = 1.2;

/**
 * The cover is 1.5 times as tall as it is wide (units below are % of the cover's width). The title block is the cover minus its padding (9 + 8 on top and
 * bottom, 9 on each side) and minus a reserve at the bottom for the author line (up to two lines of the larger author type).
 */
const TITLE_BLOCK_W = 82;
const TITLE_BLOCK_H = 150 - 17 - 27;
const AVG_CHAR_EM = 0.58; // an average bold letter (capitals and lowercase) is about this wide, in em
const LINE_HEIGHT = 1.08;

/** How many lines the title takes at this size (greedy word wrap; a word wider than a line is broken, as `overflowWrap: anywhere` does). */
export function titleLines(title: string, size: number): number {
  const perLine = Math.max(1, Math.floor(TITLE_BLOCK_W / (size * AVG_CHAR_EM)));
  let lines = 1;
  let used = 0;
  for (const word of (title || '').trim().split(/\s+/).filter(Boolean)) {
    let len = word.length;
    if (used && used + 1 + len <= perLine) { used += 1 + len; continue; }
    if (used) { lines++; used = 0; }
    while (len > perLine) { lines++; len -= perLine; }
    used = len;
  }
  return lines;
}

/**
 * Title size as a percentage of the cover's WIDTH (used with container query units, so the same rule fits a nook spine and a
 * full-size detail cover). Each length band is about 20% larger than before; a long title still gets smaller type, and the size is lowered
 * until the WHOLE title fits in the space above the author (never cut off, never over the author line).
 */
export function titleSizeCqw(title: string): number {
  const t = (title || '').trim();
  // the longest word decides the largest size that still fits on one line of a ~80%-wide text block
  const longest = t.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 1);
  const byLength = (t.length <= 10 ? 23 : t.length <= 20 ? 18 : t.length <= 32 ? 15 : t.length <= 50 ? 12.5 : t.length <= 80 ? 10 : 8.5) * TITLE_SCALE;
  const byWord = 78 / (longest * 0.62); // an average bold capital-and-lowercase letter is about 0.62em wide
  let size = Math.max(6.5, Math.min(byLength, byWord));
  while (size > 6.5 && titleLines(t, size) * size * LINE_HEIGHT > TITLE_BLOCK_H) size -= 0.25;
  return Math.max(6.5, size);
}

/**
 * A front cover is upright: about 0.6 to 0.9 wide for every 1 tall (Open Library scans of near-square trade paperbacks, e.g. 438x500,
 * are ~0.88 and ARE fronts). A picture clearly wider than that is almost always a scan of the spine and back as well (a flat
 * wrap-around, ratio ~1.2+), a box set or a photo of a physical book on a table, none of which is wanted.
 * Unknown sizes pass (nothing to judge).
 */
export const MAX_FRONT_RATIO = 0.92;
export const MIN_FRONT_RATIO = 0.4;
export function isFrontCoverShape(width: number, height: number): boolean {
  if (!(width > 0) || !(height > 0)) return true;
  const r = width / height;
  return r <= MAX_FRONT_RATIO && r >= MIN_FRONT_RATIO;
}
