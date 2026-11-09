/**
 * What a provider told us about a book beyond what the Book object keeps (publisher, full release date, every category, every author, Apple's track id...).
 * The source adapters note it here while they build a Book; the owner's "Save to catalog" reads it and keeps it as unpublished candidates with its source.
 *
 * Memory first; persisted to this device only for the owner (see setProviderFactsPersistence). Never in the user's library, the book snapshot or the sync tables, so personal data and offline behaviour are untouched.
 * With nothing stored, a save simply has no extra facts to keep (nothing is invented). Bounded, oldest first out.
 */

import type { Provider } from './providers';
export type FactProvider = Provider;
export interface ProviderFacts {
  provider: FactProvider;
  /** The provider's own record id: Apple trackId, Google volume id, Open Library work id */
  recordId: string;
  publisher?: string;
  /** Exactly as the provider printed it ("2021-03-03T08:00:00Z", "2021-03", "March 3, 2021") */
  publishedDate?: string;
  /** Provider category / genre / subject labels, untouched */
  genres?: string[];
  subjects?: string[];
  language?: string;
  authors?: string[];
  altAuthorNames?: string[];
  pages?: number;
  /** Hardcover only (no ids to look it up by): the rating pair and the few facts its record gave: slug, readers, year, cover URL (a link, never the image or the description text) */
  rating?: { average: number; count: number };
  extra?: Record<string, string | number>;
  /** Hardcover only: its description text. Kept as an UNPUBLISHED content candidate for the owner's review (never in the receipt payload, never published automatically). */
  description?: string;
  sourceUrl?: string;
  seenAt: string;
}

const MAX = 300;
const memo = new Map<string, ProviderFacts>();

/**
 * Optional device-local persistence, so facts fetched earlier survive a reload and the owner's capture can still use them.
 * Off unless a gate says so (the app turns it on for the signed-in owner only): other people's devices keep nothing. It is plain catalog data, never
 * the user's library, never synced, and a full or blocked localStorage just means "memory only". Trimmed facts only (no raw responses).
 */
const STORE_KEY = 'readlife.providerfacts1';
let gate: (() => boolean) | undefined;
let hydrated = false;
let timer: ReturnType<typeof setTimeout> | undefined;
export function setProviderFactsPersistence(g?: () => boolean): void { gate = g; if (!g) hydrated = false; }
const PROVIDERS = new Set(['apple', 'google', 'openlibrary', 'hardcover']);
/** Hardcover has no id on our books: its record is found by title + author (same key the lookup used). */
const hcByBook = new Map<string, string>();
export const hardcoverBookKey = (title: string, author: string) => `${(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${(author || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
export const rememberHardcoverFor = (title: string, author: string, recordId: string) => { hcByBook.set(hardcoverBookKey(title, author), String(recordId)); while (hcByBook.size > 300) hcByBook.delete(hcByBook.keys().next().value as string); };
function hydrate(): void {
  if (hydrated || !gate?.()) return;
  hydrated = true;
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    if (!Array.isArray(raw)) return;
    for (const f of raw) {
      if (!f || typeof f !== 'object' || !PROVIDERS.has(f.provider) || typeof f.recordId !== 'string' || !f.recordId) continue;
      const k = keyOf(f.provider, f.recordId);
      if (!memo.has(k)) memo.set(k, f as ProviderFacts); // what was seen this session is newer than what was stored
    }
    while (memo.size > MAX) memo.delete(memo.keys().next().value as string);
  } catch { /* unreadable: start from memory */ }
}
export function flushProviderFacts(): void {
  if (timer) { clearTimeout(timer); timer = undefined; }
  if (!gate?.()) return;
  try { localStorage.setItem(STORE_KEY, JSON.stringify([...memo.values()])); } catch { /* full or blocked: memory only */ }
}
function persistSoon(): void {
  if (timer || !gate?.()) return;
  timer = setTimeout(flushProviderFacts, 1500);
  (timer as { unref?: () => void }).unref?.();
}
const keyOf = (provider: FactProvider, recordId: string) => `${provider}:${recordId}`;

const clean = <T,>(o: T): T => { for (const k of Object.keys(o as object)) { const v = (o as any)[k]; if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) delete (o as any)[k]; } return o; };

export function rememberProviderFacts(f: Omit<ProviderFacts, 'seenAt'>): void {
  if (!f.recordId) return;
  const k = keyOf(f.provider, String(f.recordId));
  memo.delete(k); // re-insert so the newest is last
  memo.set(k, clean({ ...f, recordId: String(f.recordId), seenAt: new Date().toISOString() }));
  while (memo.size > MAX) memo.delete(memo.keys().next().value as string);
  persistSoon();
}

/** Facts for a book, found by the provider ids it carries (Apple "apple_123" id, Google volume id, Open Library work id). */
export function providerFactsFor(book: { id?: string; title?: string; author?: string; identity?: { gbVolume?: string; olWork?: string } }): ProviderFacts[] {
  hydrate();
  const out: ProviderFacts[] = [];
  const add = (p: FactProvider, id?: string) => { const f = id ? memo.get(keyOf(p, id)) : undefined; if (f) out.push(f); };
  const apple = /^apple_(\d+)$/.exec(book.id || '');
  add('apple', apple?.[1]);
  add('google', book.identity?.gbVolume || (/^gb_(.+)$/.exec(book.id || '') || [])[1]);
  add('openlibrary', book.identity?.olWork);
  if (book.title) add('hardcover', hcByBook.get(hardcoverBookKey(book.title, book.author || '')));
  return out;
}

/** Tests only. */
export const forgetProviderFactsForTests = () => { memo.clear(); hcByBook.clear(); hydrated = false; gate = undefined; if (timer) { clearTimeout(timer); timer = undefined; } };
