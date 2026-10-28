/**
 * Rules for FILLING the shared catalog from what the providers said (Phase 1). Pure: no network, no storage (catalog.ts does the reads and writes).
 *
 *  - Fill only: a value that is already in the catalog is never changed or removed. Lists only grow (case-insensitive, existing spelling kept).
 *  - Genre, honor (award / book-club pick), tag and "derived" labels are kept apart: a shelf name such as "Reese's Book Club" is an honor, never a genre.
 *  - "New release" is never stored: newReleaseStatus() derives it from edition publication dates (see its comment).
 *  - Nothing here merges books or people. Anything unclear stays unmapped and is kept as an unpublished candidate by the caller.
 */

export type LabelKind = 'genre' | 'honor' | 'tag' | 'derived' | 'unmapped';
export interface ClassifiedLabel { kind: LabelKind; value: string; original: string }

/** The genre names GreatReads shows (spelling and case as in the app). Lower-case provider spellings map onto these. */
const GENRE_ALIASES: Record<string, string> = {
  'fiction': 'Fiction', 'non-fiction': 'Non-fiction', 'nonfiction': 'Non-fiction', 'non fiction': 'Non-fiction',
  'mystery': 'Mystery', 'mysteries': 'Mystery', 'thriller': 'Thriller', 'thrillers': 'Thriller', 'suspense': 'Thriller',
  'fantasy': 'Fantasy', 'romance': 'Romance', 'memoir': 'Memoir', 'memoirs': 'Memoir', 'biography': 'Biography', 'biographies': 'Biography',
  'horror': 'Horror', 'historical fiction': 'Historical fiction', 'science fiction': 'Science fiction', 'sci-fi': 'Science fiction', 'sci fi': 'Science fiction',
  'business & economics': 'Business', 'cooking methods': 'Cookbooks', // owner-approved 2026-10-27
  'biography & autobiography': 'Biography', // Google's own category name (seen in the catalog's stored candidates)
  'classic': 'Classic', 'classics': 'Classic', 'self-help': 'Self-help', 'self help': 'Self-help', 'self-development': 'Self-help',
  'graphic novels': 'Graphic novels', 'graphic novel': 'Graphic novels', 'comics': 'Graphic novels', 'philosophy': 'Philosophy', 'science': 'Science',
  'young adult': 'Young adult', 'crime': 'Crime', 'true crime': 'True crime', 'humor': 'Humor', 'humour': 'Humor', 'cookbooks': 'Cookbooks', 'cookbook': 'Cookbooks',
  'contemporary': 'Contemporary', 'literary fiction': 'Literary fiction', 'poetry': 'Poetry', 'history': 'History', 'psychology': 'Psychology', 'business': 'Business', 'travel': 'Travel',
};

/**
 * Apple's own category names that hold more than one genre. These spellings are from memory of Apple Books' category list and are NOT verified
 * against live data: a name that is not here is simply left unmapped (kept as a candidate), never guessed.
 */
const APPLE_MULTI: Record<string, string[]> = {
  'fiction & literature': ['Fiction'], 'mysteries & thrillers': ['Mystery', 'Thriller'], 'science fiction & fantasy': ['Science fiction', 'Fantasy'],
  'biographies & memoirs': ['Biography', 'Memoir'], 'comics & graphic novels': ['Graphic novels'],
};

/** Google category paths seen in the catalog's stored candidates where the second part says what KIND of fiction it is. Anything not listed here stays unmapped. */
const COMPOSITE: Record<string, string[]> = { 'fiction / historical': ['Fiction', 'Historical fiction'], 'fiction / literary': ['Fiction', 'Literary fiction'], 'fiction / romcom': ['Fiction', 'Romance'] };

