import { sizedCoverUrl, type CoverSize } from './covers';

/** What a chosen cover is, shared by your own picks (coverPicks.ts) and the set published for everyone (sharedCovers.ts). */

export type CoverSource = 'apple' | 'google' | 'openlibrary' | 'link';
export const COVER_SOURCE_LABEL: Record<CoverSource, string> = { apple: 'Apple Books', google: 'Google Books', openlibrary: 'Open Library', link: 'Original link' };
/** `title` / `author` are kept (as typed) so a list of picks can name its books; the key alone is lower-cased. */
export type CoverPick = { url: string; source: CoverSource; t: number; title?: string; author?: string };

/** Which site an image URL belongs to (so a book's own link can say where it came from). */
export function coverSourceOf(url: string): CoverSource {
  try {
    const host = new URL(url).hostname;
    if (/(^|\.)mzstatic\.com$/.test(host)) return 'apple';
    if (/(^|\.)(books\.google\.[a-z.]+|googleusercontent\.com|gstatic\.com)$/.test(host)) return 'google';
    if (/(^|\.)(openlibrary\.org|archive\.org)$/.test(host)) return 'openlibrary';
  } catch {}
  return 'link';
}

const SOURCES: readonly string[] = ['apple', 'google', 'openlibrary', 'link'];
export const isHttps = (u: unknown): u is string => typeof u === 'string' && u.length <= 1000 && /^https:\/\/[^\s]+$/i.test(u);
const short = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined);

/** Keep only well-formed picks: a record saved by another version, sent by the server, or pasted in a backup is checked entry by entry and never trusted whole. */
export function cleanPicks(raw: unknown): Record<string, CoverPick> {
  const out: Record<string, CoverPick> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, any>)) {
    if (!k || k.length > 200 || !v || typeof v !== 'object' || !isHttps(v.url)) continue;
    const rec: CoverPick = { url: v.url, source: SOURCES.includes(v.source) ? v.source : coverSourceOf(v.url), t: Number.isFinite(v.t) ? Number(v.t) : 0 };
    const title = short(v.title);
    const author = short(v.author);
    if (title) rec.title = title;
    if (author) rec.author = author;
    out[k] = rec;
  }
  return out;
}

/** The book a pick is for, for a list: its saved title / author, else the words of its key ("title|author"). */
export function pickBook(key: string, rec: Pick<CoverPick, 'title' | 'author'>): { title: string; author: string } {
  const [t = '', a = ''] = key.split('|');
  return { title: rec.title || t, author: rec.author || a };
}

const OL_ID = /^(https:\/\/covers\.openlibrary\.org\/b\/id\/\d+-)[SML](\.jpg)$/;
/** A picked URL at the size a card draws: Apple art is resized like any Apple cover, an Open Library id picks its own S / M / L file. */
export function pickSizedUrl(url: string, size: CoverSize): string {
  const m = OL_ID.exec(url);
  return m ? `${m[1]}${size}${m[2]}` : sizedCoverUrl(url, size);
}
