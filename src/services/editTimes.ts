/**
 * Phase 3: per-field edit times, so a CLEAR or a DELETE is a real edit that can win, instead of looking like "never set".
 *
 * Every user edit of a book's status or rating, a vocabulary word, or whether a book is hidden is stamped with a time.
 * A stamp is strictly later than the previous stamp of the same field (even if the clock goes backwards), so an edit made
 * after seeing a value always beats it. A field with no stamp is a legacy value (made before stamping existed): any real
 * edit beats it, and two legacy values merge the way they always did.
 *
 * Pure functions only: no storage, no network.
 */
import type { ReadingState, WordItem } from '../types';

export type EditKind = 'status' | 'rating' | 'word' | 'hidden';
export type Times = Record<string, number>;

export const timeKey = (kind: EditKind, id: string | number): string => `${kind}:${id}`;
export const timeOf = (times: Times | undefined, kind: EditKind, id: string | number): number => { const t = times?.[timeKey(kind, id)]; return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : 0; };

/** The same times with each key stamped strictly later than its previous stamp. */
export function stampTimes(prev: Times | undefined, keys: string[], now = Date.now()): Times {
  const out: Times = { ...(prev || {}) };
  for (const key of keys) out[key] = Math.max(now, (out[key] ?? 0) + 1);
  return out;
}

/** Stamp edits of one kind for several books/words. Returns the same state object when there is nothing to stamp. */
export function withEdits<T extends Pick<ReadingState, 'editTimes'>>(state: T, kind: EditKind, ids: (string | number)[], now = Date.now()): T {
  if (!ids.length) return state;
  return { ...state, editTimes: stampTimes(state.editTimes, ids.map(id => timeKey(kind, id)), now) };
}

/** A word was deleted: remember when, and drop its own edit stamp (the tombstone replaces it). */
export function withWordsDeleted<T extends Pick<ReadingState, 'editTimes' | 'deletedWords'>>(state: T, ids: string[], now = Date.now()): T {
  if (!ids.length) return state;
  const editTimes = { ...(state.editTimes || {}) };
  const deletedWords = { ...(state.deletedWords || {}) };
  for (const id of ids) {
    deletedWords[id] = Math.max(now, (deletedWords[id] ?? 0) + 1, (editTimes[timeKey('word', id)] ?? 0) + 1);
    delete editTimes[timeKey('word', id)];
  }
  return { ...state, editTimes, deletedWords };
}

/** Which side's value to use for one field: 'remote' and 'local' when one has a later real edit, 'same' when neither does. */
export const newer = (localAt: number, remoteAt: number): 'local' | 'remote' | 'same' => (remoteAt > localAt ? 'remote' : localAt > remoteAt ? 'local' : 'same');

const nums = (raw: unknown): Times => {
  const out: Times = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = Math.round(v);
  return out;
};
export const cleanTimes = nums;

/** The larger time per key, for keys starting with one of the given prefixes. */
export function maxTimes(a: Times | undefined, b: Times | undefined, prefixes: string[]): Times {
  const out: Times = {};
  for (const src of [a || {}, b || {}]) for (const [k, v] of Object.entries(src)) if (prefixes.some(p => k.startsWith(p)) && v > (out[k] ?? 0)) out[k] = v;
  return out;
}

export type WordMergeInput = { words: WordItem[]; times?: Times; deleted?: Record<string, number> };
export type WordMergeResult = { words: WordItem[]; times: Times; deleted: Record<string, number> };

/**
 * Merge vocabulary from two sides, word by word.
 * - A delete wins only over an edit that is OLDER than it (a word re-added or changed after the delete comes back).
 * - A word with no delete is never dropped. A tombstone beats a legacy (unstamped) copy.
 * - Both sides have the word: the later edit's version wins; two legacy copies keep this side's fields and "learned" if either has it.
 * - Equal times with a delete: the word is kept (never lose data on an exact tie).
 */
export function mergeWordsByTime(local: WordMergeInput, remote: WordMergeInput): WordMergeResult {
  const lt = local.times || {}, rt = remote.times || {};
  const ld = local.deleted || {}, rd = remote.deleted || {};
  const L = new Map(local.words.map(w => [w.id, w])), R = new Map(remote.words.map(w => [w.id, w]));
  const order = [...L.keys(), ...[...R.keys()].filter(id => !L.has(id))];
  const words: WordItem[] = [], times: Times = {}, deleted: Record<string, number> = {};
  const seen = new Set<string>();
  const decide = (id: string) => {
    seen.add(id);
    const lw = L.get(id), rw = R.get(id);
    const lAt = lw ? lt[timeKey('word', id)] ?? 0 : 0, rAt = rw ? rt[timeKey('word', id)] ?? 0 : 0;
    const delAt = Math.max(ld[id] ?? 0, rd[id] ?? 0);
    const liveAt = Math.max(lAt, rAt);
    if (delAt > 0 && delAt > liveAt) { deleted[id] = delAt; return; }
    let chosen: WordItem | undefined;
    if (lw && rw) {
      const which = newer(lAt, rAt);
      chosen = which === 'remote' ? rw : which === 'local' ? lw : { ...lw, isLearned: !!(lw.isLearned || rw.isLearned) };
    } else chosen = lw || rw;
    if (!chosen) return;
    words.push(chosen);
    if (liveAt > 0) times[timeKey('word', id)] = liveAt;
    if (delAt > 0) deleted[id] = delAt; // kept for exact ties and for devices that have not seen it yet
  };
  for (const id of order) decide(id);
  for (const id of [...Object.keys(ld), ...Object.keys(rd)]) if (!seen.has(id)) { const delAt = Math.max(ld[id] ?? 0, rd[id] ?? 0); if (delAt > 0) deleted[id] = delAt; }
  return { words, times, deleted };
}

/** Hidden books: the later hide/un-hide wins; two legacy values union (hidden if either side hides it), as before. */
export function mergeHiddenByTime(local: { hidden: Record<string, boolean>; times?: Times }, remote: { hidden: Record<string, boolean>; times?: Times }): { hidden: Record<string, true>; times: Times } {
  const lt = local.times || {}, rt = remote.times || {};
  const ids = new Set<string>([...Object.keys(local.hidden), ...Object.keys(remote.hidden)]);
  for (const src of [lt, rt]) for (const key of Object.keys(src)) if (key.startsWith('hidden:')) ids.add(key.slice('hidden:'.length));
  const hidden: Record<string, true> = {}, times: Times = {};
  for (const id of ids) {
    const lAt = lt[timeKey('hidden', id)] ?? 0, rAt = rt[timeKey('hidden', id)] ?? 0;
    const which = newer(lAt, rAt);
    const isHidden = which === 'remote' ? !!remote.hidden[id] : which === 'local' ? !!local.hidden[id] : !!(local.hidden[id] || remote.hidden[id]);
    if (isHidden) hidden[id] = true;
    const at = Math.max(lAt, rAt);
    if (at > 0) times[timeKey('hidden', id)] = at;
  }
  return { hidden, times };
}
