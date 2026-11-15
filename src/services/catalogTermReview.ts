/**
 * Review screen data (owner): everything the four providers and the app suggested to classify ONE book, in plain sections:
 * Genres, Subgenres, Subjects & themes, Collections (vocabulary terms, `catalog_work_terms`), Keywords & tags (provider labels with no vocabulary term, `catalog_work_labels`),
 * Awards & honors (`catalog_work_awards`). Approve / reject is a status change on those rows; nothing is deleted and `works.genres` / `honors` are never edited here.
 * Readers see only approved rows of published books (the database decides); Book Information reads them (`storedClassification` in catalog.ts).
 */
import { rest } from './supabase';

export type ClassStatus = 'candidate' | 'approved' | 'rejected';
export type ClassTable = 'catalog_work_terms' | 'catalog_work_labels' | 'catalog_work_awards';
export type Section = 'Genres' | 'Subgenres' | 'Subjects & themes' | 'Collections' | 'Keywords & tags' | 'Awards & honors';
export const SECTIONS: Section[] = ['Genres', 'Subgenres', 'Subjects & themes', 'Collections', 'Keywords & tags', 'Awards & honors'];

export interface TermRow { id: string; status: ClassStatus; source: string; raw_label: string | null; term: { kind: string; name: string } | null }
export interface LabelRow { id: string; status: ClassStatus; source: string; label: string; term_id: string | null }
export interface AwardRow { id: string; status: ClassStatus; source: string; raw_label: string | null; award_year: number | null; result: string; award: { name: string } | null }

export interface ClassItem { section: Section; name: string; table: ClassTable; ids: string[]; status: ClassStatus; sources: string[]; labels: string[] }

const SECTION_OF: Record<string, Section> = { genre: 'Genres', subgenre: 'Subgenres', subject: 'Subjects & themes', collection: 'Collections', keyword: 'Keywords & tags', tag: 'Keywords & tags' };
const rank = (s: ClassStatus) => (s === 'approved' ? 0 : s === 'candidate' ? 1 : 2);

/** One item per thing: its rows from every source are merged (approved if any row is approved, else candidate if any is, else rejected). Pure. */
export function toItems(terms: readonly TermRow[], labels: readonly LabelRow[], awards: readonly AwardRow[]): ClassItem[] {
  const by = new Map<string, ClassItem>();
  const add = (section: Section, name: string, table: ClassTable, id: string, status: ClassStatus, source: string, raw?: string | null) => {
    const k = `${table}|${section}|${name.toLowerCase()}`;
    const it = by.get(k) || { section, name, table, ids: [], status: 'rejected' as ClassStatus, sources: [], labels: [] };
    it.ids.push(id);
    if (status === 'approved' || (status === 'candidate' && it.status === 'rejected')) it.status = status;
    if (!it.sources.includes(source)) it.sources.push(source);
    if (raw && raw.toLowerCase() !== name.toLowerCase() && !it.labels.includes(raw)) it.labels.push(raw);
    by.set(k, it);
  };
  for (const t of terms) if (t.term) add(SECTION_OF[t.term.kind] || 'Keywords & tags', t.term.name, 'catalog_work_terms', t.id, t.status, t.source, t.raw_label);
  for (const l of labels) if (!l.term_id && l.label.trim()) add('Keywords & tags', l.label.trim(), 'catalog_work_labels', l.id, l.status, l.source); // a label with a term is reviewed as that term
  for (const a of awards) if (a.award) add('Awards & honors', `${a.award.name}${a.award_year ? ` ${a.award_year}` : ''}${a.result && a.result !== 'won' ? ` (${a.result})` : ''}`, 'catalog_work_awards', a.id, a.status, a.source, a.raw_label);
  return [...by.values()].sort((x, y) => SECTIONS.indexOf(x.section) - SECTIONS.indexOf(y.section) || rank(x.status) - rank(y.status) || x.name.localeCompare(y.name));
}

export async function loadClassification(workId: string): Promise<{ ok: true; data: ClassItem[] } | { ok: false; error: string }> {
  const [t, l, a] = await Promise.all([
    rest<TermRow[]>(`catalog_work_terms?work_id=eq.${workId}&select=id,status,source,raw_label,term:catalog_terms(kind,name)&order=created_at.asc&limit=500`),
    rest<LabelRow[]>(`catalog_work_labels?work_id=eq.${workId}&term_id=is.null&select=id,status,source,label,term_id&order=created_at.asc&limit=300`),
    rest<AwardRow[]>(`catalog_work_awards?work_id=eq.${workId}&select=id,status,source,raw_label,award_year,result,award:catalog_awards(name)&limit=100`),
  ]);
  if (!t.ok) return { ok: false, error: t.error };
  if (!l.ok) return { ok: false, error: l.error };
  if (!a.ok) return { ok: false, error: a.error };
  return { ok: true, data: toItems(t.data, l.data, a.data) };
}

/** Approve or reject (or put back as candidate) every row of one item. */
export async function setItemStatus(item: Pick<ClassItem, 'table' | 'ids'>, status: ClassStatus): Promise<{ ok: boolean; error?: string }> {
  if (!item.ids.length) return { ok: true };
  const r = await rest(`${item.table}?id=in.(${item.ids.map(i => encodeURIComponent(i)).join(',')})`, { method: 'PATCH', body: { status } });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
