import type { Book, BookHistory, BookStatus, ReadingState } from '../types';
import { dateKey, dayNumber } from './dates';

/** Is this a real calendar date written "YYYY-MM-DD"? */
export const isDateKey = (s: unknown): s is string =>
  typeof s === 'string' && Number.isFinite(dayNumber(s)) && new Date(dayNumber(s) * 86_400_000).toISOString().slice(0, 10) === s;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Repairs saved history: only real dates and time stamps survive. Never throws. */
export function sanitizeHistory(raw: unknown): Record<string, BookHistory> {
  const out: Record<string, BookHistory> = {};
  if (!isObj(raw)) return out;
  for (const id of Object.keys(raw)) {
    const r = raw[id];
    if (!isObj(r)) continue;
    const h: BookHistory = {};
    if (isDateKey(r.added)) h.added = r.added;
    if (isDateKey(r.started)) h.started = r.started;
    if (isDateKey(r.finished)) h.finished = r.finished;
    if (typeof r.lastRead === 'number' && Number.isFinite(r.lastRead) && r.lastRead > 0) h.lastRead = Math.round(r.lastRead);
    if (Object.keys(h).length) out[id] = h;
  }
  return out;
}

/** Your own star ratings move in quarter stars: 0.25, 0.5 ... 5. (Ratings saved before this are whole numbers, which fit.) */
export const RATING_STEP = 0.25;

/** The nearest quarter star from 0.25 to 5, or 0 for "no rating" (0, nothing, or a number outside the range). */
export function snapRating(n: number): number {
  const v = Math.round(Number(n) / RATING_STEP) * RATING_STEP;
  return v >= RATING_STEP && v <= 5 ? v : 0;
}

/** "4", "4.5", "4.25": a rating written the way you read it. */
export const formatRating = (n: number): string => String(Math.round(n * 100) / 100);

/** Repairs saved ratings: quarter stars from 0.25 to 5. */
export function sanitizeRatings(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(raw)) return out;
  for (const id of Object.keys(raw)) {
    const n = snapRating(Number(raw[id]));
    if (n) out[id] = n;
  }
  return out;
}

/** The book's history after its status changes (`from` is where it was, `to` where it goes). */
export function stampStatus(prev: BookHistory | undefined, from: BookStatus | undefined, to: BookStatus, today: string, now: number): BookHistory {
  const h: BookHistory = { ...prev };
  if (!h.added) h.added = today;
  if (to === 'now') {
    if (!h.started) h.started = today;
    h.lastRead = now;
  }
  if (to === 'done' && (from !== 'done' || !h.finished)) h.finished = today;
  if (from === 'done' && to !== 'done') delete h.finished; // no longer finished (reading it again)
  return h;
}

/** The book's history after you read some of it: it has started, and it is the latest one you read. */
export function stampProgress(prev: BookHistory | undefined, today: string, now: number): BookHistory {
  const h: BookHistory = { ...prev, lastRead: now };
  if (!h.added) h.added = today;
  if (!h.started) h.started = today;
  return h;
}

export type HistoryPatch = Partial<Record<'added' | 'started' | 'finished', string | null>>;

/**
 * You edit a date in Book Info. `null` clears it. Returns the same state when the edit is not allowed
 * (not a real date, in the future, or finished before started).
 * Setting "finished" finishes the book; clearing it on a finished book puts it back to reading (or your list).
 */
export function applyHistoryEdit(prev: ReadingState, id: string | number, patch: HistoryPatch, today: string = dateKey()): ReadingState {
  const key = String(id);
  const h: BookHistory = { ...prev.history[key] };
  for (const f of ['added', 'started', 'finished'] as const) {
    const v = patch[f];
    if (v === undefined) continue;
    if (v === null) delete h[f];
    else if (isDateKey(v) && v <= today) h[f] = v;
    else return prev;
  }
  if (h.started && h.finished && h.finished < h.started) return prev;
  let status = prev.status;
  if (patch.finished) {
    if (prev.status[key] !== 'done') status = { ...prev.status, [key]: 'done' };
  } else if (patch.finished === null && prev.status[key] === 'done') {
    status = { ...prev.status, [key]: h.started ? 'now' : 'list' };
    if (h.started) h.lastRead = Date.now();
  }
  return { ...prev, status, history: { ...prev.history, [key]: h } };
}

/** Your own rating of a book, in quarter stars (see snapRating); 0 takes it back. */
export function applyRating(prev: ReadingState, id: string | number, stars: number): ReadingState {
  const key = String(id);
  const n = snapRating(stars);
  if (!n) {
    if (!(key in prev.ratings)) return prev;
    const { [key]: _gone, ...rest } = prev.ratings;
    return { ...prev, ratings: rest };
  }
  return prev.ratings[key] === n ? prev : { ...prev, ratings: { ...prev.ratings, [key]: n } };
}

/** Reading now, the book you read most recently first (then the one you started most recently); the rest keep their order. */
export function readingNowOrder<T extends Pick<Book, 'id'>>(books: readonly T[], history: Record<string, BookHistory>): T[] {
  const rank = (b: T) => history[String(b.id)] ?? {};
  return books
    .map((b, i) => ({ b, i }))
    .sort((x, y) => {
      const a = rank(x.b), c = rank(y.b);
      return (c.lastRead ?? 0) - (a.lastRead ?? 0)
        || (c.started ?? '').localeCompare(a.started ?? '')
        || x.i - y.i;
    })
    .map(e => e.b);
}

/** "Oct 3, 2026" for a date key (written by hand so it never depends on locale data). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function prettyDate(key: string | undefined): string {
  if (!key || !isDateKey(key)) return '';
  return `${MONTHS[+key.slice(5, 7) - 1]} ${+key.slice(8, 10)}, ${key.slice(0, 4)}`;
}
