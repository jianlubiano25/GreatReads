import { dedupeInflight, getJson } from '../http';
import { persistentCache } from '../cache';
import { cleanIsbn, isbnPair } from '../identity';
import type { CallOpts } from './types';

/** New York Times Books API: the authority for bestseller rank. */

export interface NytEntry {
  rank: number; // 1 = top
  rankLastWeek: number; // 0 = was not on the list
  weeksOnList: number;
  title: string;
  author: string;
  description: string;
  publisher: string;
  cover: string; // jacket of the primary edition
  isbn13?: string;
  isbn10?: string;
  list: string;
  publishedDate: string;
}

const LIST_TTL = 3 * 60 * 60 * 1000;
const cache = persistentCache<NytEntry[]>('readlife.nyt1', { ttl: LIST_TTL, max: 6 });

/**
 * With VITE_NYT_API_KEY set (local dev only) the key is used directly. In production the request goes to this site's own
 * /api/nyt function, which holds the key as a server-side secret (see functions/api/nyt.js), so it never ships in the app.
 */
function listUrl(list: string): string {
  let key = '';
  try { key = String((import.meta as any).env?.VITE_NYT_API_KEY || ''); } catch {}
  return key
    ? `https://api.nytimes.com/svc/books/v3/lists/current/${list}.json?api-key=${encodeURIComponent(key)}`
    : `/api/nyt?list=${encodeURIComponent(list)}`;
}

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs']);
/** NYT sends titles in capitals ("IT ENDS WITH US"). */
export function nytTitleCase(s: string): string {
  if (s !== s.toUpperCase()) return s; // already mixed case
  return s.toLowerCase().replace(/[a-z][a-z'’]*/g, (w, i) => (i > 0 && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)));
}

export function parseNytList(data: any): NytEntry[] {
  const books: any[] = data?.results?.books || [];
  return books
    .map(b => {
      const i13 = cleanIsbn(b.primary_isbn13);
      const i10 = cleanIsbn(b.primary_isbn10);
      return {
        rank: Number(b.rank) || 0,
        rankLastWeek: Number(b.rank_last_week) || 0,
        weeksOnList: Number(b.weeks_on_list) || 0,
        title: nytTitleCase(String(b.title || '').trim()),
        author: String(b.author || '').trim(),
        description: String(b.description || '').trim(),
        publisher: String(b.publisher || '').trim(),
        cover: String(b.book_image || '').replace(/^http:\/\//i, 'https://'),
        ...isbnPair(i13 || i10),
        list: String(data?.results?.list_name_encoded || ''),
        publishedDate: String(data?.results?.published_date || ''),
      } as NytEntry;
    })
    .filter(e => e.rank > 0 && e.title)
    .sort((a, b) => a.rank - b.rank);
}

export const getCachedNytList = (list: string): NytEntry[] | undefined => cache.get(list);

/** The current list in NYT order. Returns null when it cannot be fetched (no key/proxy, offline, rate limit). */
const inflight = new Map<string, Promise<NytEntry[] | null>>();
export async function fetchNytList(list: string, opts: CallOpts = {}): Promise<NytEntry[] | null> {
  const hit = cache.get(list);
  if (hit) return hit;
  return dedupeInflight(inflight, list, async () => {
    const data = await getJson(listUrl(list), { timeout: 10000, retries: 1, signal: opts.signal });
    const entries = parseNytList(data);
    if (!entries.length) return null;
    cache.set(list, entries);
    return entries;
  });
}
