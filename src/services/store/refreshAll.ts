/**
 * "Refresh all shelves", kept OUTSIDE any screen: the job belongs to the app, not to the Customize Shelves panel. Leaving that panel (Done) neither stops it nor loses its
 * progress; Customize Shelves and Discover both read the same state, so "Refreshing 7 of 37…" is still there when you come back.
 * One shelf at a time, each through manualRefresh (a shelf checked in the last few minutes is skipped; no source gets more than one request at a time from here).
 */
import { useSyncExternalStore } from 'react';
import { SHELF_BY_ID } from './registry';
import { manualRefresh, type ManualResult } from './refresh';

export const RESULT_MESSAGE: Record<ManualResult, string> = {
  updated: 'Updated with new books',
  unchanged: 'Checked: already up to date',
  failed: 'Could not update; your saved list is kept',
  cooldown: 'Just checked; try again in a few minutes',
  unsupported: '',
};

export interface RefreshAllState {
  running: boolean;
  done: number;
  total: number;
  /** the shelf being refreshed right now */
  currentId: string;
  /** what happened to each shelf in the last run */
  notes: Record<string, string>;
  /** the summary of the last run */
  note: string;
  /** the summary is recent (Discover shows it for a few seconds; Customize Shelves always shows it) */
  noteFresh: boolean;
}

const IDLE: RefreshAllState = { running: false, done: 0, total: 0, currentId: '', notes: {}, note: '', noteFresh: false };
let state: RefreshAllState = IDLE;
const listeners = new Set<() => void>();
const set = (patch: Partial<RefreshAllState>) => { state = { ...state, ...patch }; listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const getRefreshAllState = (): RefreshAllState => state;
export const useRefreshAll = (): RefreshAllState => useSyncExternalStore(subscribe, getRefreshAllState, getRefreshAllState);
export const resetRefreshAllForTests = (): void => { state = IDLE; };

const refreshOneShelf = async (id: string): Promise<ManualResult> => {
  const source = SHELF_BY_ID[id]?.source;
  return source ? manualRefresh(source) : 'unsupported';
};

/** Start refreshing these shelves, one at a time. Does nothing when a run is already going (its progress is shared). */
export async function startRefreshAll(ids: string[], hiddenCount = 0, refreshOne: (id: string) => Promise<ManualResult> = refreshOneShelf): Promise<void> {
  if (state.running || !ids.length) return;
  const tally = { changed: 0, current: 0, failed: 0, skipped: 0 };
  const notes: Record<string, string> = {};
  set({ running: true, done: 0, total: ids.length, currentId: ids[0], notes: {}, note: '', noteFresh: false });
  for (const [i, id] of ids.entries()) {
    set({ currentId: id });
    let r: ManualResult;
    try { r = await refreshOne(id); } catch { r = 'failed'; }
    notes[id] = RESULT_MESSAGE[r];
    if (r === 'updated') tally.changed++;
    else if (r === 'unchanged') tally.current++;
    else if (r === 'failed') tally.failed++;
    else tally.skipped++;
    set({ done: i + 1, notes: { ...notes } });
  }
  const parts = [`${tally.changed} updated`, `${tally.current} already up to date`];
  if (tally.skipped) parts.push(`${tally.skipped} checked recently`);
  if (tally.failed) parts.push(`${tally.failed} could not update (saved lists kept)`);
  set({ running: false, currentId: '', note: `${parts.join(', ')}.${hiddenCount ? ' Hidden shelves were not refreshed.' : ''}`, noteFresh: true });
  setTimeout(() => set({ noteFresh: false }), 8000);
}
