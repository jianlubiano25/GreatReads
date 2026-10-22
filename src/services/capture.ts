/**
 * Owner-only auto-capture: whatever this app fetches for a book (covers, description, author bio, year / pages / genre, each site's rating) is
 * quietly kept in the catalog as a HIDDEN candidate, so it can be browsed in the review screen and published or rejected there.
 *
 *  - Only runs when you are signed in AND the database says you are the owner. Readers never write anything.
 *  - Insert only: a stored row is never changed, a published row is never touched, a rejected row is never revived (the database refuses the same cover / text again).
 *  - A new book is created as a hidden draft: nothing is shown to readers until you publish something.
 *  - Slow and quiet on purpose (one request at a time, a small pause between them); a failure just stops it and it picks up again later.
 */
import { coverKey } from './books/coverAnalysis';
import { coverSourceOf } from './books/coverPicks';
import { currentUser, isAdminKnown, rest } from './supabase';

export type CaptureRating = { source: string; average: number; count?: number };
export type CaptureItem = {
  title: string;
  author?: string;
  covers?: string[];
  summary?: string;
  authorBio?: string;
  year?: string;
  pageCount?: number;
  genre?: string;
  ratings?: CaptureRating[];
};
export type CaptureStatus = { on: boolean; running: boolean; queued: number; sent: number; total: number; error?: string };

const DONE_KEY = 'readlife.captured1';
const OFF_KEY = 'readlife.captureOff1';
const BACKFILL_KEY = 'readlife.captureBackfill1';
const MAX_QUEUE = 3000;
const MAX_DONE = 60000;
const GAP_MS = 80;
const RATING_SRC: Record<string, string> = { apple: 'apple_books', google: 'google_books', openlibrary: 'open_library' };

/* ---------------- what was already sent (so nothing is sent twice) ---------------- */

let done: Set<string> | undefined;
let dirty = false;
const doneSet = (): Set<string> => {
  if (!done) {
    try { const r = JSON.parse(localStorage.getItem(DONE_KEY) || '[]'); done = new Set(Array.isArray(r) ? r.filter((x: unknown) => typeof x === 'string') : []); } catch { done = new Set(); }
  }
  return done;
};
const saveDone = () => {
  if (!dirty) return;
  dirty = false;
  try {
    const s = doneSet();
    if (s.size > MAX_DONE) { const keep = [...s].slice(s.size - MAX_DONE / 2); done = new Set(keep); }
    localStorage.setItem(DONE_KEY, JSON.stringify([...doneSet()]));
  } catch {}
};
export const hashText = (text: string): string => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + text.length.toString(36);
};

/* ---------------- switch ---------------- */

export const captureWanted = (): boolean => { try { return localStorage.getItem(OFF_KEY) !== '1'; } catch { return true; } };
export function setCaptureWanted(on: boolean): void {
  try { on ? localStorage.removeItem(OFF_KEY) : localStorage.setItem(OFF_KEY, '1'); } catch {}
  if (!on) { queue.length = 0; }
  emit();
}
export const isOwnerNow = (): boolean => !!currentUser() && isAdminKnown() === true;
export const captureOn = (): boolean => isOwnerNow() && captureWanted();

/* ---------------- status ---------------- */

const listeners = new Set<() => void>();
let status: CaptureStatus = { on: false, running: false, queued: 0, sent: 0, total: 0 };
const emit = () => {
  status = { ...status, on: captureOn(), queued: queue.length };
  listeners.forEach(l => l());
};
export const subscribeCapture = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const captureStatus = (): CaptureStatus => status;

/* ---------------- cleaning what is sent ---------------- */

const isHttps = (u: unknown): u is string => typeof u === 'string' && u.length <= 1000 && /^https:\/\/[^\s]+$/i.test(u);
const goodText = (t: unknown): t is string => typeof t === 'string' && t.trim().length >= 40 && t.length <= 20000;

type Row = { table: string; id: string; body: Record<string, unknown> };

