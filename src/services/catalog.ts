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
import { identityOf } from './books/identity';
import { catalogIdsFrom, planEdition, planWorkIdentifiers, type EditionRow } from './books/catalogIdentity';
import { classifyAll, classifyLabel, planEditionFill, planWorkFill, type EditionFillRow } from './books/catalogFill';
import { providerFactsFor, type ProviderFacts } from './books/providerFacts';
import { receiptKey, saveProviderReceipts } from './catalogReceipts';
import type { Book, BookIdentity } from '../types';
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

export type CatalogPublishResult = { ok: true; ids?: { saved: string[]; skipped: string[] } } | { ok: false; error: string; ids?: { saved: string[]; skipped: string[] } };

/**
 * Add a starred cover to the catalog and publish it (work created if new). A cover that was rejected before stays rejected.
 * When the book's ids are known they are recorded too, exactly as Save to catalog does (see saveIdentityToCatalog); `ids` reports what happened.
 */
export async function publishCoverToCatalog(book: { title: string; author?: string; identity?: BookIdentity }, url: string): Promise<CatalogPublishResult> {
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
  const ids = await saveIdentityToCatalog(workId, book.identity); // first: a rejected or failed cover must not stop the book's ids being recorded
  const found = await rest<{ id: string; status: string }[]>(`catalog_cover_candidates?work_id=eq.${workId}&image_url=eq.${enc(url)}&select=id,status&limit=1`);
  if (!found.ok) return { ok: false, error: found.error, ids };
  let coverId = found.data[0]?.id;
  if (found.data[0]?.status === 'rejected') return { ok: false, error: 'That cover was rejected before, so it stays rejected.', ids };
  if (!coverId) {
    const added = await rest<{ id: string }[]>('catalog_cover_candidates', { method: 'POST', prefer: 'return=representation', body: { work_id: workId, image_url: url, source_name: coverSourceOf(url), status: 'approved' } });
    if (!added.ok) return { ok: false, error: added.error, ids };
    coverId = added.data[0]?.id;
    if (!coverId) return { ok: false, error: 'The catalog did not return the new cover.', ids };
  }
  const pub = await rpc('catalog_publish_cover', { p_cover_id: coverId });
  if (!pub.ok) return { ok: false, error: pub.error, ids };
  const st = await rpc('catalog_set_work_status', { p_work_id: workId, p_status: 'published' });
  return st.ok ? { ok: true, ids } : { ok: false, error: st.error, ids };
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
 * Record this book's outside identifiers in the catalog: the Open Library work id on the work, and an edition row (ISBN-10/13, Open Library
 * edition id, Google Books volume id) when any edition id is known. Exact ids only; invalid or conflicting ones are reported and never written,
 * and nothing existing is overwritten, moved or merged. Needs the owner's sign-in (the database refuses anyone else).
 */
export async function saveIdentityToCatalog(workId: string, identity: BookIdentity | undefined): Promise<{ saved: string[]; skipped: string[]; retry?: true }> {
  const saved: string[] = [], skipped: string[] = [];
  let retry = false; // true only when a request failed (offline, server): the ids themselves were not judged, so a later try is worthwhile
  const out = () => ({ saved, skipped, ...(retry ? { retry: true as const } : {}) });
  const { ids, rejected } = catalogIdsFrom(identity);
  rejected.forEach(r => skipped.push(`identity:${r} not valid`));
  if (!Object.keys(ids).length) return out();

  if (ids.olWork) {
    const w = await rest<{ identifiers: Record<string, unknown> | null }[]>(`catalog_works?id=eq.${workId}&select=identifiers&limit=1`);
    if (!w.ok || !w.data[0]) { skipped.push('identity:work'); retry = true; }
    else {
      const plan = planWorkIdentifiers(w.data[0].identifiers, ids);
      plan.conflicts.forEach(c => skipped.push(`identity:${c}`));
      if (plan.patch) {
        // the other identifiers on the work (alt_keys, ...) stay; the database also refuses an olWork that another work already has (unique index)
        const up = await rest(`catalog_works?id=eq.${workId}`, { method: 'PATCH', body: { identifiers: { ...(w.data[0].identifiers || {}), ...plan.patch } } });
        if (up.ok) saved.push('olWork');
        else if (up.status === 409) skipped.push('identity:that Open Library id already belongs to another catalog book');
        else { skipped.push(`identity:olWork ${up.error}`); retry = true; }
      }
    }
  }

  const clauses = [
    ids.isbn13 && `isbn13.eq.${ids.isbn13}`, ids.isbn10 && `isbn10.eq.${ids.isbn10}`,
    ids.olEdition && `openlibrary_edition_id.eq.${ids.olEdition}`, ids.gbVolume && `google_volume_id.eq.${ids.gbVolume}`,
  ].filter(Boolean);
  if (!clauses.length) return out();
  const found = await rest<EditionRow[]>(`catalog_editions?or=(${clauses.join(',')})&select=id,work_id,isbn13,isbn10,openlibrary_edition_id,google_volume_id&limit=10`);
  if (!found.ok) { skipped.push(`identity:edition ${found.error}`); retry = true; return out(); }
  const plan = planEdition(workId, ids, found.data);
  if (plan.action === 'conflict') skipped.push(`identity:${plan.reason}`);
  else if (plan.action === 'insert') {
    const r = await rest('catalog_editions', { method: 'POST', body: { work_id: workId, ...plan.body, source_name: 'app', status: 'published' } });
    if (r.ok) saved.push('edition');
    else if (r.status === 409) skipped.push('identity:edition already exists');
    else { skipped.push(`identity:edition ${r.error}`); retry = true; }
  } else if (plan.action === 'update') {
    const r = await rest(`catalog_editions?id=eq.${plan.id}`, { method: 'PATCH', body: plan.body });
    if (r.ok) saved.push('edition'); else { skipped.push(`identity:edition ${r.error}`); retry = true; }
  }
  return out();
}

