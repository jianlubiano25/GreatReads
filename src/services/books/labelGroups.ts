/**
 * Book Information "Genres & tags": every genre / category / subject / tag label the providers gave this book, grouped under Genre, Sub-genre, Subjects and Tags,
 * each chip with the providers that said it. Pure (no network): the vocabulary (term kinds + aliases) is passed in; without it the labels still show, under Tags.
 * The mapping reuses `mapLabelsToTerms` (the same one capture saves to `catalog_work_terms`), so what the owner sees is what the database holds.
 */
import type { ProviderFacts } from './providerFacts';
import { mapLabelsToTerms, type Vocab } from '../catalogTerms';

export type LabelGroupName = 'Genre' | 'Sub-genre' | 'Subjects' | 'Tags';
export interface LabelChip { label: string; sources: string[] }
export interface LabelGroup { name: LabelGroupName; chips: LabelChip[] }

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const KIND_GROUP: Record<string, LabelGroupName> = { genre: 'Genre', subgenre: 'Sub-genre', subject: 'Subjects', collection: 'Tags' };
const ORDER: LabelGroupName[] = ['Genre', 'Sub-genre', 'Subjects', 'Tags'];

export function labelGroups(workGenres: readonly string[], facts: readonly ProviderFacts[], vocab: Vocab | null): LabelGroup[] {
  const groups = new Map<LabelGroupName, Map<string, LabelChip>>(ORDER.map(n => [n, new Map()]));
  const put = (g: LabelGroupName, label: string, source: string) => {
    const text = label.replace(/\s+/g, ' ').trim();
    if (!text || text.length > 80) return;
    const m = groups.get(g)!; const k = norm(text);
    const chip = m.get(k) || { label: text, sources: [] }; if (!chip.sources.includes(source)) chip.sources.push(source); m.set(k, chip);
  };
  for (const g of workGenres) put('Genre', g, 'app');
  const placed = new Set<string>(); // `provider|label` already put under a term
  for (const f of facts) {
    const labels = [...(f.genres || []), ...(f.subjects || [])];
    if (vocab) {
      for (const c of mapLabelsToTerms(f.provider, labels, workGenres, vocab)) {
        const term = vocab.terms.find(t => t.id === c.term_id);
        if (!term) continue;
        put(KIND_GROUP[term.kind] || 'Tags', term.name, f.provider);
        placed.add(`${f.provider}|${norm(c.raw_label)}`);
      }
    }
    // Everything else the provider said stays visible, as its own words
    for (const raw of f.genres || []) if (!placed.has(`${f.provider}|${norm(raw)}`)) put('Tags', raw, f.provider);
    for (const raw of f.subjects || []) if (!placed.has(`${f.provider}|${norm(raw)}`)) put('Tags', raw, f.provider);
  }
  // A label already shown as a Genre/Sub-genre/Subject is not repeated under Tags
  const taken = new Set<string>(); for (const n of ['Genre', 'Sub-genre', 'Subjects'] as LabelGroupName[]) for (const k of groups.get(n)!.keys()) taken.add(k);
  for (const k of [...groups.get('Tags')!.keys()]) if (taken.has(k)) groups.get('Tags')!.delete(k);
  return ORDER.map(name => ({ name, chips: [...groups.get(name)!.values()].slice(0, name === 'Tags' ? 24 : 12) })).filter(g => g.chips.length);
}
