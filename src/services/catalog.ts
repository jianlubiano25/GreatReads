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
import type { Book } from '../types';
import type { SourceRating } from './books';

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

/* ---------------- review (owner): browse every version of a book's cover / description / bio / rating, publish one, reject one ---------------- */

export type WorkRow = { id: string; canonical_title: string; canonical_author: string | null; status: string; updated_at: string };
export type Candidate = { id: string; table: 'catalog_cover_candidates' | 'catalog_content_versions' | 'catalog_rating_candidates'; kind: 'cover' | 'book_description' | 'author_bio' | 'rating'; status: string; selected: boolean; text: string; source: string; at: string };

export async function listWorks(q: string): Promise<{ ok: true; data: WorkRow[] } | { ok: false; error: string }> {
  const term = q.trim().replace(/[%*,()]/g, ' ');
  const filter = term ? `&or=(canonical_title.ilike.*${encodeURIComponent(term)}*,canonical_author.ilike.*${encodeURIComponent(term)}*)` : '';
  const r = await rest<WorkRow[]>(`catalog_works?select=id,canonical_title,canonical_author,status,updated_at&order=updated_at.desc&limit=60${filter}`);
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** Every version stored for one book, newest first, grouped by kind by the caller. */
export async function loadCandidates(workId: string): Promise<{ ok: true; data: Candidate[]; mainCover: string | null } | { ok: false; error: string }> {
  const [covers, content, ratings, work] = await Promise.all([
    rest<any[]>(`catalog_cover_candidates?work_id=eq.${workId}&select=id,image_url,source_name,status,is_preferred,created_at&order=created_at.desc`),
    rest<any[]>(`catalog_content_versions?work_id=eq.${workId}&select=id,content_type,content,source_name,status,is_selected,created_at&order=created_at.desc`),
    rest<any[]>(`catalog_rating_candidates?work_id=eq.${workId}&select=id,source_name,average_rating,rating_count,status,is_selected,created_at&order=created_at.desc`),
    rest<any[]>(`catalog_works?id=eq.${workId}&select=main_cover_candidate_id`),
  ]);
  for (const r of [covers, content, ratings, work]) if (!r.ok) return { ok: false, error: r.error };
  const out: Candidate[] = [
    ...(covers as any).data.map((c: any): Candidate => ({ id: c.id, table: 'catalog_cover_candidates', kind: 'cover', status: c.status, selected: !!c.is_preferred && c.status === 'published', text: c.image_url, source: c.source_name || '', at: c.created_at })),
    ...(content as any).data.map((c: any): Candidate => ({ id: c.id, table: 'catalog_content_versions', kind: c.content_type, status: c.status, selected: !!c.is_selected && c.status === 'published', text: c.content, source: c.source_name || '', at: c.created_at })),
    ...(ratings as any).data.map((c: any): Candidate => ({ id: c.id, table: 'catalog_rating_candidates', kind: 'rating', status: c.status, selected: !!c.is_selected && c.status === 'published', text: `${c.average_rating ?? '–'} / 5 (${c.rating_count ?? 0})`, source: c.source_name || '', at: c.created_at })),
  ];
  return { ok: true, data: out, mainCover: (work as any).data[0]?.main_cover_candidate_id ?? null };
}

export async function publishCandidate(c: Pick<Candidate, 'id' | 'kind'>): Promise<CatalogPublishResult> {
  const fn = c.kind === 'cover' ? 'catalog_publish_cover' : c.kind === 'rating' ? 'catalog_publish_rating' : 'catalog_publish_content';
  const r = await rpc(fn, c.kind === 'cover' ? { p_cover_id: c.id } : { p_id: c.id });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function rejectCandidate(c: Pick<Candidate, 'id' | 'table' | 'kind'>, reason: string): Promise<CatalogPublishResult> {
  const r = c.kind === 'cover' ? await rpc('catalog_reject_cover', { p_cover_id: c.id, p_reason: reason }) : await rpc('catalog_reject_candidate', { p_table: c.table, p_id: c.id, p_reason: reason });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function setWorkStatus(workId: string, status: 'draft' | 'published' | 'archived'): Promise<CatalogPublishResult> {
  const r = await rpc('catalog_set_work_status', { p_work_id: workId, p_status: status });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/**
 * Save what Book Info shows for this book (description, author bio, year, pages, genre and its main rating) into the catalog and publish it.
 * Values the owner already rejected are not brought back (the database refuses the same text again).
 */
export async function saveBookToCatalog(book: Pick<Book, 'title' | 'author' | 'summary' | 'authorBio' | 'year' | 'pageCount' | 'genre'>, ratings: SourceRating[]): Promise<{ ok: boolean; saved: string[]; skipped: string[] }> {
  const saved: string[] = [], skipped: string[] = [];
  const key = coverKey(book);
  const enc = encodeURIComponent;
  const found = await rest<{ id: string }[]>(`catalog_works?work_key=eq.${enc(key)}&select=id&limit=1`);
  if (!found.ok) return { ok: false, saved, skipped: [found.error] };
  let workId = found.data[0]?.id;
  if (!workId) {
    const made = await rest<{ id: string }[]>('catalog_works', { method: 'POST', prefer: 'return=representation', body: { canonical_title: book.title.trim(), canonical_author: (book.author || '').trim() || null, work_key: key, status: 'draft' } });
    if (!made.ok) return { ok: false, saved, skipped: [made.error] };
    workId = made.data[0]?.id;
  }
  if (!workId) return { ok: false, saved, skipped: ['no book id'] };

  const content = async (type: 'book_description' | 'author_bio', text?: string) => {
    if (!text || text.length < 40) return;
    const ins = await rest<{ id: string }[]>('catalog_content_versions', { method: 'POST', prefer: 'return=representation', body: { work_id: workId, content_type: type, language_code: 'en', content: text, source_name: 'app', status: 'approved' } });
    let id = ins.ok ? ins.data[0]?.id : undefined;
    if (!id) { // the same text may already be stored: publish that one unless it was rejected
      const ex = await rest<{ id: string; status: string }[]>(`catalog_content_versions?work_id=eq.${workId}&content_type=eq.${type}&content=eq.${enc(text)}&select=id,status&limit=1`);
      if (ex.ok && ex.data[0] && ex.data[0].status !== 'rejected') id = ex.data[0].id;
    }
    if (!id) return void skipped.push(type);
    (await rpc('catalog_publish_content', { p_id: id })).ok ? saved.push(type) : skipped.push(type);
  };
  const meta = async (field: string, value: unknown) => {
    if (value === undefined || value === null || value === '' || value === 'N/A') return;
    const ins = await rest<{ id: string }[]>('catalog_metadata_candidates', { method: 'POST', prefer: 'return=representation', body: { work_id: workId, field_name: field, field_value: value, source_name: 'app', status: 'approved' } });
    let id = ins.ok ? ins.data[0]?.id : undefined;
    if (!id) {
      const ex = await rest<{ id: string; status: string }[]>(`catalog_metadata_candidates?work_id=eq.${workId}&field_name=eq.${field}&source_name=eq.app&select=id,status&order=created_at.desc&limit=1`);
      if (ex.ok && ex.data[0] && ex.data[0].status !== 'rejected') id = ex.data[0].id;
    }
    if (!id) return void skipped.push(field);
    (await rpc('catalog_publish_metadata', { p_id: id })).ok ? saved.push(field) : skipped.push(field);
  };
  await content('book_description', book.summary);
  await content('author_bio', book.authorBio);
  await meta('year', /^\d{3,4}$/.test(book.year || '') ? book.year : undefined);
  await meta('pageCount', book.pageCount || undefined);
  await meta('genre', book.genre && book.genre !== 'Book' ? book.genre : undefined);

  // the catalog keeps ONE main rating per book (the database allows one selected): the first valid pair, in the app's own source order
  const SRC: Record<string, string> = { apple: 'apple_books', google: 'google_books', openlibrary: 'open_library' };
  const main = ratings.find(r => SRC[r.source] && r.average > 0 && (r.count ?? 0) > 0);
  if (main) {
    const src = SRC[main.source];
    const body = { work_id: workId, source_name: src, average_rating: main.average, rating_count: main.count, rating_scale: 5, status: 'approved' };
    let id: string | undefined;
    const ex = await rest<{ id: string }[]>(`catalog_rating_candidates?work_id=eq.${workId}&source_name=eq.${src}&edition_id=is.null&select=id&limit=1`);
    if (ex.ok && ex.data[0]) { id = ex.data[0].id; await rest(`catalog_rating_candidates?id=eq.${id}`, { method: 'PATCH', body: { average_rating: main.average, rating_count: main.count, checked_at: new Date().toISOString() } }); }
    else { const ins = await rest<{ id: string }[]>('catalog_rating_candidates', { method: 'POST', prefer: 'return=representation', body }); id = ins.ok ? ins.data[0]?.id : undefined; }
    if (id && (await rpc('catalog_publish_rating', { p_id: id })).ok) saved.push('rating'); else skipped.push('rating');
  }
  if (saved.length) await setWorkStatus(workId, 'published');
  return { ok: saved.length > 0, saved, skipped };
}
