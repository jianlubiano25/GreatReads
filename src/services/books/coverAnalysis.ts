/**
 * Cover ANALYSIS: judging a cover without choosing one. How good a cover LINK is likely to be, whether a PICTURE is a flat front or a 3D render
 * (pixels, inspectCover, readCover), whether an image loads at all (probeImage), and the one key a book's cover records are filed under (coverKey).
 * (Split out of covers.ts with no change in behaviour; covers.ts re-exports everything.)
 */
import { type Book } from '../../types';
import { isAppleCoverUrl, isNytCoverUrl } from './model';
import { persistentCache } from './cache';
import { isFrontCoverShape } from './placeholderCover';

/* ======================================================================================================
 * how good a cover LINK is likely to be  (was coverQuality.ts)
 * ====================================================================================================== */

/**
 * How good a book's cover link is likely to be, judged from the LINK alone (nothing is loaded). A ranking signal, never a verdict: the picture itself is
 * still judged where it is drawn (covers.ts).
 *
 *   3  Apple Books art: flat, front-facing, modern
 *   2  a Google Books front cover (printsec=frontcover): the jacket of one real, usually recent, volume
 *   1  an Open Library cover (cover_i is often the work's oldest edition, or a scan of the whole wrap or an inside page) or any other link
 *   0.5  the NYT's marketing image: often a 3D render of a special edition
 *   0  no cover
 */
export type CoverQuality = 0 | 0.5 | 1 | 2 | 3;

const isGoogleFront = (url?: string): boolean => !!url && /books\.google\.[a-z.]+\/books\/(content|publisher\/content)/i.test(url) && /printsec=frontcover/i.test(url);

export function coverQuality(b: Pick<Book, 'coverId' | 'coverUrl'>): CoverQuality {
  const url = b.coverUrl;
  if (url) {
    if (isAppleCoverUrl(url)) return 3;
    if (isNytCoverUrl(url)) return 0.5;
    if (isGoogleFront(url)) return 2;
    return 1;
  }
  return b.coverId && b.coverId > 0 ? 1 : 0;
}

/** A cover worth looking for a better one: an Open Library cover or another plain link, or the NYT's art (never Apple's or a Google front). */
export const isWeakCover = (b: Pick<Book, 'coverId' | 'coverUrl'>): boolean => {
  const q = coverQuality(b);
  return q > 0 && q < 2;
};

/** Search ranking: having a cover is a tiebreaker, and a good flat front is a stronger one (the title match still decides first). */
export const COVER_BONUS = 8;
export const coverBonus = (b: Pick<Book, 'coverId' | 'coverUrl'>): number => {
  const q = coverQuality(b);
  return q === 0 ? 0 : q === 0.5 ? COVER_BONUS - 3 : COVER_BONUS + (q - 1) * 3; // NYT art 5, plain 8, Google front 11, Apple 14
};

/* ======================================================================================================
 * what a cover PICTURE is: flat front, or a 3D render  (was coverFlatness.ts)
 * ====================================================================================================== */

/**
 * "Is this picture a flat, front-facing jacket?" Publishers' marketing art for special editions is often a 3D render: the book tilted on a plain
 * background, or a front cover with the spine and page edges showing beside it. No source marks these, and no fixed order of sources avoids them
 * (Apple's art is the render for one book, Open Library's for the next), so the picture itself is judged: a small copy is drawn on a canvas and its
 * pixels are measured. Two signs, both about the PICTURE and not about any source:
 *
 *   isolated object   a plain background all around (a uniform ring at the border) holding one dense, solid shape: a book floating on white.
 *                     A flat jacket on a white page has sparse ink (text), so it does not look like a solid object.
 *   spine edge        a sharp, full-height vertical edge in the outer quarter, with clearly different colours either side: the front face meeting the spine.
 *
 * A verdict is only ever a RANKING signal: a render is skipped when a flat jacket exists, and still used when it is all there is. When the picture
 * cannot be read (the host sends no CORS headers and the proxy cannot help, no canvas, offline) the verdict is 'unknown', which behaves exactly as before.
 */

export type CoverVerdict = 'flat' | 'render' | 'unknown';
export interface CoverReading { verdict: CoverVerdict; reasons: string[]; bgSame: number; density: number; spineEdge: number; insets: [number, number, number, number] }

export const SAMPLE_W = 40;
export const SAMPLE_H = 60;

type RGB = [number, number, number];
const px = (d: ArrayLike<number>, w: number, x: number, y: number): RGB => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
const dist = (a: RGB, b: RGB) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const lum = (c: RGB) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const mean = (list: RGB[]): RGB => { const n = list.length || 1; return [0, 1, 2].map(k => list.reduce((s, c) => s + c[k], 0) / n) as RGB; };

