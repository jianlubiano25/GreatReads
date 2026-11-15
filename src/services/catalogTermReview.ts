/**
 * Review and show the vocabulary terms of one catalog work (`catalog_work_terms`).
 *  - Owner (Review catalog > Terms): every term a provider or the app suggested, grouped by term, approved or rejected with one tap (a status change; nothing is deleted).
 * Readers see approved terms through Book Information (`storedClassification` in catalog.ts); this file is the owner's side only.
 * `works.genres` / `honors` stay the read model of everything else; approving a term here never edits them.
 */
import { rest } from './supabase';

export type TermStatus = 'candidate' | 'approved' | 'rejected';
export interface TermRow { id: string; status: TermStatus; source: string; raw_label: string | null; term: { kind: string; name: string } | null }
export interface TermGroup { kind: string; name: string; ids: string[]; status: TermStatus; sources: string[]; labels: string[] }

/** One group per term: approved if any row is approved, else candidate if any is, else rejected. Approved first, then candidates; stable by kind and name. */
export function groupTerms(rows: readonly TermRow[]): TermGroup[] {
  const by = new Map<string, TermGroup>();
  for (const r of rows) {
    if (!r.term) continue;
    const k = `${r.term.kind}|${r.term.name}`;
    const g = by.get(k) || { kind: r.term.kind, name: r.term.name, ids: [], status: 'rejected' as TermStatus, sources: [], labels: [] };
    g.ids.push(r.id);
    if (r.status === 'approved' || (r.status === 'candidate' && g.status === 'rejected')) g.status = r.status;
    if (!g.sources.includes(r.source)) g.sources.push(r.source);
    if (r.raw_label && !g.labels.includes(r.raw_label)) g.labels.push(r.raw_label);
    by.set(k, g);
  }
  const rank = (s: TermStatus) => (s === 'approved' ? 0 : s === 'candidate' ? 1 : 2);
  return [...by.values()].sort((a, b) => rank(a.status) - rank(b.status) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

export async function loadTermRows(workId: string): Promise<{ ok: true; data: TermRow[] } | { ok: false; error: string }> {
  const r = await rest<TermRow[]>(`catalog_work_terms?work_id=eq.${workId}&select=id,status,source,raw_label,term:catalog_terms(kind,name)&order=created_at.asc&limit=500`);
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/** Approve or reject (or put back as candidate) every row of one term. */
export async function setTermsStatus(ids: readonly string[], status: TermStatus): Promise<{ ok: boolean; error?: string }> {
  if (!ids.length) return { ok: true };
  const r = await rest(`catalog_work_terms?id=in.(${ids.map(i => encodeURIComponent(i)).join(',')})`, { method: 'PATCH', body: { status } });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
