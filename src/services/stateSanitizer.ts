import type {
  Book,
  BookStatus,
  GardenState,
  HighlightItem,
  OwnedPlant,
  PlantPlacement,
  ReadingState,
  ShelfKey,
  UserProfile,
  WordItem,
} from '../types';
import { MILESTONE_BY_ID } from '../data/gardenCatalog';
import { BASE_GOAL_KEY, emptyGarden, seedGarden, todayKeyNow, type GoalHistory } from './garden';
import { DATE_KEY_RE } from './dates';

/**
 * Defensive normalisation for anything coming from localStorage or a pasted backup.
 * Several app versions (Claude v1, AI Studio v2, hand-edited JSON) have written
 * slightly different shapes, so every field is validated and repaired here
 * instead of trusting it. Nothing in here ever throws.
 */

const VALID_STATUS: BookStatus[] = ['list', 'next', 'now', 'done', 'skip'];
const VALID_THEME = ['auto', 'light', 'dark'];

const isObj = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : v == null ? fallback : String(v);

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const safeKeys = (o: Record<string, any>): string[] => Object.keys(o).filter(k => !UNSAFE_KEYS.has(k));

const httpsUrl = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const value = v.trim();
  if (/^https:\/\//i.test(value)) return value;
  if (/^\/\/[^/]/.test(value)) return `https:${value}`;
  return undefined;
};

const photoUrl = (v: unknown): string | undefined =>
  typeof v === 'string' && /^data:image\/(png|jpe?g|webp|gif);/i.test(v.trim()) ? v.trim() : httpsUrl(v);

const hexColor = (v: unknown): string | undefined =>
  typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : undefined;

const VALID_SHELVES: ShelfKey[] = ['heal', 'love', 'life', 'joy', 'prize', 'world', 'art', 'mine'];
const VALID_SOURCES = ['curated', 'openlibrary', 'google', 'manual'] as const;

export function sanitizeNumberRecord(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(raw)) return out;
  for (const k of safeKeys(raw)) {
    const n = num(raw[k]);
    if (n !== undefined) out[String(k)] = n;
  }
  return out;
}

/** Pages per day: only real "YYYY-MM-DD" keys, whole non-negative numbers (a bad value can never skew totals or streaks). */
export function sanitizeDailyLog(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(raw)) return out;
  for (const k of safeKeys(raw)) {
    const n = num(raw[k]);
    if (n !== undefined && DATE_KEY_RE.test(k)) out[k] = Math.max(0, Math.round(n));
  }
  return out;
}

export function sanitizeGoalHistory(raw: unknown): GoalHistory {
  const out: GoalHistory = {};
  if (!isObj(raw)) return out;
  for (const k of safeKeys(raw)) {
    const value = num(raw[k]);
    if (value !== undefined && (k === BASE_GOAL_KEY || DATE_KEY_RE.test(k))) {
      out[k] = Math.min(500, Math.max(1, Math.round(value)));
    }
  }
  return out;
}

export function sanitizeStatus(raw: unknown): Record<string, BookStatus> {
  const out: Record<string, BookStatus> = {};
  if (!isObj(raw)) return out;
  for (const k of safeKeys(raw)) {
    if (VALID_STATUS.includes(raw[k])) out[String(k)] = raw[k];
  }
  return out;
}

export function sanitizeBoolRecord(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!isObj(raw)) return out;
  for (const k of safeKeys(raw)) out[String(k)] = !!raw[k];
  return out;
}

export function sanitizeNotes(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(raw)) return out;
  for (const k of safeKeys(raw)) {
    if (typeof raw[k] === 'string') out[String(k)] = raw[k];
  }
  return out;
}

