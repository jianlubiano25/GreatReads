/**
 * D7 step 3: a book on this device that has no provider data yet gets ONE look-up per provider that is missing (Google, Apple, Open Library, Hardcover),
 * so its receipts and labels can be saved. Each source remembers what it found as provider facts (providerFacts.ts). Only owner capture / Save to catalog call this,
 * only for a book already on the device, once per book and session, one at a time; a failed or empty look-up is simply a provider with no facts.
 */
import { providerFactsFor, type FactProvider } from './providerFacts';
import { findGoogle } from './sources/googleBooks';
import { lookupApple } from './sources/appleBooks';
import { findOpenLibrary } from './sources/openLibrary';
import { hardcoverMatch } from './sources/hardcover';

export interface LookupBook { id?: string | number; title: string; author?: string; identity?: { isbn13?: string; isbn10?: string; gbVolume?: string; olWork?: string } }
export interface LookupDeps {
  google: (q: { title: string; author?: string; isbn?: string }) => Promise<unknown>;
  apple: (q: { title: string; author?: string }) => Promise<unknown>;
  openlibrary: (q: { title: string; author?: string; isbn?: string }) => Promise<unknown>;
  hardcover: (title: string, author: string) => Promise<unknown>;
}
const live: LookupDeps = {
  google: q => findGoogle(q, {}),
  apple: q => lookupApple(q),
  openlibrary: q => findOpenLibrary(q),
  hardcover: (t, a) => hardcoverMatch(t, a),
};
let enabled = true;
/** Tests that must prove nothing is asked of a provider switch the look-ups off (and back on). */
export const setProviderLookups = (on: boolean) => { enabled = on; };
export const providerLookupsOn = () => enabled;
const asked = new Set<string>();
export const forgetProviderLookupsForTests = () => asked.clear();

/** Which providers the app has no remembered facts for yet. */
export function missingProviders(book: LookupBook): FactProvider[] {
  const have = new Set(providerFactsFor({ id: String(book.id ?? ''), title: book.title, author: book.author, identity: book.identity }).map(f => f.provider));
  return (['google', 'apple', 'openlibrary', 'hardcover'] as const).filter(p => !have.has(p));
}

/** Asks each missing provider once (in order, never in parallel); returns the providers that were asked. */
export async function ensureProviderFacts(book: LookupBook, deps: LookupDeps = live): Promise<FactProvider[]> {
  const key = `${(book.title || '').toLowerCase().trim()}|${(book.author || '').toLowerCase().trim()}`;
  if (!enabled || !book.title?.trim() || asked.has(key)) return [];
  asked.add(key);
  const author = book.author && !/^unknown/i.test(book.author) ? book.author : '';
  const isbn = book.identity?.isbn13 || book.identity?.isbn10;
  const out: FactProvider[] = [];
  for (const p of missingProviders(book)) {
    out.push(p);
    try {
      if (p === 'google') await deps.google({ title: book.title, author, isbn });
      else if (p === 'apple') await deps.apple({ title: book.title, author });
      else if (p === 'openlibrary') await deps.openlibrary({ title: book.title, author, isbn });
      else await deps.hardcover(book.title, author);
    } catch { /* a provider that cannot be reached has no facts this time */ }
  }
  return out;
}