/**
 * Save what Book Info shows for this book (description, author bio, year, pages, genre and its main rating) into the catalog and publish it.
 * Values the owner already rejected are not brought back (the database refuses the same text again). Its outside ids (Open Library work,
 * ISBN, edition and Google volume ids) are recorded too; see saveIdentityToCatalog.
 */
export async function saveBookToCatalog(book: Pick<Book, 'id' | 'identity' | 'title' | 'author' | 'summary' | 'authorBio' | 'year' | 'pageCount' | 'genre'> & Partial<Pick<Book, 'awardLabel'>>, ratings: SourceRating[]): Promise<{ ok: boolean; saved: string[]; skipped: string[] }> {
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
  // a shelf name such as "Reese's Book Club" or "Prize winner" is an honor, not a genre: it is filed under honors below, never as a genre candidate
  const genreLabel = book.genre && book.genre !== 'Book' && !classifyLabel(book.genre).some(c => c.kind === 'honor' || c.kind === 'tag' || c.kind === 'derived') ? book.genre : undefined;
  await meta('genre', genreLabel);

  // every site's rating is kept (one per source); each is published on its own
  for (const r of ratings) if (await storeRating(workId, r, true)) saved.push(`rating:${r.source}`); else if (RATING_SRC[r.source] && r.average > 0) skipped.push(`rating:${r.source}`);
  if (saved.length) await setWorkStatus(workId, 'published');
  // ids last and separate: they never decide whether the work gets published, and a conflict here never blocks the rest
  const idr = await saveIdentityToCatalog(workId, identityOf(book));
  saved.push(...idr.saved); skipped.push(...idr.skipped);
  // then the extra facts (genres, honors, provider candidates, edition details): fill-only, never changes what is already there
  const fr = await saveFactsToCatalog(workId, book);
  saved.push(...fr.saved); skipped.push(...fr.skipped);
  return { ok: saved.length > 0, saved, skipped };
}

/** A provider fact kept as an UNPUBLISHED candidate with its source: devices never see it, nothing selected is replaced, the same value twice is ignored (unique index). */
const FACT_FIELDS: { field: string; get: (f: ProviderFacts) => unknown }[] = [
  { field: 'publisher', get: f => f.publisher }, { field: 'publishedDate', get: f => f.publishedDate },
  { field: 'providerGenres', get: f => f.genres }, { field: 'providerSubjects', get: f => f.subjects },
  { field: 'providerLanguage', get: f => f.language }, { field: 'providerAuthors', get: f => f.authors },
  { field: 'altAuthorNames', get: f => f.altAuthorNames }, { field: 'providerPages', get: f => f.pages },
  { field: 'providerRecord', get: f => ({ id: f.recordId, ...(f.sourceUrl ? { url: f.sourceUrl } : {}) }) },
];

/**
 * Phase 1 "fill" step of Save to catalog. Owner only (the database refuses anyone else). Everything here only ADDS:
 *  - work: new genres and honors are appended to what the work already has (nothing removed or reordered); a shelf name or award label goes to honors, never genres.
 *  - candidates: what each provider said (publisher, exact date, categories, subjects, authors, alt author names, record id) as unpublished candidates with the provider as source.
 *  - edition: only when this work already has an edition with the SAME Google volume id as the facts, its EMPTY publisher/date/year/pages/language are filled. A disagreeing filled value stays and the provider's value is kept as a candidate.
 * Facts exist only for lookups made in this session (memory); with none, only the book's own genre/award label is filed. Never touches personal data, covers or other works.
 */
