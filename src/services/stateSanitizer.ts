import type {
  Book,
  BookStatus,
  HighlightItem,
  ReadingState,
  UserProfile,
  WordItem,
} from '../types';

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

export function sanitizeNumberRecord(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(raw)) return out;
  for (const k of Object.keys(raw)) {
    const n = num(raw[k]);
    if (n !== undefined) out[String(k)] = n;
  }
  return out;
}

export function sanitizeStatus(raw: unknown): Record<string, BookStatus> {
  const out: Record<string, BookStatus> = {};
  if (!isObj(raw)) return out;
  for (const k of Object.keys(raw)) {
    if (VALID_STATUS.includes(raw[k])) out[String(k)] = raw[k];
  }
  return out;
}

export function sanitizeBoolRecord(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!isObj(raw)) return out;
  for (const k of Object.keys(raw)) out[String(k)] = !!raw[k];
  return out;
}

export function sanitizeNotes(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(raw)) return out;
  for (const k of Object.keys(raw)) {
    if (typeof raw[k] === 'string') out[String(k)] = raw[k];
  }
  return out;
}

export function sanitizeHighlights(raw: unknown): Record<string, HighlightItem[]> {
  const out: Record<string, HighlightItem[]> = {};
  if (!isObj(raw)) return out;
  for (const key of Object.keys(raw)) {
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

    out.push({
      id: r.id != null ? String(r.id) : String(addedAt),
      word,
      phonetic: str(r.phonetic ?? r.ph),
      audioUrl: str(r.audioUrl),
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
  for (const b of raw) {
    if (!isObj(b) || b.id == null || typeof b.title !== 'string' || !b.title.trim()) continue;
    let pageCount = num(b.pageCount) ?? 0;
    let year = str(b.year);
    let difficulty = num(b.difficulty) ?? 0;
    // Old versions invented "280 pages, 2024" for books added by hand or in bulk. Treat that pair as unknown.
    if (b.source === 'manual' && pageCount === 280 && year === '2024') { pageCount = 0; year = ''; difficulty = 0; }
    if (year === 'N/A') year = '';
    const bio = str(b.authorBio);
    const summary = str(b.summary);
    out.push({
      ...(b as any),
      id: b.id,
      title: b.title,
      author: str(b.author, 'Unknown author'),
      shelf: b.shelf || 'mine',
      difficulty,
      isOnDevice: !!b.isOnDevice,
      year,
      genre: str(b.genre, 'Book'),
      summary: GENERIC_SUMMARY.test(summary.trim()) ? '' : summary,
      authorBio: GENERIC_BIO.test(bio.trim()) ? '' : bio,
      pageCount,
    });
  }
  return out;
}

export function sanitizeProfile(raw: unknown, fallback: UserProfile): UserProfile {
  if (!isObj(raw)) return fallback;
  return {
    name: typeof raw.name === 'string' ? raw.name : fallback.name,
    photo: typeof raw.photo === 'string' ? raw.photo : fallback.photo,
    theme: VALID_THEME.includes(raw.theme) ? raw.theme : fallback.theme,
  };
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
  return {
    status: has('status') ? sanitizeStatus(parsed.status) : base.status,
    currentPage: has('currentPage') ? sanitizeNumberRecord(parsed.currentPage) : base.currentPage,
    totalPages: has('totalPages') ? sanitizeNumberRecord(parsed.totalPages) : base.totalPages,
    dailyLog: has('dailyLog') ? sanitizeNumberRecord(parsed.dailyLog) : base.dailyLog,
    notes: has('notes') ? sanitizeNotes(parsed.notes) : base.notes,
    highlights: has('highlights') ? sanitizeHighlights(parsed.highlights) : base.highlights,
    goal: goal && goal > 0 ? goal : base.goal,
    readingIntention:
      typeof parsed.readingIntention === 'string' && parsed.readingIntention.trim()
        ? parsed.readingIntention
        : base.readingIntention,
    profile: sanitizeProfile(parsed.profile, base.profile),
    customBooks: has('customBooks') ? sanitizeCustomBooks(parsed.customBooks) : base.customBooks,
    onDeviceOverrides: has('onDeviceOverrides') ? sanitizeBoolRecord(parsed.onDeviceOverrides) : base.onDeviceOverrides,
    hiddenBookIds: has('hiddenBookIds') ? sanitizeBoolRecord(parsed.hiddenBookIds) : base.hiddenBookIds,
    words: has('words') ? sanitizeWords(parsed.words) : base.words,
  };
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

  return {
    ...base,
    status: isObj(p.st) ? { ...base.status, ...sanitizeStatus(p.st) } : base.status,
    currentPage: isObj(p.pg) ? { ...base.currentPage, ...sanitizeNumberRecord(p.pg) } : base.currentPage,
    totalPages: isObj(p.tot) ? { ...base.totalPages, ...sanitizeNumberRecord(p.tot) } : base.totalPages,
    dailyLog: isObj(p.log) ? { ...base.dailyLog, ...sanitizeNumberRecord(p.log) } : base.dailyLog,
    notes: isObj(p.note) ? { ...base.notes, ...sanitizeNotes(p.note) } : base.notes,
    highlights: { ...base.highlights, ...hi },
    readingIntention: typeof p.intent === 'string' && p.intent.trim() ? p.intent : base.readingIntention,
    profile: isObj(p.prof) ? sanitizeProfile({ ...base.profile, ...p.prof }, base.profile) : base.profile,
    customBooks: customBooks.length > 0 ? customBooks : base.customBooks,
    hiddenBookIds: isObj(p.hidden) ? { ...base.hiddenBookIds, ...sanitizeBoolRecord(p.hidden) } : base.hiddenBookIds,
    words: words.length > 0 ? words : base.words,
  };
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