export function sanitizeHighlights(raw: unknown): Record<string, HighlightItem[]> {
  const out: Record<string, HighlightItem[]> = {};
  if (!isObj(raw)) return out;
  for (const key of safeKeys(raw)) {
    const list = Array.isArray(raw[key]) ? raw[key] : [];
    const items: HighlightItem[] = [];
    list.forEach((h: any, i: number) => {
      // v2 = { text }, Claude v1 = { t }
      const text = typeof h?.text === 'string' ? h.text : typeof h?.t === 'string' ? h.t : '';
      if (!text.trim()) return;
      const ts = num(h?.timestamp) ?? num(h?.ts) ?? Date.now() + i;
      items.push({
        id: h?.id != null ? String(h.id) : `hl_${key}_${ts}_${i}`,
        text,
        page: num(h?.page) ?? num(h?.pg),
        timestamp: ts,
      });
    });
    if (items.length) out[String(key)] = items;
  }
  return out;
}

export function sanitizeWords(raw: unknown): WordItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const seenIds = new Set<string>();
  const out: WordItem[] = [];
  raw.forEach((r: any, i: number) => {
    if (!isObj(r)) return;
    // v2 = { word }, Claude v1 = { w }
    const word = (typeof r.word === 'string' ? r.word : typeof r.w === 'string' ? r.w : '').trim();
    if (!word) return;
    const lower = word.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);

    const rawBook = r.bookId ?? r.book;
    const bookId = rawBook === undefined || rawBook === null || rawBook === '' ? undefined : String(rawBook);
    const addedAt = num(r.addedAt) ?? Date.now() - i;
    const strList = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;

    let id = r.id != null ? String(r.id) : String(addedAt);
    while (seenIds.has(id)) id = `${id}_${i}`;
    seenIds.add(id);

    out.push({
      id,
      word,
      phonetic: str(r.phonetic ?? r.ph),
      audioUrl: httpsUrl(r.audioUrl) ?? '',
      partOfSpeech: str(r.partOfSpeech ?? r.pos),
      definition: str(r.definition ?? r.def),
      definitions: strList(r.definitions),
      example: str(r.example ?? r.ex),
      etymology: typeof r.etymology === 'string' ? r.etymology : undefined,
      synonyms: strList(r.synonyms),
      bookId,
      bookTitle: typeof r.bookTitle === 'string' ? r.bookTitle : undefined,
      quoteSentence: str(r.quoteSentence ?? r.note),
      isLearned: !!(r.isLearned ?? r.ok),
      addedAt,
    });
  });
  return out;
}

/** Older versions filled in sentences like "X is an author published worldwide." when nothing was known. */
const GENERIC_BIO = /is an author published worldwide|is the author of this work|wrote this book\.?$|^No author info found\.?$/i;
const GENERIC_SUMMARY = /^(No summary found\.?|Imported book by .*\.|A book by .*\.)$/i;

export function sanitizeCustomBooks(raw: unknown): Book[] {
  if (!Array.isArray(raw)) return [];
  const out: Book[] = [];
  const seenIds = new Set<string>();
  for (const b of raw) {
    if (!isObj(b) || (typeof b.id !== 'string' && typeof b.id !== 'number') || b.id === '') continue;
    if (UNSAFE_KEYS.has(String(b.id))) continue;
    if (typeof b.title !== 'string' || !b.title.trim()) continue;
    if (seenIds.has(String(b.id))) continue;
    seenIds.add(String(b.id));
    let pageCount = num(b.pageCount) ?? 0;
    let year = str(b.year);
    let difficulty = num(b.difficulty) ?? 0;
    // Old versions invented "280 pages, 2024" for books added by hand or in bulk. Treat that pair as unknown.
    if (b.source === 'manual' && pageCount === 280 && year === '2024') { pageCount = 0; year = ''; difficulty = 0; }
    if (year === 'N/A') year = '';
    const bio = str(b.authorBio);
    const summary = str(b.summary);
    const rating = num(b.ratingAverage);
    out.push({
      id: b.id,
      title: b.title,
      author: str(b.author, 'Unknown author'),
      shelf: VALID_SHELVES.includes(b.shelf) ? b.shelf : 'mine',
      difficulty,
      notes: typeof b.notes === 'string' ? b.notes : undefined,
      first12Order: num(b.first12Order),
      isNew: typeof b.isNew === 'boolean' ? b.isNew : undefined,
      isOnDevice: !!b.isOnDevice,
      year,
      genre: str(b.genre, 'Book'),
      summary: GENERIC_SUMMARY.test(summary.trim()) ? '' : summary,
      authorBio: GENERIC_BIO.test(bio.trim()) ? '' : bio,
      pageCount,
      coverId: num(b.coverId),
      coverUrl: httpsUrl(b.coverUrl),
      ratingAverage: rating !== undefined && rating >= 0 && rating <= 5 ? rating : undefined,
      ratingCount: num(b.ratingCount),
      spineColor: hexColor(b.spineColor),
      source: (VALID_SOURCES as readonly string[]).includes(b.source) ? b.source : undefined,
      addedAt: num(b.addedAt),
      awardLabel: typeof b.awardLabel === 'string' ? b.awardLabel : undefined,
    });
  }
  return out;
}

