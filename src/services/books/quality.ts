/**
 * Content-quality screening for discovery shelves (Store, Trending). Keeps obviously explicit books from dominating
 * discovery. Plain romance and mainstream books pass untouched. Covers are not analysed (no image model on the device), so
 * sexualised covers are only caught through these metadata signals.
 */

export interface ContentFlags {
  subjects?: string[];
  description?: string;
  googleMaturity?: string; // Google Books "MATURE" / "NOT_MATURE"
  appleAdvisory?: string; // Apple's content advisory text, when present
}

const STRONG = /\b(erotic|erotica|erotics|bdsm|smut|smutty|porn|porno|pornographic|nsfw|hentai|xxx|sexually explicit)\b/i;
const MEDIUM = /\b(steamy|spicy romance|dark romance|reverse harem|why choose|sex scenes?|sexual content|mature content|kink|kinky|taboo romance|naughty)\b/gi;

export const EXPLICIT_FILTER_AT = 40; // at or above: left out of discovery shelves
export const EXPLICIT_PENALTY_AT = 18; // at or above: allowed, but ranked well down

/** 0 = nothing suspicious. */
export function explicitScore(title: string, f: ContentFlags = {}): number {
  let s = 0;
  const head = `${title} ${(f.subjects || []).join(' ')}`;
  const desc = f.description || '';
  if (STRONG.test(head)) s += 45;
  else if (STRONG.test(desc)) s += 30;
  const medium = new Set([...(head.match(MEDIUM) || []), ...(desc.match(MEDIUM) || [])].map(m => m.toLowerCase()));
  s += Math.min(36, medium.size * 12);
  if (/^mature$/i.test(f.googleMaturity || '')) s += 30;
  if (/explicit|adult|18\+/i.test(f.appleAdvisory || '')) s += 20;
  return s;
}

export const isExplicit = (title: string, f?: ContentFlags) => explicitScore(title, f) >= EXPLICIT_FILTER_AT;
export const isSuggestive = (title: string, f?: ContentFlags) => explicitScore(title, f) >= EXPLICIT_PENALTY_AT;
