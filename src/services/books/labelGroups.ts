/**
 * Book Information "Genres & tags": every genre / category / subject / tag label the providers gave this book, grouped under Genres, Subgenres, Subjects & themes, Collections and Keywords & tags,
 * each chip with the providers that said it. Pure (no network): the vocabulary (term kinds + aliases) is passed in; without it the labels still show, under Tags.
 * The mapping reuses `mapLabelsToTerms` (the same one capture saves to `catalog_work_terms`), so what the owner sees is what the database holds.
 */
import type { ProviderFacts } from './providerFacts';
import { mapLabelsToTerms, type Vocab } from '../catalogTerms';
import { awardFromLabel } from './awardLabels';

export type LabelGroupName = 'Genres' | 'Subgenres' | 'Subjects & themes' | 'Collections' | 'Keywords & tags';
/** `published`: readers see it (the book's own genre, or an approved row in the catalog). Everything else the providers suggested is a candidate only the owner can see. */
export interface LabelChip { label: string; sources: string[]; published: boolean; /** the book's main genre: the one used on shelves */ main?: boolean }
export interface LabelGroup { name: LabelGroupName; chips: LabelChip[] }

export const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
export const KIND_GROUP: Record<string, LabelGroupName> = { genre: 'Genres', subgenre: 'Subgenres', subject: 'Subjects & themes', collection: 'Collections' };
const ORDER: LabelGroupName[] = ['Genres', 'Subgenres', 'Subjects & themes', 'Collections', 'Keywords & tags'];

/** The awards the providers name ("Hugo Award winner" -> Hugo Award), once each, with who said it. They are shown under Awards & honors, never as tags. */
export function providerAwards(facts: readonly ProviderFacts[], stored: readonly { label: string; source: string; published?: boolean }[] = [], rejected: ReadonlySet<string> = new Set()): LabelChip[] {
  const out = new Map<string, LabelChip>();
  for (const x of stored) { const k = `s|${norm(x.label)}`; const chip = out.get(k) || { label: x.label, sources: [], published: false }; if (x.published) chip.published = true; if (!chip.sources.includes(x.source)) chip.sources.push(x.source); out.set(k, chip); }
  for (const f of facts) for (const raw of [...(f.genres || []), ...(f.subjects || [])]) {
    const a = awardFromLabel(raw); if (!a) continue;
    const key = `${a.slug}|${a.year || ""}`; const chip = out.get(key) || { label: a.year ? `${a.name} ${a.year}` : a.name, sources: [], published: false };
    if (!chip.sources.includes(f.provider)) chip.sources.push(f.provider); out.set(key, chip);
  }
  return [...out.values()].filter(c => !rejected.has(norm(c.label)));
}

/** What the database already holds for the book (catalog_work_labels / catalog_work_terms), read by `storedClassification`. */
export interface StoredLabel { group: LabelGroupName; label: string; source: string; published?: boolean }

/** `rejected`: labels the owner rejected for this book (normalized with `norm`); they never come back from the providers' live data. */
export function labelGroups(workGenres: readonly string[], facts: readonly ProviderFacts[], vocab: Vocab | null, stored: readonly StoredLabel[] = [], rejected: ReadonlySet<string> = new Set()): LabelGroup[] {
  const groups = new Map<LabelGroupName, Map<string, LabelChip>>(ORDER.map(n => [n, new Map()]));
  const put = (g: LabelGroupName, label: string, source: string, published = false) => {
    const text = label.replace(/\s+/g, ' ').trim();
    if (!text || text.length > 80) return;
    const m = groups.get(g)!; const k = norm(text);
    if (rejected.has(k)) return;
    const chip = m.get(k) || { label: text, sources: [], published: false }; if (published) chip.published = true; if (!chip.sources.includes(source)) chip.sources.push(source); m.set(k, chip);
  };
  workGenres.forEach((g, i) => { put('Genres', g, 'app', true); if (i === 0) { const c = groups.get('Genres')!.get(norm(g.replace(/\s+/g, ' ').trim())); if (c) c.main = true; } }); // the first is the book's own (shelf) genre
  for (const x of stored) if (!awardFromLabel(x.label)) put(x.group, x.label, x.source, !!x.published);
  const placed = new Set<string>(); // `provider|label` already put under a term
  for (const f of facts) {
    const isAward = (x: string) => !!awardFromLabel(x);
    const labels = [...(f.genres || []), ...(f.subjects || [])].filter(x => !isAward(x));
    if (vocab) {
      for (const c of mapLabelsToTerms(f.provider, labels, workGenres, vocab)) {
        const term = vocab.terms.find(t => t.id === c.term_id);
        if (!term) continue;
        if (!rejected.has(norm(c.raw_label))) put(KIND_GROUP[term.kind] || 'Keywords & tags', term.name, f.provider);
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

/** What a viewer sees: readers (and the owner by default) get only published chips; the owner can switch the rest on. `hidden` = how many chips are held back. Pure. */
export function visibleGroups(groups: readonly LabelGroup[], showUnpublished: boolean): { groups: LabelGroup[]; hidden: number } {
  let hidden = 0;
  const out = groups.map(g => { const chips = showUnpublished ? g.chips : g.chips.filter(c => c.published); hidden += g.chips.length - chips.length; return { ...g, chips }; }).filter(g => g.chips.length);
  return { groups: out, hidden };
}
export function visibleChips(chips: readonly LabelChip[], showUnpublished: boolean): { chips: LabelChip[]; hidden: number } {
  const keep = showUnpublished ? [...chips] : chips.filter(c => c.published);
  return { chips: keep, hidden: chips.length - keep.length };
}

/** Book-club picks and other lists (honors of kind "other pick") belong under Collections; prizes and shortlists stay under Awards & honors. Pure: merges them into the Collections group. */
export function withCollectionHonors(groups: readonly LabelGroup[], honors: readonly { type: string; label: string }[]): LabelGroup[] {
  const picks = honors.filter(h => h.type === 'c' && h.label.trim());
  if (!picks.length) return [...groups];
  const have = groups.find(g => g.name === 'Collections');
  const chips = new Map<string, LabelChip>((have?.chips || []).map(c => [norm(c.label), c]));
  for (const h of picks) { const k = norm(h.label); const cur = chips.get(k); if (cur) { cur.published = true; if (!cur.sources.includes('app')) cur.sources.push('app'); } else chips.set(k, { label: h.label.trim(), sources: ['app'], published: true }); }
  const merged: LabelGroup = { name: 'Collections', chips: [...chips.values()] };
  const rest = groups.filter(g => g.name !== 'Collections');
  const order: LabelGroupName[] = ['Genres', 'Subgenres', 'Subjects & themes', 'Collections', 'Keywords & tags'];
  return [...rest, merged].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}