export function sanitizeProfile(raw: unknown, fallback: UserProfile): UserProfile {
  if (!isObj(raw)) return fallback;
  return {
    name: typeof raw.name === 'string' ? raw.name : fallback.name,
    photo: typeof raw.photo === 'string' ? photoUrl(raw.photo) ?? '' : fallback.photo,
    theme: VALID_THEME.includes(raw.theme) ? raw.theme : fallback.theme,
  };
}

const nonNeg = (v: unknown): number => {
  const n = num(v);
  return n !== undefined && n > 0 ? n : 0;
};

/**
 * Repair a saved/backed-up garden. Returns null when there is no usable garden at all
 * (older saves and older backups), in which case the caller seeds one from reading history.
 * Unknown plant ids are kept (a plant you earned is never dropped just because the catalog changed).
 */
export function sanitizeGarden(raw: unknown): GardenState | null {
  if (!isObj(raw) || (!isObj(raw.plants) && !isObj(raw.achievements))) return null;
  const g = emptyGarden();

  if (isObj(raw.peaks)) {
    for (const k of Object.keys(g.peaks) as (keyof GardenState['peaks'])[]) g.peaks[k] = nonNeg(raw.peaks[k]);
  }

  if (isObj(raw.plants)) {
    for (const id of safeKeys(raw.plants)) {
      const p = raw.plants[id];
      if (!isObj(p)) continue;
      const owned: OwnedPlant = {
        milestoneId: str(p.milestoneId),
        earnedAt: nonNeg(p.earnedAt) || Date.now(),
        growth: Math.min(1, nonNeg(p.growth)),
      };
      const done = num(p.completedAt);
      if (done !== undefined && done > 0) owned.completedAt = done;
      g.plants[String(id)] = owned;
    }
  }

  if (isObj(raw.achievements)) {
    for (const id of safeKeys(raw.achievements)) {
      const a = raw.achievements[id];
      if (!isObj(a) || typeof a.plantId !== 'string' || !a.plantId || UNSAFE_KEYS.has(a.plantId)) continue;
      g.achievements[String(id)] = { earnedAt: nonNeg(a.earnedAt) || Date.now(), plantId: a.plantId };
    }
  }

  // Keep achievements and plants in step, so an interrupted/hand-edited save cannot lose either half.
  for (const [mid, a] of Object.entries(g.achievements)) {
    if (!g.plants[a.plantId]) g.plants[a.plantId] = { milestoneId: mid, earnedAt: a.earnedAt, growth: 0.2 };
  }
  for (const [pid, p] of Object.entries(g.plants)) {
    const m = MILESTONE_BY_ID[p.milestoneId];
    if (!p.milestoneId || (m && m.plantId !== pid)) {
      // unknown/mismatched milestone link: re-link by catalog if possible
      const owner = Object.values(MILESTONE_BY_ID).find(x => x.plantId === pid);
      if (owner) p.milestoneId = owner.id;
    }
    if (p.milestoneId && !g.achievements[p.milestoneId]) {
      g.achievements[p.milestoneId] = { earnedAt: p.earnedAt, plantId: pid };
    }
  }

  if (isObj(raw.placements)) {
    for (const id of safeKeys(raw.placements)) {
      const p = raw.placements[id];
      if (!isObj(p) || typeof p.areaId !== 'string' || !p.areaId || !g.plants[id]) continue;
      const placement: PlantPlacement = { areaId: p.areaId, slot: Math.floor(nonNeg(p.slot)) };
      g.placements[String(id)] = placement;
    }
  }

  if (isObj(raw.celebrated)) {
    for (const id of safeKeys(raw.celebrated)) if (raw.celebrated[id]) g.celebrated[String(id)] = true;
  } else {
    // No record of what was celebrated: treat everything already owned as seen so a restore never replays prompts.
    for (const id of Object.keys(g.plants)) g.celebrated[id] = true;
  }

  g.vine = Math.min(1, nonNeg(raw.vine));
  return g;
}

