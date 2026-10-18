// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
const t = await import('./themeColor');

test('colours are read from #rgb, rgb and #rrggbb; junk is refused', () => {
  assert.equal(t.normalizeHex('#2E5934'), '#2e5934');
  assert.equal(t.normalizeHex('2e5'), '#22ee55');
  assert.equal(t.normalizeHex('red'), null);
  assert.equal(t.normalizeHex('#12345'), null);
  assert.equal(t.normalizeHex('url(x)'), null);
  assert.equal(t.normalizeHex(5), null);
});

test('lighter is lighter, darker is darker', () => {
  assert.equal(t.lighten('#000000', 0.5), '#808080');
  assert.equal(t.darken('#ffffff', 0.5), '#808080');
  assert.equal(t.lighten('#ffffff'), '#ffffff');
});

test('a choice is saved; a bad saved value falls back to the default green', () => {
  assert.equal(t.getThemeColor(), t.DEFAULT_THEME_COLOR);
  assert.equal(t.setThemeColor('#2F6F9F'), '#2f6f9f');
  assert.equal(t.getThemeColor(), '#2f6f9f');
  store.set('readlife.themecolor1', 'javascript:alert(1)');
  assert.equal(t.getThemeColor(), t.DEFAULT_THEME_COLOR);
  t.setThemeColor('#2e5934'); // the default is stored as "nothing"
  assert.equal(store.has('readlife.themecolor1'), false);
});
