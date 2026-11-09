import { titleKey, authorKey } from '../identity';
import { bump } from '../perf';
import { rememberHardcoverFor, rememberProviderFacts } from '../providerFacts';

/**
 * Hardcover ratings through OUR server function (/api/hardcover, which holds the token). Used only to fill a missing rating (Hidden Gems pools, ratings gaps);
 * a Hardcover rating is a stand-alone pair with ratingSource 'hardcover', never mixed into the Apple / Open Library / Google ladder.
 * Never throws. Browser only (tests and Node do nothing unless `deps` is given). When the function is not set up (503), the token is rejected, or Hardcover
 * limits us (429), nothing is asked again for a while, so a missing key costs nothing.
 */
export interface HardcoverDeps { fetchJson: (url: string) => Promise<{ status: number; body: any }>; now: () => number }
const real: HardcoverDeps = {
  fetchJson: async url => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try { const r = await fetch(url, { signal: ctl.signal }); return { status: r.status, body: await r.json().catch(() => null) }; }
    catch { return { status: 0, body: null }; } finally { clearTimeout(t); }
  },
  now: () => Date.now(),
};
let offUntil = 0;
export const resetHardcoverForTests = () => { offUntil = 0; };

export async function hardcoverRating(title: string, author: string, deps?: HardcoverDeps): Promise<{ average: number; count: number } | null> {
  const hit = await hardcoverMatch(title, author, deps);
  return hit ? { average: hit.average, count: hit.count } : null;
}

/** The matched Hardcover book: rating pair plus the facts kept as a provider record (remembered for the owner's Save to catalog / capture). */
export async function hardcoverMatch(title: string, author: string, deps?: HardcoverDeps): Promise<{ average: number; count: number; id: string; slug?: string; year?: number; readers?: number; cover?: string; pages?: number; genres?: string[] } | null> {
  const d = deps ?? (typeof window === 'undefined' ? undefined : real);
  if (!d || !title || d.now() < offUntil) return null;
  const q = new URLSearchParams({ op: 'books', q: title, ...(author ? { author } : {}) });
  const r = await d.fetchJson(`/api/hardcover?${q}`);
  bump('hardcover.calls'); // Copy diagnostics: calls / ok / matched / failed by reason, so the next paste shows whether Hardcover works
  if (r.status === 429) { bump('hardcover.failed.rate_limited'); offUntil = d.now() + 60_000; return null; }
  if (r.status === 503 || r.status === 502 || r.status === 0) { bump(`hardcover.failed.${r.body?.error || (r.status ? r.status : 'network')}`); offUntil = d.now() + 10 * 60_000; return null; }
  bump('hardcover.ok');
  const books: any[] = Array.isArray(r.body?.books) ? r.body.books : [];
  const want = titleKey(title);
  const wantAuthor = authorKey(author);
  const hit = books.find(b => titleKey(String(b.title || '')) === want && Number(b.rating) > 0 && Number(b.ratingsCount) > 0
    && (!wantAuthor || !(b.authors || []).length || (b.authors as string[]).some(a => authorKey(a) === wantAuthor)));
  if (hit) bump('hardcover.matched');
  if (!hit) return null;
  const out = { average: Number(hit.rating), count: Number(hit.ratingsCount), id: String(hit.id ?? ''), slug: hit.slug ? String(hit.slug) : undefined, year: Number(hit.year) || undefined, readers: Number(hit.readers) || undefined, cover: typeof hit.cover === 'string' ? hit.cover : undefined, pages: Number(hit.pages) || undefined, genres: Array.isArray(hit.genres) ? hit.genres.map(String).slice(0, 8) : undefined };
  if (out.id) {
    // everything Hardcover said about the book, as facts for the owner's catalog candidates (Save to catalog / capture): nothing is published from here
    rememberProviderFacts({ provider: 'hardcover', recordId: out.id, authors: Array.isArray(hit.authors) ? hit.authors.slice(0, 10) : undefined, publishedDate: typeof hit.releaseDate === 'string' ? hit.releaseDate : out.year ? String(out.year) : undefined, rating: { average: out.average, count: out.count },
      ...(out.genres?.length ? { genres: out.genres } : {}), ...(out.pages ? { pages: out.pages } : {}), ...(typeof hit.description === 'string' && hit.description.trim() ? { description: hit.description.trim().slice(0, 1500) } : {}),
      extra: { ...(out.slug ? { slug: out.slug } : {}), ...(out.readers ? { readers: out.readers } : {}), ...(out.year ? { year: out.year } : {}), ...(out.cover ? { cover: out.cover } : {}), ...(hit.subtitle ? { subtitle: String(hit.subtitle).slice(0, 200) } : {}) },
      ...(out.slug ? { sourceUrl: `https://hardcover.app/books/${out.slug}` } : {}) });
    rememberHardcoverFor(title, author, out.id);
  }
  return out;
}
