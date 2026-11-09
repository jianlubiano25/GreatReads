import test from 'node:test';
import assert from 'node:assert/strict';
import { ago, getSyncStatus, reportLive, reportSync, resetSyncStatus, verdict } from './syncStatus';
import { probeFingerprint, type ProbeRest } from './changeProbe';

test('status: a part shows working, then a problem with its reason and when it last worked', () => {
  resetSyncStatus();
  assert.equal(verdict(getSyncStatus().parts['daily-pages']).ok, null);
  reportSync('daily-pages', true, undefined, 1000);
  assert.equal(verdict(getSyncStatus().parts['daily-pages'], 11_000).text, 'working, last 10 s ago');
  reportSync('daily-pages', false, 'daily pages round failed', 5000);
  const v = verdict(getSyncStatus().parts['daily-pages'], 6000);
  assert.equal(v.ok, false);
  assert.ok(v.text.includes('daily pages round failed') && v.text.includes('last worked'));
  reportSync('daily-pages', true, undefined, 7000);
  assert.equal(verdict(getSyncStatus().parts['daily-pages'], 7000).ok, true);
});

test('status: the library alias counts as the upload, and the live connection reports connected or refused', () => {
  resetSyncStatus();
  reportSync('library', false, 'upload failed, will retry', 100);
  assert.equal(getSyncStatus().parts['library-push'].failCount, 1);
  reportLive('connected');
  assert.equal(getSyncStatus().live, 'connected');
  assert.equal(verdict(getSyncStatus().parts['live-connection']).ok, true);
  reportLive('refused');
  assert.equal(getSyncStatus().live, 'refused');
  assert.equal(verdict(getSyncStatus().parts['live-connection']).ok, false);
});

test('status: snapshots are stable until something changes (safe for the screen)', () => {
  resetSyncStatus();
  const a = getSyncStatus(); assert.equal(getSyncStatus(), a);
  reportSync('settings', true); assert.notEqual(getSyncStatus(), a);
});

test('ago wording', () => {
  assert.equal(ago(undefined), 'not yet');
  assert.equal(ago(1000, 2000), 'just now');
  assert.equal(ago(0 + 1, 30_001), '30 s ago');
  assert.equal(ago(1, 180_001), '3 min ago');
});

test('probe: when nothing at all can be read (offline) there is no fingerprint, so it is never mistaken for a change', async () => {
  const dead: ProbeRest = async () => ({ ok: false });
  assert.equal(await probeFingerprint('u', dead), null);
});
