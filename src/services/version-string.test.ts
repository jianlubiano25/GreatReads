import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { branchCode, formatVersion } from './versionString';

test('branch codes: bovci, jl2, main; anything else is shortened to its own letters', () => {
  assert.equal(branchCode('claude/best-of-vscode-catalog-ids'), 'bovci');
  assert.equal(branchCode('refs/heads/claude/best-of-vscode-catalog-ids'), 'bovci');
  assert.equal(branchCode('Jldata2'), 'jl2');
  assert.equal(branchCode('main'), 'main');
  assert.equal(branchCode('feature/Some Thing!'), 'feature-some');
  assert.equal(branchCode(''), 'nobranch');
});

test('the version reads GreatReads 0.1.<build>.<short-sha>.<branch>', () => {
  assert.equal(formatVersion({ build: 7, sha: 'A1B2C3D4E5F6', branch: 'claude/best-of-vscode-catalog-ids' }), 'GreatReads 0.1.7.a1b2c3d.bovci');
  assert.equal(formatVersion({ build: '12', sha: 'abc1234', branch: 'Jldata2' }), 'GreatReads 0.1.12.abc1234.jl2');
  assert.equal(formatVersion({ branch: 'main' }), 'GreatReads 0.1.0.nosha.main');
});

test('BUILD_NUMBER is a whole number (raised by one with every push)', () => {
  assert.match(readFileSync(new URL('../../BUILD_NUMBER', import.meta.url), 'utf8').trim(), /^\d+$/);
});
