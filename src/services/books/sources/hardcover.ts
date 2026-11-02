import { titleKey, authorKey } from '../identity';

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
  const d = deps ?? (typeof window === 'undefined' ? undefined : real);
  if (!d || !title || d.now() < offUntil) return null;
  const q = new URLSearchParams({ op: 'books', q: title, ...(author ? { author } : {}) });
  const r = await d.fetchJson(`/api/hardcover?${q}`);
  if (r.status === 429) { offUntil = d.now() + 60_000; return null; }
  if (r.status === 503 || r.status === 502 || r.status === 0) { offUntil = d.now() + 10 * 60_000; return null; }
  const books: any[] = Array.isArray(r.body?.books) ? r.body.books : [];
  const want = titleKey(title);
  const wantAuthor = authorKey(author);
  const hit = books.find(b => titleKey(String(b.title || '')) === want && Number(b.rating) > 0 && Number(b.ratingsCount) > 0
    && (!wantAuthor || !(b.authors || []).length || (b.authors as string[]).some(a => authorKey(a) === wantAuthor)));
  return hit ? { average: Number(hit.rating), count: Number(hit.ratingsCount) } : null;
}
