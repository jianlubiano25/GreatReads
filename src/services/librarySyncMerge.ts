/**
 * Field-level merge for a record this device has never synced before (no baseline revision).
 *
 * Rule: fill gaps from both sides, take the larger of monotonic values, union collections, and treat a field as a TRUE
 * conflict only when both sides hold different non-empty values (there are no timestamps to say which is newer, so
 * nothing is guessed and nothing is overwritten). A merge function returns null for a true conflict, and the caller
 * then pauses just that record. Pure functions: no storage, no network.
 */
import type { ReadingState } from '../types';
import { dailyPagesSyncEnabled } from './dailyPagesSync';
import { settingsRecordsSyncEnabled } from './settingsRecordsFlag';
import { maxTimes, mergeHiddenByTime, mergeWordsByTime, newer } from './editTimes';
import { mergeDeviceSettings, type DeviceSettings } from './deviceSettings';
import type { AnnotationRow, LibraryBookRow, LibrarySyncSnapshot, ShelfBookRow, ShelfRow } from './librarySync';

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** Where each plant stands: the later move wins per plant (a plant with no move time keeps this device's spot, as before); a plant only one side has is kept. */
export function mergePlacements(local: ReadingState['garden'], remote: ReadingState['garden']): Pick<ReadingState['garden'], 'placements'> & { placementTimes?: Record<string, number> } {
  const lp = local.placements || {}, rp = remote.placements || {}, lt = local.placementTimes || {}, rt = remote.placementTimes || {};
  const placements: ReadingState['garden']['placements'] = {}, times: Record<string, number> = {};
  for (const id of new Set([...Object.keys(lp), ...Object.keys(rp)])) {
    const l = lp[id], r = rp[id], takeRemote = !!r && (!l || (rt[id] ?? 0) > (lt[id] ?? 0));
    const chosen = takeRemote ? r : l;
    if (chosen) placements[id] = chosen;
    const at = Math.max(lt[id] ?? 0, rt[id] ?? 0); if (at > 0) times[id] = at;
  }
  return { placements, ...(Object.keys(times).length ? { placementTimes: times } : {}) };
}

export function mergeGarden(local: ReadingState['garden'], remote: ReadingState['garden']): ReadingState['garden'] {
  const peaks = { ...local.peaks };
  for (const key of Object.keys(peaks) as (keyof typeof peaks)[]) peaks[key] = Math.max(peaks[key], remote.peaks?.[key] || 0);
  const plants = { ...remote.plants, ...local.plants };
  for (const [id, cloud] of Object.entries(remote.plants || {})) {
    const mine = local.plants[id];
    if (mine) plants[id] = { ...cloud, ...mine, earnedAt: Math.min(cloud.earnedAt, mine.earnedAt), growth: Math.max(cloud.growth, mine.growth), completedAt: mine.completedAt || cloud.completedAt };
  }
  return {
    ...remote, ...local, v: 1, peaks, plants,
    achievements: { ...remote.achievements, ...local.achievements },
    ...mergePlacements(local, remote),
    celebrated: { ...remote.celebrated, ...local.celebrated },
    vine: Math.max(local.vine || 0, remote.vine || 0),
  };
}

class FieldConflict extends Error {}
const isSet = (value: unknown): boolean => value !== null && value !== undefined && value !== '' && !(typeof value === 'object' && Object.keys(value as object).length === 0);
/** One of two values: the set one, or the shared one. Two different set values are a true conflict. */
function pick<T>(remote: T, local: T): T {
  if (!isSet(local)) return remote;
  if (!isSet(remote)) return local;
  if (stableJson(remote) === stableJson(local)) return remote;
  throw new FieldConflict();
}
const guard = <T>(build: () => T): T | null => { try { return build(); } catch (error) { if (error instanceof FieldConflict) return null; throw error; } };
/** Like pick(), but a later real edit settles it (even a clear): only two values with no time difference are a true conflict. */
function pickTimed<T>(remote: T, local: T, remoteAt: number, localAt: number): T {
  const side = newer(localAt, remoteAt);
  return side === 'remote' ? remote : side === 'local' ? local : pick(remote, local);
}
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});

/** True when every listed field matches (null and undefined count as equal). */
export const sameFields = (a: object, b: object, fields: string[]): boolean =>
  fields.every(field => stableJson((a as Record<string, unknown>)[field] ?? null) === stableJson((b as Record<string, unknown>)[field] ?? null));