/** Garden for a state that arrived without one (fresh install, older save, older backup): built silently from history. */
function gardenFor(raw: unknown, s: Pick<ReadingState, 'dailyLog' | 'goal' | 'goalHistory' | 'status' | 'highlights' | 'words'>): GardenState {
  return sanitizeGarden(raw) ?? seedGarden({ dailyLog: s.dailyLog, goal: s.goal, goalHistory: s.goalHistory, status: s.status, todayKey: todayKeyNow(), highlights: s.highlights, words: s.words });
}

/** True when the object looks like the current (v2) app format rather than Claude's old short-key format. */
export function isV2Shape(o: Record<string, any>): boolean {
  return ['currentPage', 'totalPages', 'dailyLog', 'readingIntention', 'customBooks', 'onDeviceOverrides', 'hiddenBookIds']
    .some(k => k in o);
}

export function isLegacyShape(o: Record<string, any>): boolean {
  return ['st', 'pg', 'tot', 'log', 'hi', 'prof', 'intent', 'custom'].some(k => k in o);
}

/**
 * Build a complete, valid ReadingState from a parsed v2 object.
 * Any missing/invalid field falls back to `base`.
 */
export function normalizeV2(parsed: Record<string, any>, base: ReadingState): ReadingState {
  const has = (k: string) => k in parsed && parsed[k] != null;
  const goal = num(parsed.goal);
  const out: ReadingState = {
    status: has('status') ? sanitizeStatus(parsed.status) : base.status,
    currentPage: has('currentPage') ? sanitizeNumberRecord(parsed.currentPage) : base.currentPage,
    totalPages: has('totalPages') ? sanitizeNumberRecord(parsed.totalPages) : base.totalPages,
    dailyLog: has('dailyLog') ? sanitizeDailyLog(parsed.dailyLog) : base.dailyLog,
    notes: has('notes') ? sanitizeNotes(parsed.notes) : base.notes,
    highlights: has('highlights') ? sanitizeHighlights(parsed.highlights) : base.highlights,
    goal: goal && goal > 0 ? goal : base.goal,
    goalHistory: has('goalHistory') ? sanitizeGoalHistory(parsed.goalHistory) : base.goalHistory,
    readingIntention:
      typeof parsed.readingIntention === 'string' && parsed.readingIntention.trim()
        ? parsed.readingIntention
        : base.readingIntention,
    profile: sanitizeProfile(parsed.profile, base.profile),
    customBooks: has('customBooks') ? sanitizeCustomBooks(parsed.customBooks) : base.customBooks,
    onDeviceOverrides: has('onDeviceOverrides') ? sanitizeBoolRecord(parsed.onDeviceOverrides) : base.onDeviceOverrides,
    hiddenBookIds: has('hiddenBookIds') ? sanitizeBoolRecord(parsed.hiddenBookIds) : base.hiddenBookIds,
    words: has('words') ? sanitizeWords(parsed.words) : base.words,
    garden: base.garden,
  };
  // Saves and backups made before the garden existed have no `garden`: build it from their reading history.
  out.garden = gardenFor(parsed.garden, out);
  return out;
}

