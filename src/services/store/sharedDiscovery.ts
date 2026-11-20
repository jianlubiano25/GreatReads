/**
 * The shared discovery cache (owner order 6): genre lists and a few busy searches kept in ONE small Supabase table (`discovery_cache`, migration
 * 20261101000001, NOT applied until the owner approves). A cold start reads the shared row first, then the device's own saved copy, and only then asks the slow
 * public book sites. Until the table exists every call quietly does nothing (the app behaves exactly as before).
 *
 *  - Slim: only title, author, year, genre, the book's own ids, a cover link that is not Google's, and a rating when it came from Open Library or Apple
 *    (docs/provider-terms.md: nothing from Google beyond ids and bibliographic facts, no provider responses, nothing about a reader).
 *  - Never empty, never thinner: fewer than 3 books is not written; a much thinner list than the shared one is not written (the table refuses it too).
 *  - Writes come from admin devices only (RLS also says so). Rows expire after a day and are not read after that.
 */
import type { Book, BookIdentity } from '../../types';
import { makeBook } from '../books/model';
import { rest, isAdminKnown, currentUser } from '../supabase';
import { bump } from '../books/perf';

export type SharedKind = 'genre_pool' | 'search';
export const SHARED_MIN = 3;
export const SHARED_MAX = 40;

/** One book as stored: short keys keep a row at a few KB. */
export interface SlimBook { i: string | number; t: string; a: string; y?: string; g?: string; id?: BookIdentity; c?: string; ci?: number; ra?: number; rc?: number; rs?: 'openlibrary' | 'apple' | 'hardcover' }

/** The version of the stored shape. Rows written by an older version (v1 dropped every Open Library rating, so Hidden Gems found none) are never read: they have another key. */
export const SHARED_VERSION = 'v3'; // v3: genre pools rebuilt from precise queries (poolQueries); v2 rows are never read
/** Genre lists built with the subject check (C18) or the precise queries (C17) are stored under this version; every other list stays on SHARED_VERSION, whose rows were good. */
export const GENRE_FILTER_VERSION = 'v4';
/** How long a stored list stays readable. Genre lists change slowly; with 1 day only the lists filled in the last 24 hours existed (1 of 56 on 2026-11-05) and Hidden Gems went empty again. */
export const SHARED_DAYS = 7;
const versioned = (key: string, version: string = SHARED_VERSION) => `${version}|${key}`;

/** Which site a book's rating came from. Open Library search hits carry no `ratingSource` (only `source: 'openlibrary'` and an `ol_` id), so it is worked out here. Google's and the library's are never shared. */
function ratingSiteOf(b: Book): 'openlibrary' | 'apple' | 'hardcover' | undefined {
  const s = b.ratingSource ?? (b.source === 'openlibrary' || b.source === 'apple' ? b.source : typeof b.id === 'string' && b.id.startsWith('ol_') ? 'openlibrary' : typeof b.id === 'string' && b.id.startsWith('apple_') ? 'apple' : undefined);
  return s === 'openlibrary' || s === 'apple' || s === 'hardcover' ? s : undefined;
}

const isGoogleUrl = (u?: string) => !!u && /(^|\.)(google|googleapis|googleusercontent|gstatic)\.com\//i.test(u.replace(/^https?:\/\//i, ''));

export function slimBooks(books: readonly Book[]): SlimBook[] {
  const out: SlimBook[] = [];
  for (const b of books.slice(0, SHARED_MAX)) {
    if (!b?.title) continue;
    const identity: BookIdentity | undefined = b.identity ? { olWork: b.identity.olWork, olEdition: b.identity.olEdition, isbn13: b.identity.isbn13, isbn10: b.identity.isbn10 } : undefined; // never the Google volume id
    const site = ratingSiteOf(b);
    const okRating = !!site && Number(b.ratingAverage) > 0 && Number(b.ratingCount) > 0;
    const s: SlimBook = { i: b.id, t: b.title, a: b.author };
    if (b.year) s.y = b.year;
    if (b.genre && b.genre !== 'Book') s.g = b.genre;
    if (identity && Object.values(identity).some(Boolean)) s.id = Object.fromEntries(Object.entries(identity).filter(([, v]) => v)) as BookIdentity;
    if (b.coverUrl && !isGoogleUrl(b.coverUrl)) s.c = b.coverUrl;
    if (Number.isInteger(b.coverId) && Number(b.coverId) > 0) s.ci = b.coverId;
    if (okRating) { s.ra = Number(b.ratingAverage); s.rc = Number(b.ratingCount); s.rs = site; }
    out.push(s);
  }
  return out;
}