export async function saveFactsToCatalog(workId: string, book: Pick<Book, 'id' | 'identity' | 'genre'> & Partial<Pick<Book, 'awardLabel'>>, facts: ProviderFacts[] = providerFactsFor({ id: String(book.id), identity: book.identity })): Promise<{ saved: string[]; skipped: string[]; retry?: boolean }> {
  const saved: string[] = [], skipped: string[] = [];
  let retry = false;
  const flag = (r: { status: number }) => { if (r.status === 0 || r.status === 429 || r.status >= 500) retry = true; };

  // 0) receipts: what each provider said, stored once (trimmed, per docs/provider-terms.md) so it survives a reload and candidates can point at it
  const receipts = await saveProviderReceipts(workId, facts);
  skipped.push(...receipts.skipped); if (receipts.retry) retry = true;
  if (receipts.created) saved.push(`provider receipts (${receipts.created})`);

  // 1) genres and honors on the work
  const labels = [book.genre, ...facts.filter(f => f.provider !== 'openlibrary').flatMap(f => f.genres || [])]; // Open Library subjects are too loose to be genres: candidates only
  const c = classifyAll(labels);
  const honors = [...(book.awardLabel ? [book.awardLabel] : []), ...c.honors];
  if (c.genres.length || honors.length) {
    const cur = await rest<{ genres: string[] | null; honors: string[] | null }[]>(`catalog_works?id=eq.${workId}&select=genres,honors&limit=1`);
    if (!cur.ok || !cur.data[0]) { skipped.push('genres/honors: could not read the work'); if (!cur.ok) flag(cur); }
    else {
      const patch = planWorkFill(cur.data[0], { genres: c.genres, honors });
      if (Object.keys(patch).length) {
        const up = await rest(`catalog_works?id=eq.${workId}`, { method: 'PATCH', body: patch });
        if (up.ok) saved.push(...Object.keys(patch)); else { skipped.push(`${Object.keys(patch).join('/')}: ${up.error}`); flag(up); }
      }
    }
  }

  // 2) provider candidates (unpublished) and shared-tag labels
  let kept = 0;
  const addCandidate = async (field: string, value: unknown, source: string, recordId?: string, url?: string, receiptId?: string) => {
    const r = await rest('catalog_metadata_candidates', { method: 'POST', body: { work_id: workId, field_name: field, field_value: value, source_name: source, ...(recordId ? { source_record_id: recordId } : {}), ...(url ? { source_url: url } : {}), ...(receiptId ? { provider_record_id: receiptId, raw_value: value } : {}), status: 'candidate' } });
    if (r.ok) kept++; else if (r.status !== 409) { skipped.push(`candidate:${field} ${r.error}`); flag(r); } // 409 = this exact value from this source is already kept
  };
  for (const f of facts) for (const { field, get } of FACT_FIELDS) {
    const v = get(f);
    if (v !== undefined && !(Array.isArray(v) && !v.length)) await addCandidate(field, v, f.provider, f.recordId, f.sourceUrl, receipts.ids.get(receiptKey(f)));
  }
  for (const t of c.tags) await addCandidate('tagLabel', t, 'app');
  if (kept) saved.push(`provider facts (${kept})`);

  // 3) edition details, only for the edition this exact Google volume is
  const g = facts.find(f => f.provider === 'google');
  if (g && /^[A-Za-z0-9_-]{6,24}$/.test(g.recordId)) {
    const ed = await rest<(EditionFillRow & { id: string })[]>(`catalog_editions?work_id=eq.${workId}&google_volume_id=eq.${encodeURIComponent(g.recordId)}&select=id,publisher,publication_date,publication_year,page_count,language_code,format&limit=2`);
    if (!ed.ok) { skipped.push('edition details: could not read the edition'); flag(ed); }
    else if (ed.data.length === 1) {
      const plan = planEditionFill(ed.data[0], { publisher: g.publisher, publishedDate: g.publishedDate, pages: g.pages, language: g.language });
      if (Object.keys(plan.patch).length) {
        const up = await rest(`catalog_editions?id=eq.${ed.data[0].id}`, { method: 'PATCH', body: plan.patch });
        if (up.ok) saved.push('edition details'); else { skipped.push(`edition details: ${up.error}`); flag(up); }
      }
      plan.conflicts.forEach(x => skipped.push(`edition ${x} (kept both)`));
    }
  }
  return { saved, skipped, ...(retry ? { retry: true } : {}) };
}

const RATING_SRC: Record<string, string> = { apple: 'apple_books', google: 'google_books', openlibrary: 'open_library' };

