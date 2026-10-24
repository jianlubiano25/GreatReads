// Test helpers only (never imported by the app): an in-memory stand-in for the six personal tables with the behaviours the sync relies on
// (eq / gte filters, order, limit, offset, unique keys, PATCH returning rows, and the database trigger that bumps revision and updated_at on every update).
import type { ReadingState, Book } from '../types';

export const USER = '5b2c0f6e-0000-4000-8000-000000000001';
export const blankState = (): ReadingState => ({
  status: {}, currentPage: {}, totalPages: {}, dailyLog: {}, notes: {}, highlights: {}, goal: 10, readingIntention: '',
  profile: { name: '', photo: '', theme: 'auto' }, customBooks: [], onDeviceOverrides: {}, hiddenBookIds: {}, words: [],
  garden: { v: 1, peaks: { bestStreak: 0, tenPageDays: 0, maxPagesInDay: 0, bestWeekGoalDays: 0, booksFinished: 0, totalPages: 0, highlights: 0, wordsAdded: 0, wordsLearned: 0 }, achievements: {}, plants: {}, placements: {}, celebrated: {}, vine: 0 }, history: {}, ratings: {},
});
export const mkBook = (id: string, title = `Book ${id}`): Book => ({ id, title, author: 'A. Writer', shelf: 'mine', difficulty: 0, isOnDevice: false, year: '', genre: '', summary: '', authorBio: '', pageCount: 0 });

export type FakeServer = { tables: Map<string, any[]>; requests: string[]; rows: Record<string, number>; fetch: typeof fetch; reset(): void; setClock(ms: number): void };
export function makeServer(): FakeServer {
  const tables = new Map<string, any[]>();
  const requests: string[] = [];
  const rows: Record<string, number> = {};
  let seq = 0; let clock = Date.now() - 3_600_000; // saves are timestamped an hour ago unless a test says otherwise
  const tick = () => new Date((clock += 1000)).toISOString();
  const keyOf = (table: string, r: any) => (table === 'user_library_preferences' ? r.user_id : r.id);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const CONTROL = new Set(['select', 'order', 'limit', 'offset']);
  const handler = (async (input: any, init: RequestInit = {}) => {
    const url = new URL(String(input)); const table = url.pathname.split('/').pop()!; const method = init.method || 'GET';
    requests.push(`${method} ${table}`);
    const list = tables.get(table) || [];
    const match = (r: any) => [...url.searchParams].every(([k, v]) => {
      if (CONTROL.has(k)) return true;
      if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
      if (v.startsWith('gte.')) return String(r[k]) >= v.slice(4);
      return true;
    });
    if (method === 'GET') {
      let out = list.filter(match);
      const order = url.searchParams.get('order') || 'id.asc'; const [col, dir] = order.split('.');
      out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (dir === 'desc' ? -1 : 1));
      const offset = Number(url.searchParams.get('offset') || 0); const limit = Number(url.searchParams.get('limit') || out.length);
      out = out.slice(offset, offset + limit);
      rows[table] = (rows[table] || 0) + out.length;
      return json(out);
    }
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (method === 'POST') {
      const made = { ...body, id: body.id || `00000000-0000-5000-8000-${String(++seq).padStart(12, '0')}`, revision: body.revision || 1, updated_at: tick() };
      const dupe = list.some(r => keyOf(table, r) === keyOf(table, made) || (table === 'user_library_books' && r.user_id === made.user_id && r.local_book_id === made.local_book_id));
      if (dupe) return json({ message: 'duplicate key value' }, 409);
      tables.set(table, [...list, made]);
      return json([made], 201);
    }
    if (method === 'PATCH') {
      const hit = list.filter(match);
      hit.forEach(r => Object.assign(r, body, { revision: r.revision + 1, updated_at: tick() })); // the touch trigger
      return json(hit.map(r => ({ ...r })));
    }
    return json([]);
  }) as unknown as typeof globalThis.fetch;
  return { tables, requests, rows, fetch: handler, reset() { requests.length = 0; for (const k of Object.keys(rows)) delete rows[k]; }, setClock(ms: number) { clock = ms; } };
}

export type Device = { storage: Map<string, string> };
export const makeDevice = (): Device => { const storage = new Map<string, string>(); storage.set('readlife.sb1', JSON.stringify({ access: 'a', refresh: 'r', exp: Date.now() + 3_600_000, user: { id: USER } })); return { storage }; };
/** Make `device` the one whose storage the app code reads (one process stands in for several phones). */
export function useDevice(device: Device, forget?: () => void): void {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => device.storage.get(k) ?? null, setItem: (k: string, v: string) => void device.storage.set(k, v), removeItem: (k: string) => void device.storage.delete(k) } });
  forget?.();
}
export function installNetwork(server: FakeServer): () => void {
  const oldFetch = globalThis.fetch; const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator'); const ls = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  globalThis.fetch = server.fetch;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  return () => {
    globalThis.fetch = oldFetch;
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete (globalThis as any).navigator;
    if (ls) Object.defineProperty(globalThis, 'localStorage', ls); else delete (globalThis as any).localStorage;
  };
}