export function hydrateBooks(rows: unknown): Book[] {
  if (!Array.isArray(rows)) return [];
  const out: Book[] = [];
  for (const r of rows as SlimBook[]) {
    if (!r || typeof r.t !== 'string' || !r.t) continue;
    out.push(makeBook({
      id: r.i ?? r.t, title: r.t, author: r.a || 'Unknown Author', year: r.y || '', genre: r.g || 'Book', identity: r.id, coverUrl: r.c, coverId: r.ci,
      ratingAverage: r.ra, ratingCount: r.rc, ratingSource: r.rs, source: r.rs === 'apple' ? 'apple' : 'openlibrary',
    }));
  }
  return out;
}

export interface SharedDeps {
  rest: typeof rest;
  isAdmin: () => boolean;
  now: () => number;
}
const real: SharedDeps = { rest, isAdmin: () => !!currentUser() && isAdminKnown() === true, now: () => Date.now() };

/** The table is missing (migration not applied) or the site is unreachable: do not ask again for a while. */
let offUntil = 0;
const OFF_MS = 10 * 60 * 1000;
export const resetSharedDiscoveryForTests = () => { offUntil = 0; };

const enc = encodeURIComponent;

/** A live shared list for this key, or null (nothing shared yet, expired, table not there, offline). Never throws. */
export async function readShared(kind: SharedKind, key: string, deps: SharedDeps = real, version: string = SHARED_VERSION): Promise<Book[] | null> {
  if (deps === real && typeof window === 'undefined') return null; // scripts and tests never call Supabase from here
  if (deps.now() < offUntil) return null;
  const r = await deps.rest<{ payload: unknown }[]>(`discovery_cache?kind=eq.${kind}&cache_key=eq.${enc(versioned(key, version))}&select=payload&limit=1`);
  if (!r.ok) { if (r.status === 404 || r.status === 400 || r.status === 0 || r.status >= 500) offUntil = deps.now() + OFF_MS; bump('shared.readFailed'); return null; }
  const books = hydrateBooks(r.data?.[0]?.payload);
  if (books.length < SHARED_MIN) { bump('shared.miss'); return null; }
  bump('shared.hit');
  return books;
}

/** Admin devices only: publish a good, full list for everyone. Returns true when written. Never throws. */
export async function writeShared(kind: SharedKind, key: string, books: readonly Book[], deps: SharedDeps = real, version: string = SHARED_VERSION): Promise<boolean> {
  if (deps === real && typeof window === 'undefined') return false;
  if (!deps.isAdmin() || deps.now() < offUntil) return false;
  const slim = slimBooks(books);
  if (slim.length < SHARED_MIN) return false; // never an empty or thin list
  const existing = await deps.rest<{ item_count: number }[]>(`discovery_cache?kind=eq.${kind}&cache_key=eq.${enc(versioned(key, version))}&select=item_count&limit=1`);
  if (!existing.ok) { if ([0, 400, 404].includes(existing.status) || existing.status >= 500) offUntil = deps.now() + OFF_MS; return false; }
  const had = existing.data?.[0]?.item_count ?? 0;
  if (had && slim.length * 2 < had) return false; // never a much thinner list over a fuller one
  const at = new Date(deps.now()).toISOString();
  const body = { kind, cache_key: versioned(key, version), payload: slim, fetched_at: at, expires_at: new Date(deps.now() + SHARED_DAYS * 24 * 60 * 60 * 1000).toISOString() };
  const w = await deps.rest(`discovery_cache?on_conflict=kind,cache_key`, { method: 'POST', body, prefer: 'resolution=merge-duplicates,return=minimal' });
  if (!w.ok) { bump('shared.writeFailed'); return false; }
  bump('shared.written');
  return true;
}
