/**
 * The published catalog (Supabase): everyone reads it, only the owner (signed in, on the admin list) writes it.
 *  - Read: one quiet top-up now and then, asking only for what changed since the last time (never per book), never blocking, never offline.
 *    A failure just means the saved copy keeps being used. The cover chain is: your own pick, then the catalog, then the old shared set, then live lookups.
 *  - Write (developer mode): your starred covers are added to the catalog and published in one safe step each.
 */
import { applyCatalog, catalogCopy, pruneCatalog, type CatalogWork } from './books/catalogCovers';
import { coverKey } from './books/coverAnalysis';
import { coverSourceOf, notifyCoversChanged } from './books';
import { rest, rpc } from './supabase';

const MIN_GAP = 10 * 60 * 1000;
const RETRY_GAP = 60 * 1000;
const FULL_GAP = 24 * 60 * 60 * 1000;
const PAGE = 300;

let syncing: Promise<boolean> | undefined;
let lastTry = 0;
let lastFull = 0;

export function syncCatalog(opts: { force?: boolean } = {}): Promise<boolean> {
  if (syncing) return syncing;
  const s = catalogCopy();
  const now = Date.now();
  if (!opts.force && (now - s.t < MIN_GAP || now - lastTry < RETRY_GAP)) return Promise.resolve(now - s.t < MIN_GAP);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve(false);
  lastTry = now;
  syncing = (async () => {
    try {
      const full = s.since === '-infinity' || (now - lastFull > FULL_GAP && s.t > 0 && now - s.t > FULL_GAP);
      let since = full ? '-infinity' : s.since;
      const seen = new Set<string>();
      let changed = false;
      for (let page = 0; page < 40; page++) {
        const r = await rpc<CatalogWork[]>('catalog_changes', { p_since: since, p_limit: PAGE });
        if (!r.ok || !Array.isArray(r.data)) return false;
        const works = r.data.filter(Boolean);
        works.forEach(w => seen.add(w.id));
        if (works.length) { changed = applyCatalog(works, works[works.length - 1].updatedAt) || changed; since = works[works.length - 1].updatedAt; }
        if (works.length < PAGE) break;
      }
      if (full) { lastFull = now; pruneCatalog(seen); }
      else applyCatalog([], since);
      if (changed || full) notifyCoversChanged();
      return true;
    } catch { return false; } finally { syncing = undefined; }
  })();
  return syncing;
}

/* ---------------- the owner's side ---------------- */

export type CatalogPublishResult = { ok: true } | { ok: false; error: string };

/** Add a starred cover to the catalog and publish it (work created if new). A cover that was rejected before stays rejected. */
export async function publishCoverToCatalog(book: { title: string; author?: string }, url: string): Promise<CatalogPublishResult> {
  const key = coverKey(book);
  const enc = encodeURIComponent;
  let work = await rest<{ id: string }[]>(`catalog_works?work_key=eq.${enc(key)}&select=id&limit=1`);
  if (!work.ok) return { ok: false, error: work.error };
  let workId = work.data[0]?.id;
  if (!workId) {
    const made = await rest<{ id: string }[]>('catalog_works', { method: 'POST', prefer: 'return=representation', body: { canonical_title: book.title.trim(), canonical_author: (book.author || '').trim() || null, work_key: key, status: 'draft' } });
    if (!made.ok) return { ok: false, error: made.status === 403 || made.status === 401 ? 'Not allowed: sign in as the owner.' : made.error };
    workId = made.data[0]?.id;
    if (!workId) return { ok: false, error: 'The catalog did not return the new book.' };
  }
  const found = await rest<{ id: string; status: string }[]>(`catalog_cover_candidates?work_id=eq.${workId}&image_url=eq.${enc(url)}&select=id,status&limit=1`);
  if (!found.ok) return { ok: false, error: found.error };
  let coverId = found.data[0]?.id;
  if (found.data[0]?.status === 'rejected') return { ok: false, error: 'That cover was rejected before, so it stays rejected.' };
  if (!coverId) {
    const added = await rest<{ id: string }[]>('catalog_cover_candidates', { method: 'POST', prefer: 'return=representation', body: { work_id: workId, image_url: url, source_name: coverSourceOf(url), status: 'approved' } });
    if (!added.ok) return { ok: false, error: added.error };
    coverId = added.data[0]?.id;
    if (!coverId) return { ok: false, error: 'The catalog did not return the new cover.' };
  }
  const pub = await rpc('catalog_publish_cover', { p_cover_id: coverId });
  if (!pub.ok) return { ok: false, error: pub.error };
  const st = await rpc('catalog_set_work_status', { p_work_id: workId, p_status: 'published' });
  return st.ok ? { ok: true } : { ok: false, error: st.error };
}
