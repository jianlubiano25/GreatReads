/**
 * Provider labels -> vocabulary terms, kept as CANDIDATES (`catalog_work_terms`, status candidate, with the provider, the raw label and the receipt it came from).
 * The meaning of a label lives in data (`catalog_term_aliases`, editable without a deploy), with the term names themselves as the fallback; an unknown label maps to nothing
 * here (it stays in the provider-label candidates). A parent genre is added only when the context agrees (the alias `requires_genre` is one of the work's genres). Never published, never replaces
 * a genre or honor on the work: `genres` / `honors` stay the read model. Owner only (the database refuses anyone else). All four providers go through the same function.
 */
import { rest } from './supabase';
import type { ProviderFacts } from './books/providerFacts';

export interface TermRow { id: string; kind: string; name: string; slug: string }
export interface AliasRow { source: string; label_norm: string; term_id: string; requires_genre: string | null; implies_genre: string | null }
export interface Vocab { terms: TermRow[]; aliases: AliasRow[] }
export interface TermCandidate { term_id: string; source: ProviderFacts['provider']; raw_label: string }

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const slugOf = (s: string) => norm(s).replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const KINDS = new Set(['genre', 'subgenre', 'subject']);

/** The terms one provider's labels mean for a work that has `workGenres` (pure). Several labels may give the same term once; the first label that does wins. */
export function mapLabelsToTerms(provider: ProviderFacts['provider'], labels: readonly string[], workGenres: readonly string[], vocab: Vocab): TermCandidate[] {
  // Google files books under paths ("Fiction / Dystopian"): each part is a label too, and the root counts as context for an alias that requires it
  const roots: string[] = [], all: string[] = [];
  for (const raw of labels) { const parts = raw.split(/\s*\/\s*/).filter(Boolean); if (parts.length > 1) { roots.push(norm(parts[0])); all.push(...parts); } all.push(raw); }
  const have = new Set([...workGenres.map(norm), ...roots]);
  const genreTerm = (name: string) => vocab.terms.find(t => t.kind === 'genre' && norm(t.name) === norm(name));
  const out = new Map<string, TermCandidate>();
  const add = (term_id: string | undefined, raw_label: string) => { if (term_id && !out.has(term_id)) out.set(term_id, { term_id, source: provider, raw_label }); };
  for (const raw of all) {
    const n = norm(raw);
    if (!n || n.length > 80) continue;
    const aliases = vocab.aliases.filter(a => a.label_norm === n && (a.source === 'any' || a.source === provider));
    if (aliases.length) {
      for (const a of aliases) {
        if (a.requires_genre && !have.has(norm(a.requires_genre))) continue; // the context does not agree: this alias does not apply
        add(a.term_id, raw);
        if (a.implies_genre) add(genreTerm(a.implies_genre)?.id, raw);
      }
      continue;
    }
    const direct = vocab.terms.find(t => KINDS.has(t.kind) && (norm(t.name) === n || t.slug === slugOf(n)));
    if (direct) add(direct.id, raw);
  }
  return [...out.values()];
}

let vocabMemo: Promise<Vocab | null> | undefined;
export const resetVocabForTests = () => { vocabMemo = undefined; };
async function loadVocab(): Promise<Vocab | null> {
  const t = await rest<TermRow[]>('catalog_terms?select=id,kind,name,slug&status=eq.active&limit=2000');
  const a = t.ok ? await rest<AliasRow[]>('catalog_term_aliases?select=source,label_norm,term_id,requires_genre,implies_genre&limit=2000') : t;
  return t.ok && a.ok ? { terms: t.data, aliases: a.data } : null;
}

/** Keep the candidates for these facts. `receiptIds` maps `provider:recordId` to its provider-record id (catalogReceipts). */
export async function saveTermCandidates(workId: string, facts: ProviderFacts[], workGenres: readonly string[], receiptIds: Map<string, string>): Promise<{ kept: number; skipped: string[]; retry: boolean }> {
  const skipped: string[] = [];
  if (!facts.length) return { kept: 0, skipped, retry: false };
  vocabMemo ??= loadVocab();
  const vocab = await vocabMemo;
  if (!vocab) { vocabMemo = undefined; return { kept: 0, skipped: ['terms: could not read the vocabulary'], retry: true }; } // asked again next time
  let kept = 0, retry = false;
  for (const f of facts) {
    for (const c of mapLabelsToTerms(f.provider, [...(f.genres || []), ...(f.subjects || [])], workGenres, vocab)) {
      const receipt = receiptIds.get(`${f.provider}:${f.recordId}`);
      const r = await rest('catalog_work_terms', { method: 'POST', body: { work_id: workId, term_id: c.term_id, source: c.source, status: 'candidate', raw_label: c.raw_label.slice(0, 120), ...(receipt ? { provider_record_id: receipt } : {}) } });
      if (r.ok) kept++; else if (r.status !== 409) { skipped.push(`terms: ${r.error}`); if (r.status === 0 || r.status === 429 || r.status >= 500) retry = true; } // 409 = this work already has this term from this source
    }
  }
  return { kept, skipped, retry };
}