/** The rows one book would store (pure: no network). `id` is what marks it as sent. */
export function rowsFor(item: CaptureItem, workId: string): Row[] {
  const key = coverKey({ title: item.title, author: item.author });
  const rows: Row[] = [];
  for (const url of new Set((item.covers || []).filter(isHttps))) {
    rows.push({ table: 'catalog_cover_candidates', id: `c|${key}|${hashText(url)}`, body: { work_id: workId, image_url: url, source_name: coverSourceOf(url), status: 'candidate' } });
  }
  for (const [type, text] of [['book_description', item.summary], ['author_bio', item.authorBio]] as const) {
    if (goodText(text)) rows.push({ table: 'catalog_content_versions', id: `t|${key}|${type}|${hashText(text)}`, body: { work_id: workId, content_type: type, language_code: 'en', content: text, source_name: 'app', status: 'candidate' } });
  }
  const meta = (field: string, value: unknown) => rows.push({ table: 'catalog_metadata_candidates', id: `m|${key}|${field}|${hashText(String(value))}`, body: { work_id: workId, field_name: field, field_value: value, source_name: 'app', status: 'candidate' } });
  if (/^\d{3,4}$/.test(item.year || '')) meta('year', item.year);
  if (Number.isInteger(item.pageCount) && (item.pageCount as number) > 0 && (item.pageCount as number) < 20000) meta('pageCount', item.pageCount);
  if (item.genre && item.genre !== 'Book' && item.genre.length <= 80) meta('genre', item.genre);
  for (const r of item.ratings || []) {
    const src = RATING_SRC[r.source];
    if (!src || !(r.average > 0 && r.average <= 5)) continue;
    // one stored rating per site and book; once it exists it is left alone (a published one is never overwritten)
    rows.push({ table: 'catalog_rating_candidates', id: `r|${key}|${src}`, body: { work_id: workId, source_name: src, average_rating: r.average, rating_count: Number.isFinite(r.count) && (r.count as number) >= 0 ? r.count : null, rating_scale: 5, status: 'candidate' } });
  }
  return rows;
}

/* ---------------- the work (book) ids ---------------- */

const works = new Map<string, string>();
let worksLoaded = false;
class Stop extends Error {}

const stopFor = (r: { ok: false; status: number; error: string }): Stop | undefined => {
  if (r.status === 401 || r.status === 403) return new Stop('not owner');
  if (r.status === 0 || r.status === 429 || r.status >= 500) return new Stop(r.error || 'offline');
  return undefined;
};

/** Every book the catalog already has (id by key), read once in pages. */
async function loadWorks(): Promise<void> {
  if (worksLoaded) return;
  for (let from = 0; from < 50000; from += 1000) {
    const r = await rest<{ id: string; work_key: string | null }[]>(`catalog_works?select=id,work_key&order=created_at.asc&limit=1000&offset=${from}`);
    if (!r.ok) { const s = stopFor(r); if (s) throw s; return; }
    for (const w of r.data) if (w.work_key) works.set(w.work_key, w.id);
    if (r.data.length < 1000) break;
  }
  worksLoaded = true;
}

async function workIdFor(item: CaptureItem): Promise<string | undefined> {
  const key = coverKey({ title: item.title, author: item.author });
  const have = works.get(key);
  if (have) return have;
  const made = await rest<{ id: string }[]>('catalog_works', { method: 'POST', prefer: 'return=representation', body: { canonical_title: item.title.trim(), canonical_author: (item.author || '').trim() || null, work_key: key, status: 'draft' } });
  if (made.ok && made.data[0]?.id) { works.set(key, made.data[0].id); return made.data[0].id; }
  if (!made.ok && made.status === 409) { // created a moment ago by another device
    const f = await rest<{ id: string }[]>(`catalog_works?work_key=eq.${encodeURIComponent(key)}&select=id&limit=1`);
    if (f.ok && f.data[0]) { works.set(key, f.data[0].id); return f.data[0].id; }
  }
  if (!made.ok) { const s = stopFor(made); if (s) throw s; }
  return undefined;
}

