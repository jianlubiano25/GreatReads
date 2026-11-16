import test from 'node:test';
import assert from 'node:assert/strict';
import { worksSearchTerm } from './catalog';

test('worksSearchTerm: a title with a comma is searched by its longest piece, so it still matches the stored title', () => {
  assert.equal(worksSearchTerm('Set Boundaries, Find Peace'), 'Set Boundaries');
  assert.equal(worksSearchTerm('Dark Matter'), 'Dark Matter');
  assert.equal(worksSearchTerm('  Atomic   Habits '), 'Atomic Habits');
  assert.equal(worksSearchTerm('100% (new), *edition*'), 'edition');
  assert.equal(worksSearchTerm(',,'), '');
});