/** Convert Claude's old short-key format (st/pg/tot/log/hi/prof/...) and merge onto `base`. */
export function normalizeLegacy(p: Record<string, any>, base: ReadingState): ReadingState {
  const customRaw = Array.isArray(p.custom) ? p.custom : [];
  const customBooks = sanitizeCustomBooks(
    customRaw.map((c: any) => ({
      id: c?.id,
      title: c?.t,
      author: c?.a,
      shelf: 'mine',
      difficulty: 0,
      notes: c?.pg ? `${c.pg} pages · added by you` : 'Added by you',
      isOnDevice: !!c?.dev,
      year: c?.y || '',
      genre: c?.g || 'Book',
      summary: c?.sum || '',
      authorBio: c?.bio || '',
      pageCount: c?.pg || 0,
      coverId: c?.cv?.c || undefined,
      ratingAverage: c?.cv?.r || undefined,
      ratingCount: c?.cv?.n || undefined,
      spineColor: '#6b6f80',
      source: 'manual',
    })),
  );
  const words = sanitizeWords(p.words);
  const hi = sanitizeHighlights(p.hi);

  const merged: ReadingState = {
    ...base,
    status: isObj(p.st) ? { ...base.status, ...sanitizeStatus(p.st) } : base.status,
    currentPage: isObj(p.pg) ? { ...base.currentPage, ...sanitizeNumberRecord(p.pg) } : base.currentPage,
    totalPages: isObj(p.tot) ? { ...base.totalPages, ...sanitizeNumberRecord(p.tot) } : base.totalPages,
    dailyLog: isObj(p.log) ? { ...base.dailyLog, ...sanitizeDailyLog(p.log) } : base.dailyLog,
    notes: isObj(p.note) ? { ...base.notes, ...sanitizeNotes(p.note) } : base.notes,
    highlights: { ...base.highlights, ...hi },
    readingIntention: typeof p.intent === 'string' && p.intent.trim() ? p.intent : base.readingIntention,
    profile: isObj(p.prof) ? sanitizeProfile({ ...base.profile, ...p.prof }, base.profile) : base.profile,
    customBooks: customBooks.length > 0 ? customBooks : base.customBooks,
    hiddenBookIds: isObj(p.hidden) ? { ...base.hiddenBookIds, ...sanitizeBoolRecord(p.hidden) } : base.hiddenBookIds,
    words: words.length > 0 ? words : base.words,
  };
  merged.garden = gardenFor(p.garden, merged);
  return merged;
}

/**
 * Parse pasted backup text (tolerates smart quotes / wrapping quotes) and return
 * a repaired state, or null if it isn't usable.
 */
export function parseBackup(jsonStr: string, base: ReadingState): ReadingState | null {
  try {
    let clean = String(jsonStr ?? '').trim();
    if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith('\u201C') && clean.endsWith('\u201D'))) {
      clean = clean.slice(1, -1).trim();
    }
    clean = clean.replace(/[\u201C\u201D]/g, '"');
    const parsed = JSON.parse(clean);
    if (!isObj(parsed)) return null;

    // Check the current format FIRST: v2 backups also contain a "words" key,
    // which the old code mistook for Claude's legacy format.
    if (isV2Shape(parsed)) return normalizeV2(parsed, base);
    if (isLegacyShape(parsed)) return normalizeLegacy(parsed, base);
    // Bare v2-ish object (e.g. only status/words/notes/goal/profile)
    if (['status', 'words', 'notes', 'goal', 'profile', 'highlights'].some(k => k in parsed)) {
      return normalizeV2(parsed, base);
    }
    return null;
  } catch (e) {
    console.error('Failed to parse backup:', e);
    return null;
  }
}
