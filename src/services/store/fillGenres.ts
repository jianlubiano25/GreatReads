import { useSyncExternalStore } from 'react';
import { SEARCH_GENRES, type SearchGenre } from '../../data/searchGenres';
import { fillSharedGenre, type FillResult } from './genreRows';
import { fillSharedSearch } from './fillSearches';

/** "Fill shared genre lists" (admin): runs in the background like "Refresh all shelves", so closing Profile does not stop it. Its progress is shown on Discover. */
export interface FillState { running: boolean; done: number; total: number; current: string; note: string; noteFresh: boolean }
const IDLE: FillState = { running: false, done: 0, total: 0, current: '', note: '', noteFresh: false };
let state: FillState = IDLE;
const listeners = new Set<() => void>();
const set = (p: Partial<FillState>) => { state = { ...state, ...p }; listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const getFillState = (): FillState => state;
export const useFillState = (): FillState => useSyncExternalStore(subscribe, getFillState, getFillState);
export const resetFillForTests = () => { state = IDLE; };

export async function startFillGenres(
  genres: readonly SearchGenre[] = SEARCH_GENRES,
  fill: (g: SearchGenre) => Promise<FillResult> = fillSharedGenre,
  gapMs = 3000,
  searches: readonly string[] = [],
  fillSearch: (text: string) => Promise<FillResult> = fillSharedSearch,
): Promise<void> {
  if (state.running) return;
  const counts: Record<FillResult, number> = { already: 0, filled: 0, failed: 0, 'not-admin': 0 };
  const failed: string[] = [];
  const sc: Record<FillResult, number> = { already: 0, filled: 0, failed: 0, 'not-admin': 0 };
  let stopped = false;
  set({ running: true, done: 0, total: genres.length + searches.length, current: '', note: '', noteFresh: false });
  for (let i = 0; i < genres.length; i++) {
    set({ done: i, current: genres[i].label });
    const r = await fill(genres[i]).catch(() => 'failed' as FillResult);
    counts[r]++;
    if (r === 'failed') failed.push(genres[i].label);
    if (r === 'not-admin') { stopped = true; break; }
    if (gapMs && r !== 'already') await new Promise(res => setTimeout(res, gapMs));
  }
  for (let i = 0; i < searches.length && !stopped; i++) {
    set({ done: genres.length + i, current: `search: ${searches[i]}` });
    const r = await fillSearch(searches[i]).catch(() => 'failed' as FillResult);
    sc[r]++;
    if (r === 'not-admin') break;
    if (gapMs && r !== 'already') await new Promise(res => setTimeout(res, gapMs));
  }
  const searchNote = searches.length ? ` Searches: ${sc.filled} added, ${sc.already} already there, ${sc.failed} failed.` : '';
  const note = `Shared lists: ${counts.filled} added, ${counts.already} already there, ${counts.failed} failed${failed.length ? ` (${failed.join(', ')})` : ''}${counts['not-admin'] ? '. Not an admin: nothing written' : ''}.${searchNote}`;
  set({ running: false, done: genres.length + searches.length, current: '', note, noteFresh: true });
  setTimeout(() => set({ noteFresh: false }), 60000);
}
