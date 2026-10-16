// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { analyzePixels, analysisUrl, flatKey, setCoverInspectorForTests, SAMPLE_W as W, SAMPLE_H as H } from './coverFlatness';
import { resolveCover, refreshBookCovers } from './covers';
import { routeFetch } from '../store/testkit';

type RGB = [number, number, number];
/** A W x H picture drawn by `paint(x, y) -> colour`. */
const draw = (paint: (x: number, y: number) => RGB) => {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = paint(x, y); const i = (y * W + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
  return d;
};
const WHITE: RGB = [250, 250, 250];

/** Art that fills the frame and varies everywhere (a photo-like jacket). */
const fullBleed = (x: number, y: number): RGB => [(40 + x * 5 + y * 2) % 256, (90 + y * 3) % 256, (160 + x * 2 + ((x * y) % 40)) % 256];
/** A white page with a few lines of black type (a minimalist jacket such as a business book). */
const typeOnWhite = (x: number, y: number): RGB => (y % 9 < 2 && x > 6 && x < 34 && y > 6 && y < 40 ? [20, 20, 20] : WHITE);
/** A solid dark book standing on a plain white background, a margin all round (the publisher's 3D shot). */
const floatingBook = (x: number, y: number): RGB => (x >= 5 && x < 31 && y >= 4 && y < 54 ? (x >= 26 ? [200, 90, 30] : fullBleed(x, y)) : WHITE);
/** A full-bleed front whose right quarter is the spine: a sharp full-height edge with different colours either side. */
const frontWithSpine = (x: number, y: number): RGB => (x >= 31 ? [20, 20, 25] : [200 - x, 200 - y, 190]);

test('a flat full-bleed jacket and a white page with type are flat', () => {
  assert.equal(analyzePixels(draw(fullBleed), W, H).verdict, 'flat');
  const r = analyzePixels(draw(typeOnWhite), W, H);
  assert.equal(r.verdict, 'flat', JSON.stringify(r));
});

test('a solid book floating on a plain background is a render', () => {
  const r = analyzePixels(draw(floatingBook), W, H);
  assert.equal(r.verdict, 'render', JSON.stringify(r));
  assert.ok(r.reasons.includes('isolated object on a plain background'));
});

test('a front with the spine showing beside it is a render', () => {
  const r = analyzePixels(draw(frontWithSpine), W, H);
  assert.equal(r.verdict, 'render', JSON.stringify(r));
  assert.ok(r.reasons.includes('spine edge'));
});

test('a picture too small or empty to measure is unknown, never a render', () => {
  assert.equal(analyzePixels(new Uint8ClampedArray(4 * 4 * 4), 4, 4).verdict, 'unknown');
  assert.equal(analyzePixels(new Uint8ClampedArray(0), 0, 0).verdict, 'unknown');
});

test('one picture, one key, whatever the size; the analysis copy is small', () => {
  assert.equal(flatKey('https://is1-ssl.mzstatic.com/image/thumb/P/x/600x900bb.jpg'), flatKey('https://is1-ssl.mzstatic.com/image/thumb/P/x/200x300bb.jpg'));
  assert.equal(flatKey('https://covers.openlibrary.org/b/id/12-L.jpg'), flatKey('https://covers.openlibrary.org/b/id/12-S.jpg'));
  assert.match(analysisUrl('https://is1-ssl.mzstatic.com/image/thumb/P/x/600x900bb.jpg'), /200x300bb\.jpg$/);
  assert.match(analysisUrl('https://covers.openlibrary.org/b/id/12-L.jpg'), /12-M\.jpg$/);
});

const APPLE = 'https://is1-ssl.mzstatic.com/image/thumb/Publication/w/600x900bb.jpg';
const OL_FLAT = 'https://covers.openlibrary.org/b/id/777-M.jpg';

test('resolveCover skips a 3D render for a flat cover from another source (The Witch: Apple is the render, Open Library is flat)', async () => {
  store.clear(); refreshBookCovers();
  setCoverInspectorForTests(async url => (url.includes('mzstatic') ? 'render' : 'flat'));
  routeFetch([
    u => (u.hostname.includes('itunes.apple.com') ? { body: { results: [{ trackId: 1, trackName: 'The Witch', artistName: 'Freida McFadden', artworkUrl100: APPLE.replace('600x900', '100x100') }] } } : undefined),
    u => (u.pathname === '/search.json' ? { body: { numFound: 1, docs: [{ key: '/works/OL5W', title: 'The Witch', author_name: ['Freida McFadden'], cover_i: 777, ratings_count: 50 }] } } : undefined),
  ]);
  const url = await resolveCover({ id: 'x1', title: 'The Witch', author: 'Freida McFadden' });
  assert.equal(url, OL_FLAT);
});

test('Apple still wins when its art is flat (Threshing Day), and a render is the last resort only for a book with no cover of its own', async () => {
  store.clear(); refreshBookCovers();
  setCoverInspectorForTests(async url => (url.includes('mzstatic') ? 'flat' : 'render'));
  routeFetch([
    u => (u.hostname.includes('itunes.apple.com') ? { body: { results: [{ trackId: 2, trackName: 'Threshing Day', artistName: 'Rebecca Yarros', artworkUrl100: APPLE.replace('600x900', '100x100') }] } } : undefined),
    u => (u.pathname === '/search.json' ? { body: { numFound: 1, docs: [{ key: '/works/OL6W', title: 'Threshing Day', author_name: ['Rebecca Yarros'], cover_i: 888 }] } } : undefined),
  ]);
  assert.match(await resolveCover({ id: 'x2', title: 'Threshing Day', author: 'Rebecca Yarros' }), /mzstatic/);

  store.clear(); refreshBookCovers();
  setCoverInspectorForTests(async () => 'render'); // every source is a render
  routeFetch([
    u => (u.hostname.includes('itunes.apple.com') ? { body: { results: [{ trackId: 3, trackName: 'Only Renders', artistName: 'Ann Author', artworkUrl100: APPLE.replace('600x900', '100x100') }] } } : undefined),
  ]);
  assert.match(await resolveCover({ id: 'x3', title: 'Only Renders', author: 'Ann Author' }), /mzstatic/); // no own cover: a render beats nothing
  store.clear(); refreshBookCovers();
  assert.equal(await resolveCover({ id: 'x4', title: 'Only Renders', author: 'Ann Author', coverUrl: 'https://own/render.jpg' }), ''); // it already has one: not swapped for another render
  setCoverInspectorForTests();
});