/** The thresholds are exported so they can be tuned (and tested) in one place. */
export const FLAT_TUNING = {
  bgSameMin: 0.9, // share of the border ring that is the background colour
  bgTolerance: 36, // summed RGB distance counted as "the same colour"
  inkTolerance: 60, // distance from the background counted as part of the object
  densityMin: 0.62, // a solid object fills this much of its own bounding box
  insetMin: 0.05, // the object stops this far from at least one pair of sides
  edgeJump: 40, // luminance step that counts as an edge
  edgeRowsMin: 0.72, // share of rows that must show the same edge
  sideColourGap: 70, // colours either side of a spine edge differ by at least this
  blankLum: 38, // a background darker than this ...
  blankInk: 0.025, // ... with less than this share of the picture not the background is a black "cover to be revealed" image
};

/** Measure a W x H RGBA sample (any size; the app uses SAMPLE_W x SAMPLE_H). */
export function analyzePixels(data: ArrayLike<number>, w: number, h: number): CoverReading {
  const T = FLAT_TUNING;
  const empty: CoverReading = { verdict: 'unknown', reasons: [], bgSame: 0, density: 0, spineEdge: 0, insets: [0, 0, 0, 0] };
  if (w < 12 || h < 18 || data.length < w * h * 4) return empty;
  const reasons: string[] = [];

  // 1. a plain background all around?
  const band = Math.max(1, Math.round(Math.min(w, h) * 0.04));
  const corner = (cx: number, cy: number) => { const l: RGB[] = []; for (let y = 0; y < band * 2; y++) for (let x = 0; x < band * 2; x++) l.push(px(data, w, cx + x, cy + y)); return mean(l); };
  const bg = mean([corner(0, 0), corner(w - band * 2, 0), corner(0, h - band * 2), corner(w - band * 2, h - band * 2)]);
  let ringN = 0, ringSame = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x >= band && x < w - band && y >= band && y < h - band) continue;
    ringN++;
    if (dist(px(data, w, x, y), bg) <= T.bgTolerance) ringSame++;
  }
  const bgSame = ringSame / ringN;

  // 2. what stands on it: bounding box, and how solid it is
  let x0 = w, x1 = -1, y0 = h, y1 = -1, ink = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (dist(px(data, w, x, y), bg) > T.inkTolerance) { ink++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const boxArea = x1 >= x0 && y1 >= y0 ? (x1 - x0 + 1) * (y1 - y0 + 1) : 0;
  const density = boxArea ? ink / boxArea : 0;
  const insets: [number, number, number, number] = boxArea ? [x0 / w, (w - 1 - x1) / w, y0 / h, (h - 1 - y1) / h] : [0, 0, 0, 0];
  const isolated = bgSame >= T.bgSameMin && boxArea > 0 && density >= T.densityMin && (insets[0] + insets[1] >= T.insetMin || insets[2] + insets[3] >= T.insetMin);
  if (isolated) reasons.push('isolated object on a plain background');

  // 3. a sharp full-height vertical edge in the outer third (front meeting spine), either side
  const L = (x: number, y: number) => lum(px(data, w, x, y));
  let spineEdge = 0;
  const sides: Array<[number, number]> = [[Math.round(w * 0.74), Math.round(w * 0.94)], [Math.round(w * 0.06), Math.round(w * 0.26)]]; // a spine is a narrow strip (6-26% of the width) at one side
  for (const [from, to] of sides) {
    for (let x = from; x <= to; x++) {
      let rows = 0;
      for (let y = 0; y < h; y++) if (Math.abs(L(x + 1, y) - L(x - 1, y)) >= T.edgeJump) rows++;
      const share = rows / h;
      if (share <= spineEdge) continue;
      const left = mean(Array.from({ length: h }, (_, y) => px(data, w, Math.max(0, x - 4), y)));
      const right = mean(Array.from({ length: h }, (_, y) => px(data, w, Math.min(w - 1, x + 4), y)));
      if (dist(left, right) >= T.sideColourGap) spineEdge = share;
    }
  }
  if (spineEdge >= T.edgeRowsMin) reasons.push('spine edge');

  // 4. an (almost) all-black picture: a "cover to be revealed" teaser, not a jacket. Treated like a render so a real cover replaces it whenever one exists
  if (bgSame >= T.bgSameMin && lum(bg) <= T.blankLum && ink / (w * h) <= T.blankInk) reasons.push('blank black reveal');

  return { verdict: reasons.length ? 'render' : 'flat', reasons, bgSame, density, spineEdge, insets };
}

/* ---------------- reading a real picture ---------------- */

/** One key per picture whatever its size (Apple 200x300 / 600x900, Open Library S / M / L). */
export function flatKey(url: string): string {
  try {
    const u = new URL(url);
    if (/(^|\.)(openlibrary\.org|archive\.org)$/.test(u.hostname)) return `${u.hostname}${u.pathname.replace(/-[SML]\.jpg$/, '')}`;
    if (/(^|\.)mzstatic\.com$/.test(u.hostname)) return `${u.hostname}${u.pathname.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/art')}`;
    return `${u.hostname}${u.pathname}${u.search.replace(/[?&](r|zoom|edge|imgtk)=[^&]*/g, '')}`;
  } catch {
    return url;
  }
}

