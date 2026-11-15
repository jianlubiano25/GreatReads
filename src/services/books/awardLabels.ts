/**
 * Award-style provider labels -> a named award, an optional year and a result ("Hugo Award winner", "Newbery Honor", "award:pulitzer_prize=1932", "National Book Awards longlist").
 * Pure; the same rule is used by Book Information (awards chips), capture (catalog_work_awards) and the SQL backfill (supabase/backfills/awards_from_labels.sql, kept in step with this file).
 * Generic lists (bestsellers, book clubs, "award winning books") are collections, not awards, and are not matched here.
 */
export interface AwardLabel { name: string; slug: string; year: number | null; result: 'won' | 'shortlisted' | 'nominated' }

const SMALL = new Set(['for', 'of', 'the', 'and', 'in', 'to', 'a']);
const titleCase = (s: string) => s.split(' ').map((w, i) => (i > 0 && SMALL.has(w) ? w : w.replace(/(^|[/(-])([a-zà-ÿ])/g, (_m, p, c) => p + c.toUpperCase()))).join(' ');
export const awardSlug = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function awardFromLabel(raw: string): AwardLabel | null {
  const n = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!n || n.length > 90) return null;
  const m = /^award:([a-z0-9_]+)(?:=(.*))?$/.exec(n); // Open Library's own "award:hugo_award=1966"
  if (m) {
    const name = titleCase(m[1].replace(/_/g, ' '));
    const year = /^\d{4}$/.test(m[2] || '') ? Number(m[2]) : null;
    return name.length > 2 ? { name, slug: awardSlug(name), year, result: 'won' } : null;
  }
  if (/^(award winning|devotional|carnegie,)/.test(n) || !/(\baward|\bprize|\bmedal|\bnewbery honor|\bhonor book)/.test(n)) return null;
  let result: AwardLabel['result'] = 'won';
  if (/\blonglist/.test(n)) result = 'nominated'; else if (/\bshortlist|\bhonor\b/.test(n)) result = 'shortlisted';
  let base = n;
  for (let i = 0; i < 3; i++) base = base.replace(/ (winners?|laureate|longlist|shortlist|books?)$/, '');
  if (base === 'nobel prize for literature laureate') base = 'nobel prize for literature';
  base = base.replace(/\bawards\b/, 'award');
  if (/^newbery (honor|medal)/.test(base)) base = base.replace(/^newbery honor.*/, 'newbery honor').replace(/^newbery medal.*/, 'newbery medal');
  const name = titleCase(base).replace(/’S\b/g, '’s');
  return name.length > 4 ? { name, slug: awardSlug(name), year: null, result } : null;
}