/** A cloud tombstone against live local data is never resolved by guessing: null means the user must choose. */
export function mergeBookFirstSync(old: LibraryBookRow, item: LibrarySyncSnapshot['books'][number]): Record<string, unknown> | null {
  if (old.deleted_at) return null;
  return guard(() => {
    const cloudProgress = obj(old.reading_progress), localProgress = obj(item.reading_progress);
    const cloudData = obj(old.personal_data), localData = obj(item.personal_data);
    const isCustom = !!cloudData.isCustomBook || !!localData.isCustomBook;
    const cloudTimes = obj(cloudData.times), localTimes = obj(localData.times);
    const mergedTimes = maxTimes(cloudTimes as Record<string, number>, localTimes as Record<string, number>, ['status', 'rating', 'progress']);
    const progressAtCloud = Number(cloudTimes.progress) || 0;
    const progressAtLocal = Number(localTimes.progress) || 0;
    const progressSide = newer(progressAtLocal, progressAtCloud);
    // Later stamped progress wins; with no stamps, keep the higher page so unstamped devices still converge.
    const currentPage = progressSide === 'remote' ? (Number(cloudProgress.currentPage) || 0)
      : progressSide === 'local' ? (Number(localProgress.currentPage) || 0)
      : Math.max(Number(cloudProgress.currentPage) || 0, Number(localProgress.currentPage) || 0);
    const totalPages = progressSide === 'remote' && Number(cloudProgress.totalPages) > 0 ? Number(cloudProgress.totalPages)
      : progressSide === 'local' && Number(localProgress.totalPages) > 0 ? Number(localProgress.totalPages)
      : (Number(cloudProgress.totalPages) > 0 ? Number(cloudProgress.totalPages) : Number(localProgress.totalPages) || 0);
    const history = progressSide === 'remote' ? (cloudProgress.history ?? localProgress.history ?? null)
      : progressSide === 'local' ? (localProgress.history ?? cloudProgress.history ?? null)
      : pick(cloudProgress.history ?? null, localProgress.history ?? null);
    return {
      status: pickTimed(old.status, item.status, Number(cloudTimes.status) || 0, Number(localTimes.status) || 0),
      reading_progress: { currentPage, totalPages, history },
      personal_cover: pick(old.personal_cover, item.personal_cover),
      // A catalogue snapshot is not a user edit, so the cloud copy stands. A custom book's snapshot IS the user's own data.
      book_snapshot: isCustom ? pick(old.book_snapshot, item.book_snapshot) : (old.book_snapshot ?? item.book_snapshot),
      personal_data: { rating: pickTimed(cloudData.rating ?? null, localData.rating ?? null, Number(cloudTimes.rating) || 0, Number(localTimes.rating) || 0), onDevice: cloudData.onDevice ?? null, isCustomBook: isCustom, ...(Object.keys(mergedTimes).length ? { times: mergedTimes } : {}) },
      deleted_at: null,
    };
  });
}

export function mergeAnnotationFirstSync(old: AnnotationRow, row: LibrarySyncSnapshot['annotations'][number]): Record<string, unknown> | null {
  const oldAt = Number(obj(old.extra_data).edited_at) || 0, rowAt = Number(obj(row.extra_data).edited_at) || 0;
  if (old.deleted_at) {
    if (rowAt > oldAt) return { ...row, deleted_at: null }; // an edit made after the delete brings the note/highlight back
    if (oldAt > rowAt) return { content: old.content, quote_text: old.quote_text, page_reference: old.page_reference, location_data: old.location_data, extra_data: old.extra_data, deleted_at: old.deleted_at }; // the delete is newer: nothing to write
    return null; // a tie or two legacy values: still a real conflict, kept paused
  }
  const rowWins = rowAt > oldAt;
  return guard(() => ({
    ...row,
    content: pickTimed(old.content, row.content, oldAt, rowAt),
    quote_text: rowWins ? row.quote_text : old.quote_text ?? row.quote_text,
    page_reference: rowWins ? row.page_reference : old.page_reference ?? row.page_reference,
    location_data: rowWins ? { ...old.location_data, ...row.location_data } : { ...row.location_data, ...old.location_data },
    extra_data: { ...row.extra_data, ...old.extra_data, ...(Math.max(oldAt, rowAt) > 0 ? { edited_at: Math.max(oldAt, rowAt) } : {}) },
    deleted_at: null,
  }));
}

export function mergeShelfFirstSync(old: ShelfRow, item: LibrarySyncSnapshot['shelves'][number]): Record<string, unknown> | null {
  if (old.deleted_at) return null;
  // Shelf order is not applied on read yet (Phase 5), so the cloud order is kept rather than guessed.
  return guard(() => ({ name: pick(old.name, item.name), description: old.description ?? item.description, sort_order: old.sort_order, shelf_data: { ...item.shelf_data, ...old.shelf_data }, deleted_at: null }));
}

