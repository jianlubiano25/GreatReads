/**
 * What a provider told us about a book beyond what the Book object keeps (publisher, full release date, every category, every author, Apple's track id...).
 * The source adapters note it here while they build a Book; the owner's "Save to catalog" reads it and keeps it as unpublished candidates with its source.
 *
 * Memory only: never written to localStorage, the user's library, the book snapshot or the sync tables, so personal data and offline behaviour are untouched.
 * It is empty after a reload; a save then simply has no extra facts to keep (nothing is invented). Bounded, oldest first out.
 */

export type FactProvider = 'apple' | 'google' | 'openlibrary';
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
  sourceUrl?: string;
  seenAt: string;
}

const MAX = 300;
const memo = new Map<string, ProviderFacts>();
const keyOf = (provider: FactProvider, recordId: string) => `${provider}:${recordId}`;

const clean = <T,>(o: T): T => { for (const k of Object.keys(o as object)) { const v = (o as any)[k]; if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) delete (o as any)[k]; } return o; };

export function rememberProviderFacts(f: Omit<ProviderFacts, 'seenAt'>): void {
  if (!f.recordId) return;
  const k = keyOf(f.provider, String(f.recordId));
  memo.delete(k); // re-insert so the newest is last
  memo.set(k, clean({ ...f, recordId: String(f.recordId), seenAt: new Date().toISOString() }));
  while (memo.size > MAX) memo.delete(memo.keys().next().value as string);
}

/** Facts for a book, found by the provider ids it carries (Apple "apple_123" id, Google volume id, Open Library work id). */
export function providerFactsFor(book: { id?: string; identity?: { gbVolume?: string; olWork?: string } }): ProviderFacts[] {
  const out: ProviderFacts[] = [];
  const add = (p: FactProvider, id?: string) => { const f = id ? memo.get(keyOf(p, id)) : undefined; if (f) out.push(f); };
  const apple = /^apple_(\d+)$/.exec(book.id || '');
  add('apple', apple?.[1]);
  add('google', book.identity?.gbVolume || (/^gb_(.+)$/.exec(book.id || '') || [])[1]);
  add('openlibrary', book.identity?.olWork);
  return out;
}

/** Tests only. */
export const forgetProviderFactsForTests = () => memo.clear();