/** The catalog's id for this book, created as a hidden draft when it is not there yet (nothing is shown to readers until something is published). */
export async function ensureWork(book: { title: string; author?: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const key = coverKey(book);
  const found = await rest<{ id: string }[]>(`catalog_works?work_key=eq.${encodeURIComponent(key)}&select=id&limit=1`);
  if (!found.ok) return { ok: false, error: found.status === 401 || found.status === 403 ? 'Sign in as the owner first (Profile → Account).' : found.error };
  if (found.data[0]) return { ok: true, id: found.data[0].id };
  const made = await rest<{ id: string }[]>('catalog_works', { method: 'POST', prefer: 'return=representation', body: { canonical_title: book.title.trim(), canonical_author: (book.author || '').trim() || null, work_key: key, status: 'draft' } });
  if (!made.ok) return { ok: false, error: made.status === 401 || made.status === 403 ? 'Sign in as the owner first (Profile → Account).' : made.error };
  return made.data[0]?.id ? { ok: true, id: made.data[0].id } : { ok: false, error: 'The catalog did not return the book.' };
}

/** Store one site's rating for the book (one row per source); published straight away when `publish`, else kept as an approved version to review. */
export async function storeRating(workId: string, r: SourceRating, publish: boolean): Promise<boolean> {
  const src = RATING_SRC[r.source];
  if (!src || !(r.average > 0)) return false;
  const ex = await rest<{ id: string }[]>(`catalog_rating_candidates?work_id=eq.${workId}&source_name=eq.${src}&edition_id=is.null&select=id&limit=1`);
  let id: string | undefined;
  if (ex.ok && ex.data[0]) {
    id = ex.data[0].id;
    const up = await rest(`catalog_rating_candidates?id=eq.${id}&status=neq.rejected`, { method: 'PATCH', body: { average_rating: r.average, rating_count: r.count ?? null, checked_at: new Date().toISOString() } });
    if (!up.ok) return false;
  } else {
    const ins = await rest<{ id: string }[]>('catalog_rating_candidates', { method: 'POST', prefer: 'return=representation', body: { work_id: workId, source_name: src, average_rating: r.average, rating_count: r.count ?? null, rating_scale: 5, status: 'approved' } });
    id = ins.ok ? ins.data[0]?.id : undefined;
  }
  if (!id) return false;
  return publish ? (await rpc('catalog_publish_rating', { p_id: id })).ok : true;
}

/** Keep a description or author bio as a stored version (approved, not live) so it can be compared and published from the review screen. */
export async function storeText(workId: string, type: 'book_description' | 'author_bio', text: string): Promise<boolean> {
  if (!text || text.length < 40) return false;
  const ins = await rest('catalog_content_versions', { method: 'POST', body: { work_id: workId, content_type: type, language_code: 'en', content: text, source_name: 'app', status: 'approved' } });
  return ins.ok || ins.status === 409; // 409: this exact text is already stored
}

/** The cover for this book is not to be used: stored as rejected (never comes back) and taken off the book if it was the main one. */
export async function rejectCoverForBook(book: { title: string; author?: string }, url: string): Promise<CatalogPublishResult> {
  const w = await ensureWork(book);
  if (!w.ok) return w;
  const found = await rest<{ id: string; status: string }[]>(`catalog_cover_candidates?work_id=eq.${w.id}&image_url=eq.${encodeURIComponent(url)}&select=id,status&limit=1`);
  if (!found.ok) return { ok: false, error: found.error };
  if (found.data[0]) {
    if (found.data[0].status === 'rejected') return { ok: true };
    const r = await rpc('catalog_reject_cover', { p_cover_id: found.data[0].id, p_reason: 'rejected in the cover viewer' });
    if (!r.ok) return { ok: false, error: r.error };
  } else {
    const ins = await rest('catalog_cover_candidates', { method: 'POST', body: { work_id: w.id, image_url: url, source_name: coverSourceOf(url), status: 'rejected', reviewed_at: new Date().toISOString() } });
    if (!ins.ok) return { ok: false, error: ins.error };
  }
  void syncCatalog({ force: true });
  return { ok: true };
}

/** Cover addresses the owner already rejected for this book (the viewer hides them). */
export async function rejectedCovers(book: { title: string; author?: string }): Promise<string[]> {
  const w = await rest<{ id: string }[]>(`catalog_works?work_key=eq.${encodeURIComponent(coverKey(book))}&select=id&limit=1`);
  if (!w.ok || !w.data[0]) return [];
  const r = await rest<{ image_url: string }[]>(`catalog_cover_candidates?work_id=eq.${w.data[0].id}&status=eq.rejected&select=image_url`);
  return r.ok ? r.data.map(x => x.image_url) : [];
}