const DERIVED = /^new releases?$/i; // time-limited: derived from dates instead (newReleaseStatus)
const TAG = /^(readers?'?\s+favou?rites?|staff\s+picks?)$/i;
const HONOR = /\b(prize|award|medal|shortlist(ed)?|longlist(ed)?|finalist|nominee)\b|book club|inklings/i;

const clean = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();
export const labelKey = (s: string): string => clean(s).toLowerCase();

/** One provider label can mean several things ("Mysteries & Thrillers" = two genres; "Fiction / Fantasy" = two). Returns every part, classified. */
export function classifyLabel(raw: unknown): ClassifiedLabel[] {
  const original = clean(raw);
  if (!original || /^(book|books|general|n\/a)$/i.test(original)) return [];
  if (DERIVED.test(original)) return [{ kind: 'derived', value: original, original }];
  if (TAG.test(original)) return [{ kind: 'tag', value: original, original }];
  if (HONOR.test(original)) return [{ kind: 'honor', value: original, original }];
  const multi = APPLE_MULTI[labelKey(original)] || COMPOSITE[labelKey(original)];
  if (multi) return multi.map(value => ({ kind: 'genre' as const, value, original }));
  const parts = original.split(/\s*[\/,;]\s*/).map(clean).filter(Boolean);
  return parts.map(p => {
    const g = GENRE_ALIASES[labelKey(p)];
    return g ? { kind: 'genre' as const, value: g, original } : { kind: 'unmapped' as const, value: p, original };
  });
}

/** A prize, club pick, tag or time-limited label ("Prize winner", "Reese's Book Club", "New release"): never a genre. */
export const isShelfOrHonorLabel = (raw: unknown): boolean => classifyLabel(raw).some(c => c.kind === 'honor' || c.kind === 'tag' || c.kind === 'derived');
/** The label when it may be a genre, otherwise '' (so a shelf or honor name can never become book.genre or a genre candidate). */
export const genreOrEmpty = (raw: unknown): string => { const t = clean(raw); return t && !isShelfOrHonorLabel(t) ? t : ''; };

/** Append-only union: existing entries stay (order and spelling), new ones are added when not there ignoring case. Returns undefined when nothing was added. */
export function unionKeep(existing: readonly string[] | null | undefined, incoming: readonly string[]): string[] | undefined {
  const have = [...(existing || [])];
  const seen = new Set(have.map(labelKey));
  let added = false;
  for (const raw of incoming) {
    const v = clean(raw);
    if (!v || seen.has(labelKey(v))) continue;
    seen.add(labelKey(v)); have.push(v); added = true;
  }
  return added ? have : undefined;
}

export interface WorkFillInput { genres?: string[]; honors?: string[] }
export interface WorkFillRow { genres?: string[] | null; honors?: string[] | null }
/** What to add to catalog_works. Only fields that actually grow are in the patch; an empty patch means "write nothing". */
export function planWorkFill(existing: WorkFillRow | null | undefined, incoming: WorkFillInput): { genres?: string[]; honors?: string[] } {
  const patch: { genres?: string[]; honors?: string[] } = {};
  const g = unionKeep(existing?.genres, incoming.genres || []);
  const h = unionKeep(existing?.honors, incoming.honors || []);
  if (g) patch.genres = g;
  if (h) patch.honors = h;
  return patch;
}

export interface Classified { genres: string[]; honors: string[]; tags: string[]; unmapped: string[]; derived: string[] }
/** Sort a set of provider labels into the five groups (each de-duplicated, first spelling kept). */
export function classifyAll(labels: readonly unknown[], maxGenres = 5): Classified {
  const out: Classified = { genres: [], honors: [], tags: [], unmapped: [], derived: [] };
  const push = (list: string[], v: string) => void (list.some(x => labelKey(x) === labelKey(v)) || list.push(v));
  for (const l of labels) for (const c of classifyLabel(l)) {
    if (c.kind === 'genre') push(out.genres, c.value);
    else if (c.kind === 'honor') push(out.honors, c.value);
    else if (c.kind === 'tag') push(out.tags, c.value);
    else if (c.kind === 'derived') push(out.derived, c.value);
    else push(out.unmapped, c.value);
  }
  out.genres = out.genres.slice(0, maxGenres);
  return out;
}

/* ---------- dates ---------- */

export type DatePrecision = 'day' | 'month' | 'year' | 'none';
export interface ParsedDate { text: string; year?: number; precision: DatePrecision }
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const p2 = (n: number) => String(n).padStart(2, '0');

/**
 * Publication dates arrive as "2021", "2021-03", "2021-03-03", "2021-03-03T08:00:00Z" (Apple) or "March 3, 2021" (Open Library).
 * Returns the normalised text (YYYY, YYYY-MM or YYYY-MM-DD: never more precise than the source said) and the year. Impossible dates give precision 'none'.
 */
export function parsePublicationDate(raw: unknown, now: Date = new Date()): ParsedDate {
  const s = clean(raw);
  const none: ParsedDate = { text: '', precision: 'none' };
  if (!s) return none;
  const maxYear = now.getUTCFullYear() + 3;
  const ok = (y: number) => y >= 1400 && y <= maxYear;
  const day = (y: number, m: number, d: number): ParsedDate => {
    if (!ok(y) || m < 1 || m > 12 || d < 1) return none;
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return d <= dim ? { text: `${y}-${p2(m)}-${p2(d)}`, year: y, precision: 'day' } : none;
  };
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (m) return day(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return ok(+m[1]) && +m[2] >= 1 && +m[2] <= 12 ? { text: `${m[1]}-${m[2]}`, year: +m[1], precision: 'month' } : none;
  m = s.match(/^(\d{4})$/);
  if (m) return ok(+m[1]) ? { text: m[1], year: +m[1], precision: 'year' } : none;
  m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) { const mi = MONTHS.findIndex(n => n.startsWith(m![1].toLowerCase().slice(0, 3)) && n.startsWith(m![1].toLowerCase())); return mi >= 0 ? day(+m[3], mi + 1, +m[2]) : none; }
  m = s.match(/^([A-Za-z]+)\.?\s+(\d{4})$/);
  if (m) { const mi = MONTHS.findIndex(n => n.startsWith(m![1].toLowerCase())); return mi >= 0 && ok(+m[2]) ? { text: `${m[2]}-${p2(mi + 1)}`, year: +m[2], precision: 'month' } : none; }
  return none;
}

/* ---------- new release (derived, never stored) ---------- */

export type ReleaseStatus = 'new' | 'upcoming' | 'no' | 'unknown';
export const NEW_RELEASE_DAYS = 90;

/**
 * The documented rule: a book is a New Release when its FIRST known edition date (the earliest full day-precision date) is today or up to 90 days ago.
 *  - 'upcoming': that date is still in the future (not a new release yet; the app can show it as "coming soon").
 *  - 'unknown': no edition has a full date (missing, year-only and month-only dates cannot prove "within 90 days"). Never treated as new.
 *  - 'no': older than 90 days.
 * The earliest date is used so a recent reprint of an old book is not a new release. Dates are compared as UTC days.
 */
export function newReleaseStatus(editionDates: ReadonlyArray<string | null | undefined>, now: Date = new Date(), windowDays = NEW_RELEASE_DAYS): ReleaseStatus {
  const days = editionDates.map(d => parsePublicationDate(d, now)).filter(p => p.precision === 'day').map(p => p.text).sort();
  if (!days.length) return 'unknown';
  const first = Date.parse(`${days[0]}T00:00:00Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (first > today) return 'upcoming';
  return (today - first) / 86400000 <= windowDays ? 'new' : 'no';
}
export const isNewRelease = (editionDates: ReadonlyArray<string | null | undefined>, now?: Date): boolean => newReleaseStatus(editionDates, now) === 'new';

/* ---------- editions ---------- */

export interface EditionFillRow {
  publisher: string | null; publication_date: string | null; publication_year: number | null; page_count: number | null; language_code: string | null; format: string | null;
}
export interface EditionFillInput { publisher?: string; publishedDate?: string; pages?: number; language?: string; format?: string }
export interface EditionFillPlan { patch: Partial<EditionFillRow>; conflicts: string[] }

/**
 * Fill only the EMPTY detail columns of one edition row. A filled column that disagrees with the provider is reported in `conflicts`
 * (the caller keeps the provider's value as an unpublished candidate) and is never overwritten.
 */
export function planEditionFill(row: EditionFillRow, incoming: EditionFillInput, now: Date = new Date()): EditionFillPlan {
  const patch: Partial<EditionFillRow> = {};
  const conflicts: string[] = [];
  const publisher = clean(incoming.publisher);
  if (publisher) { if (!row.publisher) patch.publisher = publisher; else if (labelKey(row.publisher) !== labelKey(publisher)) conflicts.push(`publisher: have "${row.publisher}", provider says "${publisher}"`); }
  const d = parsePublicationDate(incoming.publishedDate, now);
  if (d.precision !== 'none') {
    if (!row.publication_date) patch.publication_date = d.text;
    else if (row.publication_date !== d.text) conflicts.push(`publication_date: have ${row.publication_date}, provider says ${d.text}`);
    if (d.year) { if (row.publication_year == null) patch.publication_year = d.year; else if (row.publication_year !== d.year) conflicts.push(`publication_year: have ${row.publication_year}, provider says ${d.year}`); }
  }
  const pages = Number(incoming.pages);
  if (Number.isInteger(pages) && pages > 0 && pages < 10000) { if (row.page_count == null) patch.page_count = pages; else if (row.page_count !== pages) conflicts.push(`page_count: have ${row.page_count}, provider says ${pages}`); }
  const lang = clean(incoming.language).toLowerCase();
  if (/^[a-z]{2,3}$/.test(lang)) { if (!row.language_code) patch.language_code = lang; else if (row.language_code.toLowerCase() !== lang) conflicts.push(`language_code: have ${row.language_code}, provider says ${lang}`); }
  const format = clean(incoming.format);
  if (format && !row.format) patch.format = format;
  return { patch, conflicts };
}
