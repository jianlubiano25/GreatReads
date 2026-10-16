// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};
const f = await import('./fontPrefs');

test('defaults when nothing is saved or the saved value is not on the list', () => {
  assert.deepEqual(f.getFontPrefs(), { title: f.DEFAULT_TITLE, text: f.DEFAULT_TEXT });
  store.set('readlife.fonts1', JSON.stringify({ title: 'Evil Font; }', text: 5 }));
  assert.deepEqual(f.getFontPrefs(), { title: f.DEFAULT_TITLE, text: f.DEFAULT_TEXT });
  store.set('readlife.fonts1', 'not json');
  assert.deepEqual(f.getFontPrefs(), { title: f.DEFAULT_TITLE, text: f.DEFAULT_TEXT });
});

test('a choice is saved and read back', () => {
  f.setFontPrefs({ title: 'Playfair Display' });
  assert.equal(f.getFontPrefs().title, 'Playfair Display');
  f.setFontPrefs({ text: 'Inter' });
  assert.deepEqual(f.getFontPrefs(), { title: 'Playfair Display', text: 'Inter' });
});

test('the Google Fonts address names the families, spaces as +', () => {
  assert.equal(f.fontsUrl(['Playfair Display', 'Inter']), 'https://fonts.googleapis.com/css2?family=Playfair+Display&family=Inter&display=swap');
  assert.ok(f.fontsUrl(['Lora'], 'Lora').includes('&text=Lora'));
});
