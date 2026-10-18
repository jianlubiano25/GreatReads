import test from 'node:test';
import assert from 'node:assert/strict';
import { rootFromDefinition } from './dictionary';

test('a derived-form definition points at its root', () => {
  assert.equal(rootFromDefinition('queasiness', 'The state of being queasy.'), 'queasy');
  assert.equal(rootFromDefinition('queasiness', 'Being queasy'), 'queasy');
  assert.equal(rootFromDefinition('happiness', 'The quality of being happy'), 'happy');
});

test('ordinary definitions are left alone', () => {
  assert.equal(rootFromDefinition('serene', 'Calm, peaceful and untroubled.'), '');
  assert.equal(rootFromDefinition('hush', 'The state of being quiet and still, as in a library at night.'), '');
});
