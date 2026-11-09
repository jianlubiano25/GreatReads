/**
 * What a provider said that is NOT a metadata value, kept as unpublished candidates for the owner's review catalog (like a rating): its description text and its cover link.
 * Today only Hardcover supplies these (`ProviderFacts.description`, `extra.cover`); Apple / Google / Open Library never fill them, so nothing of theirs is stored here.
 * Everything is a `candidate` with the provider as source and its record id: never selected, never published, a duplicate (same source + record) is skipped. Owner only (the database refuses anyone else).
 */
import { rest } from './supabase';
import type { ProviderFacts } from './books/providerFacts';

const goodText = (t: unknown): t is string => typeof t === 'string' && t.trim().length >= 40 && t.length <= 20000;
const isHttps = (u: unknown): u is string => typeof u === 'string' && /^https:\/\/\S+$/.test(u) && u.length <= 1000;
const retryable = (r: { status: number }) => r.status === 0 || r.status === 429 || r.status >= 500;

/** The rows to store for these facts (pure): [table, body]. */
export function providerCandidateRows(workId: string, facts: ProviderFacts[]): { table: string; body: Record<string, unknown>; sameSource: string }[] {
  const rows: { table: string; body: Record<string, unknown>; sameSource: string }[] = [];
  for (const f of facts) {
    const src = { source_name: f.provider, source_record_id: f.recordId, ...(f.sourceUrl ? { source_url: f.sourceUrl } : {}) };
    if (goodText(f.description)) rows.push({ table: 'catalog_content_versions', sameSource: 'content_type=eq.book_description', body: { work_id: workId, content_type: 'book_description', language_code: 'en', content: f.description.trim(), status: 'candidate', ...src } });
    if (goodText(f.authorBio)) rows.push({ table: 'catalog_content_versions', sameSource: 'content_type=eq.author_bio', body: { work_id: workId, content_type: 'author_bio', language_code: 'en', content: f.authorBio.trim(), status: 'candidate', ...src } });
    const cover = f.extra?.cover;
    if (isHttps(cover)) rows.push({ table: 'catalog_cover_candidates', sameSource: `image_url=eq.${encodeURIComponent(cover)}`, body: { work_id: workId, image_url: cover, status: 'candidate', ...src } });
  }
  return rows;
}

export async function saveProviderCandidates(workId: string, facts: ProviderFacts[]): Promise<{ kept: number; skipped: string[]; retry: boolean }> {
  let kept = 0, retry = false;
  const skipped: string[] = [];
  for (const r of providerCandidateRows(workId, facts)) {
    const b = r.body;
    const have = await rest<{ id: string }[]>(`${r.table}?work_id=eq.${workId}&source_name=eq.${encodeURIComponent(String(b.source_name))}&source_record_id=eq.${encodeURIComponent(String(b.source_record_id))}&${r.sameSource}&select=id&limit=1`);
    if (!have.ok) { skipped.push(`${r.table}: ${have.error}`); if (retryable(have)) retry = true; continue; }
    if (have.data.length) continue; // already kept from this source
    const up = await rest(r.table, { method: 'POST', body: b });
    if (up.ok) kept++; else if (up.status !== 409) { skipped.push(`${r.table}: ${up.error}`); if (retryable(up)) retry = true; }
  }
  return { kept, skipped, retry };
}
