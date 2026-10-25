import test from 'node:test';
import assert from 'node:assert/strict';
import type { WordItem } from '../types';
import {
  applySettingsToState, applyWordMerge, canon, collectLocalValues, decideSetting, mergeSettings, mergeWordRows, setSettingsRecordsOverride,
  settingsRecordsSyncEnabled, stampSettings, withTimes,
  type CloudSetting, type CloudWord, type LocalSetting, type SettingKey, type SettingMeta, type SettingsMerge, type WordPush,
} from './settingsRecordsSync';

const NOW = Date.parse('2026-10-25T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const cloudSetting = (key: string, value: unknown, at: number, extra: Partial<CloudSetting> = {}): CloudSetting =>
  ({ user_id: 'u', key, value, edited_at: iso(at), device_id: 'B', edit_seq: 1, revision: 1, updated_at: iso(at), deleted_at: null, ...extra });
const word = (id: string, over: Partial<WordItem> = {}): WordItem => ({ id, word: id, definition: `def ${id}`, isLearned: false, addedAt: 1, ...over });
const cloudWord = (w: WordItem, at: number, extra: Partial<CloudWord> = {}): CloudWord =>
  ({ user_id: 'u', word_id: w.id, data: w, edited_at: iso(at), device_id: 'B', edit_seq: 0, revision: 1, updated_at: iso(at), deleted_at: null, ...extra });
const key = (id: string) => `word:${id}`;

/* ---------- the switch ---------- */

test('the switch is OFF by default, "1" turns it on, "0" always wins', () => {
  setSettingsRecordsOverride(undefined);
  assert.equal(settingsRecordsSyncEnabled(), false);
  setSettingsRecordsOverride(true); assert.equal(settingsRecordsSyncEnabled(), true);
  setSettingsRecordsOverride(false); assert.equal(settingsRecordsSyncEnabled(), false);
  setSettingsRecordsOverride(undefined);
});

test('canon ignores object key order (the database returns jsonb keys in its own order)', () => {
  assert.equal(canon({ a: 1, b: { y: 2, x: 3 } }), canon({ b: { x: 3, y: 2 }, a: 1 }));
  assert.notEqual(canon([1, 2]), canon([2, 1]));
});

/* ---------- one setting ---------- */

test('decideSetting: no baseline needed - a second device with nothing set takes the cloud value', () => {
  assert.equal(decideSetting(undefined, cloudSetting('goal', 25, 1000), NOW), 'take-cloud');
});
test('decideSetting: the later edit wins, in both directions', () => {
  assert.equal(decideSetting({ value: 30, at: 2000 }, cloudSetting('goal', 25, 1000), NOW), 'push-local');
  assert.equal(decideSetting({ value: 30, at: 500 }, cloudSetting('goal', 25, 1000), NOW), 'take-cloud');
});
test('decideSetting: equal values are never a conflict, whatever the times', () => {
  assert.equal(decideSetting({ value: 25, at: 9 }, cloudSetting('goal', 25, 1000), NOW), 'same');
});
test('decideSetting: the same edit time with different values overwrites neither side (tie)', () => {
  assert.equal(decideSetting({ value: 30, at: 1000 }, cloudSetting('goal', 25, 1000), NOW), 'tie');
});
test('decideSetting: two never-edited (legacy) different values are a tie, not an overwrite', () => {
  assert.equal(decideSetting({ value: 'Ana', at: 0 }, cloudSetting('profile_name', 'Ann', 0), NOW), 'tie');
});
test('decideSetting: any real edit beats a legacy cloud value', () => {
  assert.equal(decideSetting({ value: 'Ana', at: 5 }, cloudSetting('profile_name', 'Ann', 0), NOW), 'push-local');
});
test('decideSetting: a cloud edit time far ahead of the server clock cannot win - it becomes a tie', () => {
  const skewed = cloudSetting('goal', 25, NOW + 3_600_000, { updated_at: iso(NOW) });
  assert.equal(decideSetting({ value: 30, at: NOW - 1000 }, skewed, NOW), 'tie');
});
test('decideSetting: a local edit time far in the future cannot win - it becomes a tie', () => {
  assert.equal(decideSetting({ value: 30, at: NOW + 3_600_000 }, cloudSetting('goal', 25, NOW - 1000), NOW), 'tie');
});
test('decideSetting: a cloud delete beats an older local value, a newer local value beats the delete', () => {
  const gone = cloudSetting('goal', null, 2000, { deleted_at: iso(2000) });
  assert.equal(decideSetting({ value: 30, at: 1000 }, gone, NOW), 'take-cloud');
  assert.equal(decideSetting({ value: 30, at: 3000 }, gone, NOW), 'push-local');
  assert.equal(decideSetting(undefined, gone, NOW), 'same');
});
test('decideSetting: a key missing from the cloud is never a deletion of the local value', () => {
  assert.equal(decideSetting({ value: 30, at: 1 }, undefined, NOW), 'push-local');
  assert.equal(decideSetting(undefined, undefined, NOW), 'skip');
});

/* ---------- many settings: one cannot hold up another ---------- */

test('mergeSettings: a tie on one setting does not stop the others from syncing', () => {
  const local: Partial<Record<SettingKey, LocalSetting>> = { goal: { value: 30, at: 1000 }, reading_intention: { value: 'more', at: 9000 }, theme: { value: 'dark', at: 100 } };
  const rows = [cloudSetting('goal', 25, 1000), cloudSetting('reading_intention', 'less', 5000), cloudSetting('theme', 'light', 4000)];
  const m = mergeSettings(local, rows, NOW);
  assert.deepEqual(m.ties.map(t => t.key), ['goal']);
  assert.deepEqual(m.push.map(p => p.key), ['reading_intention']);
  assert.equal(m.take.theme?.value, 'light');
  assert.equal(m.take.goal, undefined);
});
test('mergeSettings: the garden merges as high-water marks both ways and never ties', () => {
  const g = (peak: number, plant: string) => ({ v: 1, peaks: { bestStreak: peak, tenPageDays: 0, maxPagesInDay: 0, bestWeekGoalDays: 0, booksFinished: 0, totalPages: 0, highlights: 0, wordsAdded: 0 }, plants: { [plant]: { earnedAt: 5, growth: 1 } }, achievements: {}, placements: {}, celebrated: {}, vine: 0 });
  const mine = g(5, 'rose'), theirs = g(9, 'fern');
  const m = mergeSettings({ garden: { value: mine, at: 1 } }, [cloudSetting('garden', theirs, 2)], NOW);
  assert.equal(m.ties.length, 0);
  assert.equal((m.take.garden?.value as any).peaks.bestStreak, 9);
  assert.ok((m.take.garden?.value as any).plants.rose && (m.take.garden?.value as any).plants.fern);
  assert.equal(m.push.length, 1);
  assert.equal((m.push[0].value as any).peaks.bestStreak, 9);
});
test('mergeSettings: identical values with different key order produce no upload and no change', () => {
  const m = mergeSettings({ fonts: { value: { title: 'a', text: 'b' }, at: 5 } }, [cloudSetting('fonts', { text: 'b', title: 'a' }, 5)], NOW);
  assert.deepEqual([m.push.length, m.ties.length, Object.keys(m.take).length], [0, 0, 0]);
});

/* ---------- what this device offers ---------- */

const baseState = () => ({ goal: 10, readingIntention: '', profile: { name: '', photo: '', theme: 'auto' as const }, garden: { v: 1, peaks: { bestStreak: 0, tenPageDays: 0, maxPagesInDay: 0, bestWeekGoalDays: 0, booksFinished: 0, totalPages: 0, highlights: 0, wordsAdded: 0 }, plants: {}, achievements: {}, placements: {}, celebrated: {}, vine: 0 } } as any);

test('collectLocalValues: a brand-new device offers nothing, so it never pushes defaults over the cloud', () => {
  assert.deepEqual(collectLocalValues(baseState(), {}, undefined, undefined), {});
});
test('collectLocalValues: a changed goal and a set name are offered', () => {
  const s = { ...baseState(), goal: 25, profile: { name: 'Ana', photo: 'PHOTO', theme: 'dark' } };
  const v = collectLocalValues(s, {}, undefined, undefined);
  assert.deepEqual([v.goal, v.profile_name, v.theme], [25, 'Ana', 'dark']);
  assert.equal('photo' in v, false); // the photo stays in preferences until Phase 6
});
test('stampSettings: first sighting is legacy (time 0); a later change is stamped strictly later; no change keeps the stamp', () => {
  let meta: SettingMeta = stampSettings({ goal: 25 }, {}, 1000, 'A');
  assert.equal(meta.goal.at, 0);
  meta = stampSettings({ goal: 30 }, meta, 5000, 'A');
  assert.equal(meta.goal.at, 5000);
  const again = stampSettings({ goal: 30 }, meta, 9000, 'A');
  assert.equal(again.goal.at, 5000);
  const back = stampSettings({ goal: 30 }, { goal: { seen: '30', at: 7000, deviceId: 'A', editSeq: 3 } }, 100, 'A'); // clock went backwards
  assert.equal(back.goal.at, 7000);
  const changed = stampSettings({ goal: 31 }, { goal: { seen: '30', at: 7000, deviceId: 'A', editSeq: 3 } }, 100, 'A');
  assert.equal(changed.goal.at, 7001);
});
test('a goal changed back to the default is still stamped and offered (not silently dropped)', () => {
  const meta: SettingMeta = { goal: { seen: '25', at: 0, deviceId: 'A', editSeq: 0 } };
  const values = collectLocalValues(baseState(), meta, undefined, undefined); // goal is 10 = default, but was seen as 25 before
  assert.equal(values.goal, 10);
  assert.equal(stampSettings(values, meta, 4000, 'A').goal.at, 4000);
});
test('withTimes: the four device settings carry their own group time; state settings carry the stamp', () => {
  const t = withTimes({ goal: 25, fonts: { title: 'x', text: 'y' } }, { goal: { seen: '25', at: 77, deviceId: 'A', editSeq: 2 } }, { fonts: { value: { title: 'x', text: 'y' } as never, at: 88 } });
  assert.equal(t.goal?.at, 77);
  assert.equal(t.fonts?.at, 88);
});
test('applySettingsToState: applies cloud values, and returns the very same object when nothing changes', () => {
  const s = baseState();
  const next = applySettingsToState(s, { goal: { value: 25, at: 1, deviceId: 'B', editSeq: 1 }, profile_name: { value: 'Ana', at: 1, deviceId: 'B', editSeq: 1 }, theme: { value: 'dark', at: 1, deviceId: 'B', editSeq: 1 } });
  assert.deepEqual([next.goal, next.profile.name, next.profile.theme, next.profile.photo], [25, 'Ana', 'dark', '']);
  assert.equal(applySettingsToState(next, { goal: { value: 25, at: 1, deviceId: 'B', editSeq: 1 } }), next);
  assert.equal(applySettingsToState(s, { goal: { value: 'nonsense', at: 1, deviceId: 'B', editSeq: 1 } }), s); // unusable cloud values are ignored
});

/* ---------- words ---------- */

test('words: a second device with no words takes every cloud word and uploads nothing', () => {
  const rows = [cloudWord(word('a'), 100), cloudWord(word('b'), 200)];
  const m = mergeWordRows({ words: [] }, rows);
  assert.deepEqual(m.words.map(w => w.id).sort(), ['a', 'b']);
  assert.equal(m.push.length, 0);
  assert.equal(m.changed, true);
});
test('words: a first-time device uploads its words the cloud has no row for (legacy time 0)', () => {
  const m = mergeWordRows({ words: [word('a'), word('b')] }, [cloudWord(word('a'), 100)]);
  assert.deepEqual(m.push.map(p => p.id), ['b']);
});
test('words: a delete made after the last edit beats it and uploads a tombstone; the word does not come back', () => {
  const local = { words: [] as WordItem[], editTimes: {}, deletedWords: { a: 500 } };
  const m = mergeWordRows(local, [cloudWord(word('a'), 100)]);
  assert.deepEqual(m.words, []);
  assert.deepEqual(m.push, [{ id: 'a', at: 500, deleted: true }] satisfies WordPush[]);
});
test('words: a cloud tombstone removes the word here, and an older local edit does not bring it back', () => {
  const local = { words: [word('a')], editTimes: { [key('a')]: 100 } };
  const m = mergeWordRows(local, [cloudWord(word('a'), 100, { deleted_at: iso(900), data: { id: 'a' } })]);
  assert.deepEqual(m.words, []);
  assert.equal(m.deletedWords.a, 900);
  assert.equal(m.push.length, 0);
});
test('words: a word re-added after a delete comes back on both devices (the later time wins)', () => {
  const local = { words: [word('a', { definition: 'new' })], editTimes: { [key('a')]: 2000 } };
  const m = mergeWordRows(local, [cloudWord(word('a'), 100, { deleted_at: iso(900), data: { id: 'a' } })]);
  assert.equal(m.words[0].definition, 'new');
  assert.deepEqual(m.push.map(p => [p.id, p.deleted]), [['a', false]]);
});
test('words: the learned flag set on another device arrives, and key order never looks like a change', () => {
  const learned = word('a', { isLearned: true });
  const local = { words: [word('a')], editTimes: { [key('a')]: 100 } };
  const m = mergeWordRows(local, [cloudWord(learned, 300)]);
  assert.equal(m.words[0].isLearned, true);
  assert.equal(m.push.length, 0);
  const reordered = { ...cloudWord(word('b'), 5), data: { isLearned: false, addedAt: 1, definition: 'def b', word: 'b', id: 'b' } };
  const quiet = mergeWordRows({ words: [word('b')], editTimes: { [key('b')]: 5 } }, [reordered]);
  assert.equal(quiet.push.length, 0);
  assert.equal(quiet.changed, false);
});
test('words: applyWordMerge returns the same object when nothing changes, and keeps other edit times', () => {
  const s = { words: [word('a')], editTimes: { [key('a')]: 100, 'status:1': 50 } };
  assert.equal(applyWordMerge(s, [cloudWord(word('a'), 100)]), s);
  const next = applyWordMerge(s, [cloudWord(word('a', { definition: 'x' }), 900)]);
  assert.equal(next.words[0].definition, 'x');
  assert.equal(next.editTimes?.['status:1'], 50);
  assert.equal(next.editTimes?.[key('a')], 900);
});

/* ---------- dry run: two devices, an in-memory cloud, rounds until quiet ---------- */

type Device = { name: string; goal: number; intention: string; words: WordItem[]; editTimes: Record<string, number>; deleted: Record<string, number>; meta: SettingMeta };
type Cloud = { settings: CloudSetting[]; words: CloudWord[] };
let clockNow = NOW;
function round(d: Device, cloud: Cloud, at = (clockNow += 1000)) {
  const state = { ...baseState(), goal: d.goal, readingIntention: d.intention };
  d.meta = stampSettings(collectLocalValues(state, d.meta, undefined, undefined), d.meta, at, d.name);
  const merge: SettingsMerge = mergeSettings(withTimes(collectLocalValues(state, d.meta, undefined, undefined), d.meta, undefined), cloud.settings, at);
  for (const [k, t] of Object.entries(merge.take) as [SettingKey, any][]) d.meta[k] = { seen: canon(t.value), at: t.at, deviceId: t.deviceId, editSeq: t.editSeq };
  if (merge.take.goal) d.goal = Number(merge.take.goal.value);
  if (merge.take.reading_intention) d.intention = String(merge.take.reading_intention.value);
  const w = mergeWordRows({ words: d.words, editTimes: d.editTimes, deletedWords: d.deleted }, cloud.words);
  d.words = w.words; d.editTimes = { ...w.editTimes }; d.deleted = w.deletedWords;
  for (const p of merge.push) {
    const row = cloud.settings.find(r => r.key === p.key);
    const next = cloudSetting(p.key, p.value, p.at, { device_id: p.deviceId, revision: (row?.revision ?? 0) + 1, updated_at: iso(at) });
    cloud.settings = [...cloud.settings.filter(r => r.key !== p.key), next];
  }
  for (const p of w.push) {
    const row = cloud.words.find(r => r.word_id === p.id);
    const next = p.deleted ? cloudWord(word(p.id), p.at, { deleted_at: iso(p.at), data: { id: p.id }, revision: (row?.revision ?? 0) + 1 }) : cloudWord(p.word!, p.at, { revision: (row?.revision ?? 0) + 1 });
    cloud.words = [...cloud.words.filter(r => r.word_id !== p.id), next];
  }
  return { pushed: merge.push.length + w.push.length, ties: merge.ties };
}
const settle = (a: Device, b: Device, cloud: Cloud) => { for (let i = 0; i < 6; i++) { const x = round(a, cloud), y = round(b, cloud); if (!x.pushed && !y.pushed) return i; } throw new Error('did not settle'); };
const fresh = (name: string, over: Partial<Device> = {}): Device => ({ name, goal: 10, intention: '', words: [], editTimes: {}, deleted: {}, meta: {}, ...over });

test('dry run: two devices that each already have data converge without conflict and without ping-pong', () => {
  const cloud: Cloud = { settings: [], words: [] };
  const a = fresh('A', { goal: 25, words: [word('x'), word('y')] });
  const b = fresh('B', { intention: 'read daily', words: [word('y'), word('z')] });
  settle(a, b, cloud);
  assert.deepEqual([a.goal, b.goal], [25, 25]);
  assert.deepEqual([a.intention, b.intention], ['read daily', 'read daily']);
  assert.deepEqual(a.words.map(w => w.id).sort(), ['x', 'y', 'z']);
  assert.deepEqual(b.words.map(w => w.id).sort(), ['x', 'y', 'z']);
});
test('dry run: a goal edited on A, an intention edited on B, at the same time - both arrive, nothing paused', () => {
  const cloud: Cloud = { settings: [], words: [] };
  const a = fresh('A', { goal: 20 }), b = fresh('B', { intention: 'x' });
  settle(a, b, cloud);
  a.goal = 40; b.intention = 'y';
  settle(a, b, cloud);
  assert.deepEqual([a.goal, b.goal, a.intention, b.intention], [40, 40, 'y', 'y']);
});
test('dry run: a word deleted on A while B is offline stays deleted when B reconnects, and B\'s other edits survive', () => {
  const cloud: Cloud = { settings: [], words: [] };
  const a = fresh('A', { words: [word('x'), word('y')] }), b = fresh('B');
  settle(a, b, cloud);
  a.words = a.words.filter(w => w.id !== 'x'); a.deleted = { ...a.deleted, x: (clockNow += 1000) };
  round(a, cloud);
  b.words = [...b.words, word('n')]; b.editTimes = { ...b.editTimes, [key('n')]: (clockNow += 1000) }; // offline edit on B
  settle(a, b, cloud);
  assert.deepEqual(a.words.map(w => w.id).sort(), ['n', 'y']);
  assert.deepEqual(b.words.map(w => w.id).sort(), ['n', 'y']);
});
test('dry run: the same goal edited at the same instant to different values pauses only that setting and loses nothing', () => {
  const cloud: Cloud = { settings: [], words: [] };
  const a = fresh('A', { goal: 20 }), b = fresh('B', { goal: 20 });
  settle(a, b, cloud);
  const at = clockNow + 5000;
  a.goal = 30; a.meta = stampSettings({ goal: 30 }, a.meta, at, 'A');
  b.goal = 40; b.meta = stampSettings({ goal: 40 }, b.meta, at, 'B');
  b.intention = 'still syncs';
  const ra = round(a, cloud, at), rb = round(b, cloud, at);
  assert.equal(ra.ties.length + rb.ties.length >= 1, true);
  assert.equal(a.goal, 30); // A pushed first; B's value stays on B, untouched, with the tie recorded
  assert.equal(b.goal, 40);
  assert.equal(cloud.settings.find(r => r.key === 'reading_intention')?.value, 'still syncs');
});

/* ---------- the old shared preferences record no longer pauses on fields the new records own ---------- */
import { mergePreferencesFirstSync } from './librarySyncMerge';

test('switch OFF (today): two different goals still pause the shared preferences record, exactly as before', () => {
  setSettingsRecordsOverride(false);
  assert.equal(mergePreferencesFirstSync({ goal: 25 }, { goal: 30 }), null);
  assert.equal(mergePreferencesFirstSync({ readingIntention: 'a' }, { readingIntention: 'b' }), null);
  setSettingsRecordsOverride(undefined);
});
test('switch ON: different goal, intention, name, theme and nook look are not a conflict there (their own records decide); a different photo still is', () => {
  setSettingsRecordsOverride(true);
  try {
    const remote = { goal: 25, readingIntention: 'a', nookLook: { vine: 'x' }, profile: { name: 'Ann', photo: '', theme: 'dark' } };
    const local = { goal: 30, readingIntention: 'b', nookLook: { vine: 'y' }, profile: { name: 'Ana', photo: '', theme: 'light' } };
    const merged = mergePreferencesFirstSync(remote, local) as any;
    assert.ok(merged, 'must not pause');
    assert.deepEqual([merged.goal, merged.readingIntention, merged.profile.name, merged.profile.theme], [25, 'a', 'Ann', 'dark']);
    assert.equal(mergePreferencesFirstSync({ profile: { name: '', photo: 'P1', theme: 'auto' } }, { profile: { name: '', photo: 'P2', theme: 'auto' } }), null);
  } finally { setSettingsRecordsOverride(undefined); }
});