/** Send rows of one table: all at once, and if something in the batch already exists (409) one by one, where "already there" counts as sent. */
async function send(table: string, rows: Row[]): Promise<Row[]> {
  if (!rows.length) return [];
  const bulk = await rest(table, { method: 'POST', body: rows.map(r => r.body) });
  if (bulk.ok) return rows;
  if (bulk.status !== 409) { const s = stopFor(bulk); if (s) throw s; if (bulk.status !== 400 && bulk.status !== 422) return []; }
  const okRows: Row[] = [];
  for (const row of rows) {
    const one = await rest(table, { method: 'POST', body: row.body });
    if (one.ok || one.status === 409) okRows.push(row);
    else { const s = stopFor(one); if (s) throw s; if (one.status === 400 || one.status === 422) okRows.push(row); /* a value the database refuses: do not ask again */ }
  }
  return okRows;
}

/* ---------------- the queue ---------------- */

const queue: CaptureItem[] = [];
let running: Promise<void> | undefined;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function processOne(item: CaptureItem): Promise<void> {
  if (!item.title?.trim()) return;
  const probe = rowsFor(item, 'x').filter(r => !doneSet().has(r.id));
  if (!probe.length) return;
  const workId = await workIdFor(item);
  if (!workId) return;
  const todo = rowsFor(item, workId).filter(r => !doneSet().has(r.id));
  const tables = [...new Set(todo.map(r => r.table))];
  for (const t of tables) {
    const sent = await send(t, todo.filter(r => r.table === t));
    for (const r of sent) { doneSet().add(r.id); dirty = true; }
    status.sent += sent.length;
  }
}

function pump(): Promise<void> {
  if (running) return running;
  running = (async () => {
    status = { ...status, running: true, error: undefined };
    emit();
    try {
      await loadWorks();
      while (queue.length && captureOn()) {
        const item = queue.shift() as CaptureItem;
        await processOne(item);
        emit();
        if (dirty && queue.length % 20 === 0) saveDone();
        await sleep(GAP_MS);
      }
    } catch (e) {
      queue.length = 0;
      status = { ...status, error: e instanceof Stop && e.message === 'not owner' ? 'Not signed in as the owner.' : 'Paused: no connection. It continues next time.' };
    } finally {
      saveDone();
      running = undefined;
      status = { ...status, running: false };
      emit();
    }
  })();
  return running;
}

/** Quietly keep what was just fetched for this book. Does nothing unless you are the signed-in owner. */
export function captureBook(item: CaptureItem): void {
  if (!captureOn()) return;
  if (queue.length >= MAX_QUEUE) return;
  if (!rowsFor(item, 'x').some(r => !doneSet().has(r.id))) return;
  queue.push(item);
  status.total++;
  emit();
  void pump();
}

/** Send everything this device already has (library, shelves, saved lookups). Runs once on its own after the first owner sign-in, and on demand. */
export function captureMany(items: CaptureItem[]): Promise<void> {
  if (!captureOn()) return Promise.resolve();
  status = { ...status, total: status.total + items.length };
  for (const it of items) if (queue.length < MAX_QUEUE && rowsFor(it, 'x').some(r => !doneSet().has(r.id))) queue.push(it);
  emit();
  return pump();
}

export const backfillDone = (): boolean => { try { return localStorage.getItem(BACKFILL_KEY) === '1'; } catch { return false; } };
export const markBackfillDone = (): void => { try { localStorage.setItem(BACKFILL_KEY, '1'); } catch {} };
export const resetBackfill = (): void => { try { localStorage.removeItem(BACKFILL_KEY); } catch {} };

/** Tests only. */
export const resetCaptureForTests = (): void => { queue.length = 0; works.clear(); worksLoaded = false; done = new Set(); dirty = false; running = undefined; status = { on: false, running: false, queued: 0, sent: 0, total: 0 }; };
