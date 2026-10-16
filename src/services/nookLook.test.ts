// Run with: npm test
// The nook's saved look: decorations (order, visibility, choices), and that it travels with a backup.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
const prefs = await import('./nookPrefs');
const { DEFAULT_DECOR, sanitizeDecor, moveDecor, toggleDecor, visibleDecor, setNookDecor, getNookDecor, setVineStyle, exportNookLook, restoreNookLook } = prefs;

test('decorations default to the thank-you frame, clock and art on the wall and the mug on the shelf', () => {
  assert.deepEqual(visibleDecor(DEFAULT_DECOR, 'wall'), ['frame-thanks', 'clock', 'frame-art']);
  assert.deepEqual(visibleDecor(DEFAULT_DECOR, 'shelf'), ['mug']);
  assert.equal(exportNookLook(), undefined, 'a default look adds nothing to a backup');
});

test('bad saved data is repaired: unknown ids dropped, missing ones put back, text trimmed', () => {
  const d = sanitizeDecor({ order: { wall: ['clock', 'nope', 'clock'], shelf: [] }, hidden: ['mug', 'x'], mug: 'soup', clock: 'analog', art: 7, artText: '  hi   there ' + 'x'.repeat(60) });
  assert.deepEqual(d.order, { wall: ['clock', 'frame-thanks', 'frame-art'], shelf: ['mug'] }, 'missing ones go back to their usual place');
  assert.equal(new Set([...d.order.wall, ...d.order.shelf]).size, 4, 'every decoration is in exactly one area');
  assert.deepEqual(d.hidden, ['mug']);
  assert.equal(d.mug, 'coffee'); assert.equal(d.clock, 'analog'); assert.equal(d.art, 'books');
  assert.ok(d.artText.startsWith('hi there') && d.artText.length <= 28);
  assert.deepEqual(sanitizeDecor(null), DEFAULT_DECOR);
});

test('moving, taking down and putting back keep every decoration once, and the order of the rest', () => {
  const moved = moveDecor(DEFAULT_DECOR, 'clock', 'shelf', 0);
  assert.deepEqual(moved.order, { wall: ['frame-thanks', 'frame-art'], shelf: ['clock', 'mug'] });
  const left = moveDecor(DEFAULT_DECOR, 'frame-art', 'wall', 0);
  assert.deepEqual(left.order.wall, ['frame-art', 'frame-thanks', 'clock']);
  const down = toggleDecor(DEFAULT_DECOR, 'mug');
  assert.deepEqual(visibleDecor(down, 'shelf'), []);
  assert.deepEqual(down.order.shelf, ['mug'], 'it keeps its place while down');
  assert.deepEqual(toggleDecor(down, 'mug').hidden, []);
});

test('the look is saved, travels in a backup, restores, and an old backup leaves the current look alone', () => {
  const custom = { ...moveDecor(toggleDecor(DEFAULT_DECOR, 'clock'), 'mug', 'wall', 1), mug: 'tea' as const, art: 'words' as const, artText: 'Be kind' };
  setNookDecor(custom); setVineStyle('christmas');
  const look = exportNookLook()!;
  assert.equal(look.vine, 'christmas');
  assert.deepEqual(look.decor, getNookDecor());
  const backup = JSON.stringify({ status: {}, nookLook: look });
  setNookDecor(DEFAULT_DECOR); setVineStyle('nook');
  assert.equal(store.size, 0, 'defaults store nothing');
  restoreNookLook(backup);
  assert.deepEqual(getNookDecor(), sanitizeDecor(custom));
  assert.equal(prefs.getVineStyle(), 'christmas');
  restoreNookLook(JSON.stringify({ status: {} })); // made before the look was saved
  assert.equal(prefs.getVineStyle(), 'christmas');
  assert.deepEqual(getNookDecor(), sanitizeDecor(custom));
  restoreNookLook('not json');
  assert.equal(prefs.getVineStyle(), 'christmas');
});
