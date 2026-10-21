import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePixels, SAMPLE_W, SAMPLE_H } from './coverAnalysis';

const fill = (rgb: [number, number, number], inkShare = 0) => {
  const d = new Uint8ClampedArray(SAMPLE_W * SAMPLE_H * 4);
  for (let i = 0; i < SAMPLE_W * SAMPLE_H; i++) { d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = 255; }
  // a little light ink in the middle (title text)
  const n = Math.floor(SAMPLE_W * SAMPLE_H * inkShare);
  for (let k = 0; k < n; k++) { const i = (SAMPLE_H / 2 * SAMPLE_W + 8 + k) * 4; d[i] = d[i + 1] = d[i + 2] = 255; }
  return d;
};

test('an almost all-black "cover to be revealed" picture is not a final cover', () => {
  const r = analyzePixels(fill([0, 0, 0], 0.01), SAMPLE_W, SAMPLE_H);
  assert.equal(r.verdict, 'render');
  assert.ok(r.reasons.includes('blank black reveal'));
});

test('a dark jacket with real artwork is not mistaken for a blank reveal', () => {
  const r = analyzePixels(fill([0, 0, 0], 0.3), SAMPLE_W, SAMPLE_H);
  assert.ok(!r.reasons.includes('blank black reveal'));
});
