/**
 * Book Information "Genres & tags": every genre / category / subject / tag label the providers gave this book, grouped under Genres, Subgenres, Subjects & themes, Collections and Keywords & tags,
 * each chip with the providers that said it. Pure (no network): the vocabulary (term kinds + aliases) is passed in; without it the labels still show, under Tags.
 * The mapping reuses `mapLabelsToTerms` (the same one capture saves to `catalog_work_terms`), so what the owner sees is what the database holds.
 */
import type { ProviderFacts } from './providerFacts';
import { mapLabelsToTerms, type Vocab } from '../catalogTerms';
import { awardFromLabel } from './awardLabels';

export type LabelGroupName = 'Genres' | 'Subgenres' | 'Subjects & themes' | 'Collections' | 'Keywords & tags';
export interface LabelChip { label: string; sources: string[] }
export interface LabelGroup { name: LabelGroupName; chips: LabelChip[] }

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
export const KIND_GROUP: Record<string, LabelGroupName> = { genre: 'Genres', subgenre: 'Subgenres', subject: 'Subjects & themes', collection: 'Collections' };
const ORDER: LabelGroupName[] = ['Genres', 'Subgenres', 'Subjects & themes', 'Collections', 'Keywords & tags'];

/** The awards the providers name ("Hugo Award winner" -> Hugo Award), once each, with who said it. They are shown under Awards & honors, never as tags. */
export function providerAwards(facts: readonly ProviderFacts[], stored: readonly { label: string; source: string }[] = []): LabelChip[] {
  const out = new Map<string, LabelChip>();
  for (const x of stored) { const k = `s|${norm(x.label)}`; const chip = out.get(k) || { label: x.label, sources: [] }; if (!chip.sources.includes(x.source)) chip.sources.push(x.source); out.set(k, chip); }
  for (const f of facts) for (const raw of [...(f.genres || []), ...(f.subjects || [])]) {
    const a = awardFromLabel(raw); if (!a) continue;
    const key = `${a.slug}|${a.year || ""}`; const chip = out.get(key) || { label: a.year ? `${a.name} ${a.year}` : a.name, sources: [] };
    if (!chip.sources.includes(f.provider)) chip.sources.push(f.provider); out.set(key, chip);
  }
  return [...out.values()];
}

/** What the database already holds for the book (catalog_work_labels / catalog_work_terms), read by `storedClassification`. */
export interface StoredLabel { group: LabelGroupName; label: string; source: string }

export function labelGroups(workGenres: readonly string[], facts: readonly ProviderFacts[], vocab: Vocab | null, stored: readonly StoredLabel[] = []): LabelGroup[] {
  const groups = new Map<LabelGroupName, Map<string, LabelChip>>(ORDER.map(n => [n, new Map()]));
  const put = (g: LabelGroupName, label: string, source: string) => {
    const text = label.replace(/\s+/g, ' ').trim();
    if (!text || text.length > 80) return;
    const m = groups.get(g)!; const k = norm(text);
    const chip = m.get(k) || { label: text, sources: [] }; if (!chip.sources.includes(source)) chip.sources.push(source); m.set(k, chip);
  };
  for (const g of workGenres) put('Genres', g, 'app');
  for (const x of stored) if (!awardFromLabel(x.label)) put(x.group, x.label, x.source);
  const placed = new Set<string>(); // `provider|label` already put under a term
  for (const f of facts) {
    const isAward = (x: string) => !!awardFromLabel(x);
    const labels = [...(f.genres || []), ...(f.subjects || [])].filter(x => !isAward(x));
    if (vocab) {
      for (const c of mapLabelsToTerms(f.provider, labels, workGenres, vocab)) {
        const term = vocab.terms.find(t => t.id === c.term_id);
        if (!term) continue;
        put(KIND_GROUP[term.kind] || 'Keywords & tags', term.name, f.provider);
        placed.add(`${f.provider}|${norm(c.raw_label)}`);
      }
    }
    // Everything else the provider said stays visible, as its own words
    for (const raw of (f.genres || []).filter(x => !isAward(x))) if (!placed.has(`${f.provider}|${norm(raw)}`)) put('Keywords & tags', raw, f.provider);
    for (const raw of (f.subjects || []).filter(x => !isAward(x))) if (!placed.has(`${f.provider}|${norm(raw)}`)) put('Keywords & tags', raw, f.provider);
  }
  // A label already shown as a Genre/Sub-genre/Subject is not repeated under Tags
  const taken = new Set<string>(); for (const n of ['Genres', 'Subgenres', 'Subjects & themes', 'Collections'] as LabelGroupName[]) for (const k of groups.get(n)!.keys()) taken.add(k);
  for (const k of [...groups.get('Keywords & tags')!.keys()]) if (taken.has(k)) groups.get('Keywords & tags')!.delete(k);
  return ORDER.map(name => ({ name, chips: [...groups.get(name)!.values()].slice(0, name === 'Keywords & tags' ? 24 : 12) })).filter(g => g.chips.length);
}