/** A small copy is enough to measure, and is far cheaper than the full picture. */
export function analysisUrl(url: string): string {
  return url
    .replace(/(\/)\d+x\d+bb\.(jpg|png)$/, '$1200x300bb.$2') // Apple: any size from the same path
    .replace(/(covers\.openlibrary\.org\/b\/(?:id|isbn)\/[^/?]+)-[SL]\.jpg/, '$1-M.jpg'); // Open Library: the medium file
}

const flatSaved = persistentCache<CoverReading>('readlife.coverFlat1', { ttl: 90 * 24 * 60 * 60 * 1000, max: 1500, validate: v => !!v && ['flat', 'render', 'unknown'].includes(v.verdict) && Array.isArray(v.reasons) });
const mem = new Map<string, Promise<CoverReading>>();
let overrideInspector: ((url: string) => Promise<CoverReading | CoverVerdict>) | undefined;
/** Tests only. */
export const setCoverInspectorForTests = (fn?: (url: string) => Promise<CoverReading | CoverVerdict>) => { overrideInspector = fn; mem.clear(); };

function readPixels(url: string, ms = 7000): Promise<{ data: Uint8ClampedArray; w: number; h: number } | null> {
  return new Promise(resolve => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') return resolve(null);
    const img = new Image();
    let done = false;
    const finish = (v: { data: Uint8ClampedArray; w: number; h: number } | null) => { if (done) return; done = true; clearTimeout(timer); img.onload = img.onerror = null; resolve(v); };
    const timer = setTimeout(() => finish(null), ms);
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = SAMPLE_W; c.height = SAMPLE_H;
        const ctx = c.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | null;
        if (!ctx) return finish(null);
        ctx.drawImage(img, 0, 0, SAMPLE_W, SAMPLE_H);
        finish({ data: ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data, w: SAMPLE_W, h: SAMPLE_H });
      } catch { finish(null); } // a picture the page may not read (no CORS headers)
    };
    img.onerror = () => finish(null);
    img.src = url;
  });
}

let active = 0;
const waiting: Array<() => void> = [];
async function slot<T>(job: () => Promise<T>): Promise<T> { // three at a time, so a shelf of covers never floods the connection
  if (active >= 3) await new Promise<void>(r => waiting.push(r));
  active++;
  try { return await job(); } finally { active--; waiting.shift()?.(); }
}

async function inspectNow(url: string): Promise<CoverReading> {
  const small = analysisUrl(url);
  // the host's own CORS headers first; a host without them is read through this site's own image function (functions/api/cover-img.js)
  let px = await readPixels(small);
  if (!px && /^https:\/\//.test(small) && typeof location !== 'undefined') px = await readPixels(`/api/cover-img?u=${encodeURIComponent(small)}`);
  return px ? analyzePixels(px.data, px.w, px.h) : { verdict: 'unknown', reasons: [], bgSame: 0, density: 0, spineEdge: 0, insets: [0, 0, 0, 0] };
}

/** The verdict for a picture: remembered on this device (an unreadable one is asked again later, not remembered). Never throws. */
export function inspectCover(url: string): Promise<CoverVerdict> {
  return readCover(url).then(r => r.verdict);
}

export function readCover(url: string): Promise<CoverReading> {
  const key = flatKey(url);
  const hit = flatSaved.get(key);
  if (hit) return Promise.resolve(hit);
  const running = mem.get(key);
  if (running) return running;
  const p = (async () => {
    try {
      const r = overrideInspector ? await overrideInspector(url) : await slot(() => inspectNow(url));
      const reading: CoverReading = typeof r === 'string' ? { verdict: r, reasons: [], bgSame: 0, density: 0, spineEdge: 0, insets: [0, 0, 0, 0] } : r;
      if (reading.verdict !== 'unknown') flatSaved.set(key, reading);
      return reading;
    } catch {
      return { verdict: 'unknown', reasons: [], bgSame: 0, density: 0, spineEdge: 0, insets: [0, 0, 0, 0] } as CoverReading;
    } finally {
      mem.delete(key);
    }
  })();
  mem.set(key, p);
  return p;
}

/** For tuning on a real device: in the browser console, `await __rlCover("https://...jpg")` shows what was measured and why. */
try { (globalThis as any).__rlCover = readCover; } catch {}


/* ======================================================================================================
 * does an image load, and what is a book's cover key
 * ====================================================================================================== */

export const coverKey = (b: { title?: string; author?: string }) => `${(b.title || '').trim()}|${(b.author || '').trim()}`.toLowerCase();

/**
 * Does this image actually load (and isn't a 1×1 placeholder)? With `front`, it must also be shaped like a FRONT cover: a wide picture
 * (spine + back, a box set, a photographed book) is refused so the next source is tried.
 */
export function probeImage(url: string, ms = 5000, front = false): Promise<boolean> {
  return new Promise(resolve => {
    if (typeof Image === 'undefined') return resolve(true);
    const img = new Image();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      img.onload = img.onerror = null;
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), ms);
    img.referrerPolicy = 'no-referrer';
    img.onload = () => finish(img.naturalWidth > 8 && img.naturalHeight > 8 && (!front || isFrontCoverShape(img.naturalWidth, img.naturalHeight)));
    img.onerror = () => finish(false);
    img.src = url;
  });
}
