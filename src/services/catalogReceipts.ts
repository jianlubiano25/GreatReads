/**
 * Provider receipts (Phase 2b): one row in catalog_provider_records per provider record (Apple listing, Google volume, Open Library work),
 * so what a provider said survives reloads and each metadata candidate can point at the receipt it came from.
 *
 * Owner only (the database refuses anyone else). Terms: docs/provider-terms.md. Everything here is stored as payload_policy 'trimmed':
 * the fields the app extracted plus ids and the store URL, never a full provider response (Google may not be kept in full; Open Library 'full' needs the raw record, which is not captured yet).
 * Idempotent and fill-only: a receipt is created once; an existing one is only given a missing work link, refreshed when its refresh date has passed,
 * or flagged needs_review when it points at a different work. It is never moved, overwritten with another work, or deleted. No personal tables.
 */
import { rest } from './supabase';
import type { FactProvider, ProviderFacts } from './books/providerFacts';

export const REFRESH_DAYS = 90;
export const receiptKind = (p: FactProvider): 'listing' | 'volume' | 'work' => (p === 'apple' ? 'listing' : p === 'google' ? 'volume' : 'work');
export const receiptKey = (f: Pick<ProviderFacts, 'provider' | 'recordId'>): string => `${f.provider}:${f.recordId}`;

/** The trimmed payload: only what the app extracted (no descriptions, no raw response). Lists are capped. */
export function receiptPayload(f: ProviderFacts): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (f.publisher) o.publisher = f.publisher;
  if (f.publishedDate) o.publishedDate = f.publishedDate;
  if (f.genres?.length) o.genres = f.genres.slice(0, 20);
  if (f.subjects?.length) o.subjects = f.subjects.slice(0, 40);
  if (f.language) o.language = f.language;
  if (f.authors?.length) o.authors = f.authors.slice(0, 10);
  if (f.altAuthorNames?.length) o.altAuthorNames = f.altAuthorNames.slice(0, 20);
  if (f.pages) o.pages = f.pages;
  return o;
}
/** Changes when what the provider said changes (not when it was merely seen again). */
export const receiptSignature = (f: ProviderFacts): string => JSON.stringify([receiptPayload(f), f.sourceUrl || '']);

const dayIso = (d: Date, plusDays: number) => new Date(d.getTime() + plusDays * 86400000).toISOString();
const validIso = (s: string | undefined, now: Date) => { const t = Date.parse(s || ''); return Number.isFinite(t) && t <= now.getTime() + 60_000 ? new Date(t).toISOString() : now.toISOString(); };

export function receiptRow(f: ProviderFacts, workId: string | null, now: Date = new Date()): Record<string, unknown> {
  const fetched = validIso(f.seenAt, now);
  return {
    provider: f.provider, provider_record_id: f.recordId, record_kind: receiptKind(f.provider),
    work_id: workId, payload_policy: 'trimmed', payload: receiptPayload(f),
    ...(f.sourceUrl && /^https:\/\/\S+$/i.test(f.sourceUrl) && f.sourceUrl.length <= 1000 ? { source_url: f.sourceUrl } : {}),
    fetched_at: fetched, refresh_after: dayIso(new Date(fetched), REFRESH_DAYS),
    match_status: workId ? 'matched' : 'unmatched', ...(workId ? { match_confidence: 1 } : {}),
  };
}

type Existing = { id: string; work_id: string | null; payload: unknown; refresh_after: string | null; match_status: string };
const retryable = (r: { status: number }) => r.status === 0 || r.status === 429 || r.status >= 500;

export async function saveProviderReceipts(workId: string, facts: ProviderFacts[], now: Date = new Date()): Promise<{ ids: Map<string, string>; created: number; skipped: string[]; retry: boolean }> {
  const ids = new Map<string, string>(), skipped: string[] = [];
  let created = 0, retry = false;
  const find = (f: ProviderFacts) => rest<Existing[]>(`catalog_provider_records?provider=eq.${f.provider}&record_kind=eq.${receiptKind(f.provider)}&provider_record_id=eq.${encodeURIComponent(f.recordId)}&select=id,work_id,payload,refresh_after,match_status&limit=1`);
  for (const f of facts) {
    const label = `${f.provider} ${f.recordId}`;
    let cur = await find(f);
    if (!cur.ok) { skipped.push(`receipt ${label}: ${cur.error}`); if (retryable(cur)) retry = true; continue; }
    let row: Existing | undefined = cur.data[0];
    if (!row) {
      const made = await rest<{ id: string }[]>('catalog_provider_records', { method: 'POST', body: receiptRow(f, workId, now), prefer: 'return=representation' });
      if (made.ok && made.data?.[0]?.id) { ids.set(receiptKey(f), made.data[0].id); created++; continue; }
      if (!made.ok && made.status === 409) { cur = await find(f); row = cur.ok ? cur.data[0] : undefined; } // another device wrote it first: treat as existing
      if (!row) { if (!made.ok) { skipped.push(`receipt ${label}: ${made.error}`); if (retryable(made)) retry = true; } continue; }
    }
    ids.set(receiptKey(f), row.id);
    let patch: Record<string, unknown> | undefined;
    if (!row.work_id) patch = { work_id: workId, match_status: 'matched', match_confidence: 1 };
    else if (row.work_id !== workId) {
      skipped.push(`receipt ${label} already belongs to another catalog book: not moved, flagged for review`);
      if (row.match_status !== 'needs_review') patch = { match_status: 'needs_review' };
    } else if (!row.payload || (row.refresh_after && Date.parse(row.refresh_after) <= now.getTime())) {
      const fresh = receiptRow(f, workId, now);
      patch = { payload: fresh.payload, fetched_at: fresh.fetched_at, refresh_after: fresh.refresh_after, ...(fresh.source_url ? { source_url: fresh.source_url } : {}) };
    }
    if (patch) { const up = await rest(`catalog_provider_records?id=eq.${row.id}`, { method: 'PATCH', body: patch }); if (!up.ok) { skipped.push(`receipt ${label}: ${up.error}`); if (retryable(up)) retry = true; } }
  }
  return { ids, created, skipped, retry };
}