export function mergeMembershipFirstSync(old: ShelfBookRow, row: LibrarySyncSnapshot['memberships'][number]): Record<string, unknown> | null {
  if (old.deleted_at) return null;
  return { ...row, sort_order: old.sort_order, membership_data: { ...row.membership_data, ...old.membership_data }, deleted_at: null };
}

const DEFAULT_GOAL = 10;
/** The single preferences JSON. Until it is split (Phase 4) one true conflict in any field pauses the whole record. */
export function mergePreferencesFirstSync(remote: Record<string, unknown>, local: Record<string, unknown>): Record<string, unknown> | null {
  return guard(() => {
    const out: Record<string, unknown> = { ...local, ...remote };
    const owned = settingsRecordsSyncEnabled(); // Phase 4 on: goal, intention, profile name/theme and nook look are their own records, so a difference here is not a conflict
    const cloudGoal = Number(remote.goal) || 0, localGoal = Number(local.goal) || 0;
    if (owned) out.goal = cloudGoal || localGoal || undefined;
    else if (!cloudGoal) out.goal = localGoal || undefined;
    else if (!localGoal || cloudGoal === localGoal || localGoal === DEFAULT_GOAL) out.goal = cloudGoal;
    else if (cloudGoal === DEFAULT_GOAL) out.goal = localGoal;
    else throw new FieldConflict();
    if (out.goal === undefined) delete out.goal;
    out.readingIntention = owned ? (remote.readingIntention || local.readingIntention || '') : pick(remote.readingIntention ?? '', local.readingIntention ?? '');
    const cloudProfile = obj(remote.profile), localProfile = obj(local.profile);
    if (isSet(remote.profile) || isSet(local.profile)) {
      const theme = (value: unknown) => (value === 'auto' ? '' : value);
      out.profile = { name: owned ? (cloudProfile.name || localProfile.name || '') : pick(cloudProfile.name ?? '', localProfile.name ?? ''), photo: pick(cloudProfile.photo ?? '', localProfile.photo ?? ''), theme: (owned ? (theme(cloudProfile.theme) || theme(localProfile.theme) || '') : pick(theme(cloudProfile.theme) ?? '', theme(localProfile.theme) ?? '')) || 'auto' };
    }
    const days: Record<string, number> = { ...obj(local.dailyLog) as Record<string, number> };
    for (const [day, pages] of Object.entries(obj(remote.dailyLog))) days[day] = Math.max(Number(days[day]) || 0, Number(pages) || 0);
    out.dailyLog = days;
    {
      const asTimes = (v: unknown) => obj(v) as Record<string, number>;
      const merged = mergeWordsByTime(
        { words: (Array.isArray(local.words) ? local.words : []) as never, times: asTimes(local.editTimes), deleted: asTimes(local.deletedWords) },
        { words: (Array.isArray(remote.words) ? remote.words : []) as never, times: asTimes(remote.editTimes), deleted: asTimes(remote.deletedWords) },
      );
      out.words = merged.words;
      if (Object.keys(merged.deleted).length) out.deletedWords = merged.deleted; else delete out.deletedWords;
      const hidden = mergeHiddenByTime({ hidden: obj(local.hiddenBookIds) as Record<string, boolean>, times: asTimes(local.editTimes) }, { hidden: obj(remote.hiddenBookIds) as Record<string, boolean>, times: asTimes(remote.editTimes) });
      out.hiddenBookIds = hidden.hidden;
      const times = { ...merged.times, ...hidden.times };
      if (Object.keys(times).length) out.editTimes = times; else delete out.editTimes;
    }
    if (isSet(remote.garden) && isSet(local.garden)) out.garden = mergeGarden(local.garden as ReadingState['garden'], remote.garden as ReadingState['garden']);
    out.onDeviceOverrides = obj(remote.onDeviceOverrides); // device-local: never taken from this device
    if (dailyPagesSyncEnabled()) out.dailyLog = obj(remote.dailyLog); // per-day records own the days; the old copy is left exactly as the cloud has it
    const picks: Record<string, unknown> = { ...obj(local.coverPicks) };
    for (const [key, value] of Object.entries(obj(remote.coverPicks))) picks[key] = key in picks ? pick(value, picks[key]) : value;
    out.coverPicks = picks;
    out.nookLook = owned ? (remote.nookLook ?? local.nookLook ?? null) : pick(remote.nookLook ?? null, local.nookLook ?? null);
    // Phase 5: the later change wins per group; on a tie the cloud copy stands (a first sync never overwrites the cloud with an equal-age value)
    const settings = mergeDeviceSettings(local.deviceSettings as DeviceSettings | undefined, remote.deviceSettings, true);
    out.deviceSettings = settings ?? null;
    return out;
  });
}
