import type { Book } from '../../types';
import { CURATED_SHELVES, type CuratedShelf } from '../../data/storeCatalog';
import { persistentCache } from '../books/cache';
import { dedupeInflight, getJson, getJsonDetailed, pool } from '../books/http';
import { authorKey, authorsCompatible, isUnknownAuthor, titleKey, titlesMatch } from '../books/identity';
import { shrunkRating } from '../books/model';
import { isBlocked } from '../books/quality';
import { searchOpenLibrary } from '../books/sources/openLibrary';
import type { Hit } from '../books/sources/types';
import { READER_CAPS, recencyValue } from './collate';
import { curatedSource } from './curated';
import type { RefreshResult, ShelfInfo, ShelfSource } from './shelves';
import { cleanAuthorName, cleanTitle, fetchWikiPicks, fetchWikitext, isSaneAuthor, parseWikiTables, splitPairedTitle, type ColumnRule } from './wikiLists';

/**
 * Curated shelves whose book list refreshes itself.
 *
 * A shelf keeps its hand-picked list (storeSeeds.json) as the floor. When a shelf has a DynamicSpec, the Store asks the spec's
 * source for a fresh list once the saved one is older than `refreshMs`, saves it, and shows it. Everything after that is the
 * existing pipeline: the fresh [title, author] pairs go through the same resolver (covers, ratings, identity, de-duplication)
 * and the same caches as any curated shelf.
 *
 * If a source fails, or answers with too few books, nothing changes: the last saved list stays on the shelf (however old),
 * and with none saved the hand-picked list does. A failed refresh is not retried for an hour.
 *
 * Nothing here ranks books and calls it official. Prize / club shelves are the published picks from a public record, labelled
 * by the source's own dates; genre shelves are "recent and widely read" from Open Library reader data, and say nothing more.
 */

type Seed = [string, string, string?];
export interface Fresh {
  seeds: Seed[];
  /** replaces the shelf title (e.g. "New in 2027") */
  title?: string;
  /** The club's / prize's own page answered (as opposed to a public-record stand-in). Only a spec that has both sets it. */
  official?: boolean;
}

export interface DynamicSpec {
  /** Where the list comes from (for the docs and the check script) */
  source: string;
  refreshMs: number;
  /** A fresh list shorter than this is rejected as a failed refresh */
  minSeeds: number;
  fetch: (shelf: CuratedShelf, signal?: AbortSignal) => Promise<Fresh | null>;
  /** The list's handle at its source (Wikipedia page name, club page...), shown in Customize Shelves */
  handle?: string;
  /** The heading, when it depends on the date */
  title?: (now: Date) => string;
  /** What kind of data this is, for Customize Store: a public record standing in for an official list, or GreatReads' own discovery */
  kind?: 'official' | 'fallback' | 'generated';
  /** For an 'official' spec that falls back to a public record: where that fallback reads from (shown when it was used) */
  fallbackSource?: string;
  /**
   * 'append': a refresh ADDS the newly published picks in front of what the shelf already has (book clubs and prizes keep
   * their history and grow). Default: the fresh list replaces the old one (discovery shelves, which show what is popular now).
   */
  merge?: 'append';
  /** With 'append': books the shelf already has keep their place and label; only new ones are added in front (a club's default list stays as it is) */
  keepExisting?: boolean;
  /** The most books an appending shelf keeps (the oldest fall off the end) */
  cap?: number;
  /** The shelf's order, applied to what is saved AND to what a refresh makes (a list saved in a wrong order is put right on screen at once, not only after a refresh) */
  order?: (seeds: Seed[]) => Seed[];
}

interface Saved { seeds: Seed[]; title?: string; /** the last refresh came from the official page (specs that have a fallback) */ official?: boolean; /** last SUCCESSFUL refresh */ at: number; /** last attempt, successful or not (only used to space retries) */ tried: number }

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
export const RETRY_MS = HOUR;
const store = persistentCache<Saved>('readlife.dynseeds1', { ttl: 400 * DAY, max: 30 });
/** How the last attempt to refresh each shelf ended (kept apart from the saved list, which only ever changes on success). */
const attempts = persistentCache<{ at: number; ok: boolean; /** why the last try failed, when the source said */ why?: string }>('readlife.dynstatus1', { ttl: 60 * DAY, max: 40 });

/**
 * One-time resets of a shelf's SAVED list on this device: the shelf goes back to its hand-picked list, and its next refresh adds the
 * new picks to that list again. For a saved list that picked up entries it should not have (an earlier version's wrong or garbled
 * ones: appending shelves never drop what they saved). Change the value to reset a shelf once more.
 */
export const SAVED_RESETS: Record<string, string> = {
  oprah: 'default-list-2', // back to Beloved, Song of Solomon, The Covenant of Water...; Oprah Daily's newer picks are added in front on the next refresh (Oprah Daily + Wikipedia 2.0)
  service95: 'full-archive-1', // the full archive from the club's own page; a pick saved with a sentence for an author is gone
};
const resetMarks = persistentCache<string>('readlife.dynreset1', { ttl: 800 * DAY, max: 20 });
export const forgetResetMarksForTests = () => Object.keys(SAVED_RESETS).forEach(id => resetMarks.delete(id));
function applyReset(id: string) {
  const want = SAVED_RESETS[id];
  if (!want || resetMarks.get(id) === want) return;
  store.delete(id);
  attempts.delete(id);
  resetMarks.set(id, want);
}

/**
 * Entries whose author is not a name (a sentence picked up from a page) cannot find their cover and do not belong on a shelf. The
 * hand-picked entry for the same book replaces it when there is one; otherwise it is dropped.
 */
export function repairSeeds(id: string, seeds: Seed[]): Seed[] {
  const bundled = CURATED_SHELVES.find(s => s.id === id)?.seeds ?? [];
  return seeds.flatMap((seed): Seed[] => {
    // A translated book saved with its original title after the English one ("Flights, Bieguni"): it is the hand-picked book
    if (typeof seed?.[0] === 'string' && typeof seed?.[1] === 'string') {
      const t = cleanTitle(seed[0]);
      const own = bundled.find(b => t.length > b[0].length && t.toLowerCase().startsWith(`${b[0].toLowerCase()}, `) && authorsCompatible(b[1], cleanAuthorName(seed[1])));
      if (own) return [seed[2] === undefined ? own : [own[0], own[1], seed[2]]];
    }
    // A prize pick that arrives under the book's ORIGINAL-language title ("De avond is ongemak") is the hand-picked book that holds the
    // same pick label (one winner per prize year) by the same author: the hand-picked English title is what the shelf shows
    if (typeof seed?.[0] === 'string' && typeof seed?.[1] === 'string' && typeof seed?.[2] === 'string') {
      const t = cleanTitle(seed[0]);
      const own = bundled.find(b => b[2] === seed[2] && authorsCompatible(b[1], cleanAuthorName(seed[1])) && !titlesMatch(b[0], t));
      if (own && !seeds.some(o => o !== seed && typeof o?.[0] === 'string' && o[2] === seed[2] && titlesMatch(o[0], own[0]) && authorsCompatible(o[1], own[1]))) return [[own[0], own[1], seed[2]]];
      if (own) return [];
    }
    if (typeof seed?.[0] !== 'string' || typeof seed?.[1] !== 'string' || isSaneAuthor(cleanAuthorName(seed[1]))) return [seed];
    const same = bundled.find(b => titleKey(b[0]) === titleKey(cleanTitle(seed[0])));
    return same ? [same] : [];
  });
}

const saved = {
  get(id: string): Saved | undefined {
    applyReset(id);
    const s = store.get(id);
    return s ? { ...s, seeds: cleanSeeds(repairSeeds(id, s.seeds)) } : undefined;
  },
  set(id: string, value: Saved) { applyReset(id); store.set(id, value); },
};

/* ------------------------------ the refresh engine ------------------------------ */

const WIKI_JUNK = /\b(?:first|last|dab|nolink|sort)\s*=|[{}|]/i;

/**
 * Remove unusable entries and repeats; keeps the source's order. Every saved list passes through here on the way out: club and prize
 * shelves only ever ADD to their saved list, so a name saved with a footnote mark, a "(US)" note or a template's "1=" would otherwise
 * stay on the shelf (and fail every cover search) for good. Cleaning at the door repairs lists saved by an earlier version.
 */
export function cleanSeeds(seeds: Seed[]): Seed[] {
  const seen = new Set<string>();
  const out: Seed[] = [];
  for (const seed of seeds) {
    if (!Array.isArray(seed) || typeof seed[0] !== 'string' || typeof seed[1] !== 'string') continue;
    const title = cleanTitle(seed[0]);
    const author = cleanAuthorName(seed[1]);
    if (!title || !author || isUnknownAuthor(author) || !isSaneAuthor(author)) continue;
    if (WIKI_JUNK.test(author) || WIKI_JUNK.test(title)) continue; // wiki markup that never became text ("last=Smith first=Ann")
    const k = `${titleKey(title)}|${authorKey(author)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(seed[2] === undefined ? [title, author] : [title, author, seed[2]]);
  }
  return out;
}

export const isDue = (s: Saved | undefined, spec: Pick<DynamicSpec, 'refreshMs'>, now = Date.now()) =>
  !s || (now - s.at >= spec.refreshMs && now - s.tried >= RETRY_MS);

const withSeeds = (shelf: CuratedShelf, s?: Saved): CuratedShelf => (s ? { ...shelf, seeds: cleanSeeds(s.seeds) } : shelf); // cleaned on the way out too: a bad entry saved by an older version goes without waiting for a refresh

/** At most two source requests at once across every shelf, so refreshing several shelves in a row cannot trip a rate limit. */
const politely = pool(2);
export const APPEND_CAP = 36;

/**
 * What an appending shelf becomes: the source's newest picks first, then everything the shelf already had.
 * `keepExisting`: a book the shelf already has stays exactly where it is, with its own label (the default list of a club shelf is
 * never reshuffled); only books the shelf does not have yet are added in front.
 */
export function mergeAppend(found: Seed[], existing: Seed[], cap = APPEND_CAP, keepExisting = false): Seed[] {
  // A pick the source dates again keeps its fresh label (first wins). A title is one pick: the same book saved earlier with its author
  // spelled differently (or wrongly) is replaced by the fresh one instead of showing twice.
  const have = new Set(cleanSeeds(existing).map(([t]) => titleKey(t)));
  const fresh = keepExisting ? cleanSeeds(found).filter(([t]) => !have.has(titleKey(t))) : found;
  const seen = new Set<string>();
  return cleanSeeds([...fresh, ...existing]).filter(([t]) => { const k = titleKey(t); return seen.has(k) ? false : (seen.add(k), true); }).slice(0, cap);
}

/** Ask the source for a fresh list and save it. Returns the saved list, or null when nothing better than before was found. */
export async function refreshShelf(shelf: CuratedShelf, spec: DynamicSpec, now = Date.now()): Promise<Saved | null> {
  const old = saved.get(shelf.id);
  let fresh: Fresh | null = null;
  let why: string | undefined;
  try { fresh = await politely(() => spec.fetch(shelf)); } catch (e) { why = e instanceof Error ? e.message : undefined; /* a source failing is routine */ }
  const found = fresh ? cleanSeeds(fresh.seeds) : [];
  if (found.length < spec.minSeeds) {
    attempts.set(shelf.id, { at: now, ok: false, why });
    const cur = saved.get(shelf.id); // read AGAIN: a refresh that finished while this one waited must not be overwritten by the older copy taken before the wait
    if (cur) saved.set(shelf.id, { ...cur, tried: now }); // keep the last good list; try again in an hour
    return null;
  }
  const cur = saved.get(shelf.id) ?? old;
  if (cur && cur.at > now) return cur; // a newer successful refresh is already saved: this slower, older answer must not replace it
  attempts.set(shelf.id, { at: now, ok: true });
  const order = spec.order ?? ((x: Seed[]) => x);
  const seeds = spec.merge === 'append'
    ? order(mergeAppend(found, order(cur?.seeds ?? shelf.seeds), spec.cap, spec.keepExisting))
    : found.slice(0, Math.max(shelf.seeds.length, 12));
  const next: Saved = { seeds, title: fresh?.title, official: fresh?.official, at: now, tried: now };
  saved.set(shelf.id, next);
  return next;
}

/** Words for a refresh interval: "every 3 days", "weekly", "monthly". */
export const everyLabel = (ms: number) => {
  const d = Math.round(ms / DAY);
  return d === 1 ? 'daily' : d === 7 ? 'weekly' : d === 30 ? 'monthly' : d > 1 ? `every ${d} days` : `every ${Math.max(1, Math.round(ms / HOUR))} hours`;
};

/** Customize Store's facts about a self-refreshing shelf. `updatedAt` is the last SUCCESSFUL refresh, never a failed try. */
export const dynamicInfo = (base: CuratedShelf, spec: DynamicSpec): ShelfInfo => {
  const s = saved.get(base.id);
  const viaFallback = spec.kind === 'official' && !!s && s.official !== true; // saved from the stand-in (or before this flag existed): only a refresh that the official page answered counts as official
  const kind = spec.kind === 'official' ? (viaFallback ? 'fallback' : 'official') : spec.kind ?? 'fallback';
  const source =
    kind === 'official' ? `${spec.source} · the club's own page (official)`
    : viaFallback ? `${spec.fallbackSource ?? 'a public record'} · public record, not the official list (the official page could not be read)`
    : spec.kind === 'generated' ? `${spec.source} · GreatReads discovery, not an official list`
    : `${spec.source} · public record, not the official list`;
  const last = attempts.get(base.id);
  const note = last && !last.ok && (!s || last.at > s.at) ? ` · last check failed (${last.why ?? 'source unreadable'}): showing the ${s ? 'saved' : 'hand-picked'} list` : '';
  return {
    updatedAt: s?.at,
    schedule: `Refreshes ${everyLabel(spec.refreshMs)}`,
    source: source + (spec.merge === 'append' ? ' · new picks are added to the top, earlier ones stay' : '') + note,
    kind,
    handle: spec.handle,
  };
};

const sameSeeds = (a: Seed[], b: Seed[]) => a.length === b.length && a.every((s, i) => s[0] === b[i][0] && s[1] === b[i][1] && s[2] === b[i][2]);
const refreshing = new Map<string, Promise<Saved | null>>();

/** A curated shelf that refreshes itself on schedule. Same shape as curatedSource, so the Store treats it like any shelf. */
export function dynamicCuratedSource(base: CuratedShelf, spec: DynamicSpec): ShelfSource {
  const ordered = (v?: Saved): Saved | undefined => (v && spec.order ? { ...v, seeds: spec.order(v.seeds) } : v);
  const current = () => withSeeds(base, ordered(saved.get(base.id)));
  const refresh = () => dedupeInflight(refreshing, base.id, () => refreshShelf(base, spec));
  let generation = 0; // a refreshed list replaces the old one on screen; late updates from the old list are ignored

  return {
    id: base.id,
    label: () => `${base.emoji} ${spec.title?.(new Date()) ?? saved.get(base.id)?.title ?? base.title}`,
    cached: () => curatedSource(current()).cached(),
    info: () => dynamicInfo(base, spec),
    // Manual refresh: the same engine as the schedule, just not waiting for it. A failure keeps the saved (or hand-picked) list.
    refresh: async (): Promise<RefreshResult> => {
      const before = saved.get(base.id);
      const fresh = await refresh();
      if (!fresh) return 'failed';
      return before && sameSeeds(fresh.seeds, before.seeds) ? 'unchanged' : 'updated';
    },
    load: async onUpdate => {
      const mine = ++generation;
      // Each list the shelf shows gets a version. A list's cover lookups can outlive it (a refresh arrives while they run), and
      // their late results must never replace the newer list on screen.
      let version = 0;
      const showFor = (v: number) => (b: Book[]) => { if (mine === generation && v === version) onUpdate(b); };
      const have = ordered(saved.get(base.id));

      if (!isDue(have, spec)) return curatedSource(withSeeds(base, have)).load(showFor(version));

      // A replacing shelf with nothing saved waits (briefly) for the source: its hand-picked list is not what it should show.
      // On failure the hand-picked list is the shelf.
      if (!have && spec.merge !== 'append') {
        const fresh = await refresh();
        return curatedSource(withSeeds(base, fresh ?? undefined)).load(showFor(version));
      }

      // Otherwise show what the shelf has right now and swap the refreshed list in when (and only if) it differs.
      // An appending shelf's current list is the floor it grows from, so it never has to wait.
      const before = have?.seeds ?? (spec.order ? spec.order(base.seeds) : base.seeds);
      void refresh().then(fresh => {
        if (!fresh || sameSeeds(fresh.seeds, before) || mine !== generation) return;
        const next = curatedSource(withSeeds(base, fresh));
        const v = ++version; // from here on only the new list may update the shelf
        const show = showFor(v);
        show(next.seeded());
        void next.load(show);
      });
      return curatedSource(withSeeds(base, have)).load(showFor(version));
    },
  };
}

/* ------------------------------ source: Wikipedia list articles ------------------------------ */

const wikiSpec = (pages: string[], rule: ColumnRule, label: (when: string) => string, refreshMs: number, source: string, limit = 12): DynamicSpec => ({
  source,
  handle: `wikipedia: ${pages[0]}`,
  kind: 'fallback',
  refreshMs,
  minSeeds: 8,
  fetch: async () => {
    const picks = await fetchWikiPicks(pages, rule);
    if (!picks) return null;
    const rows = picks.map(p => [p.title, p.author, label(p.when)] as Seed);
    return { seeds: rows.slice(0, limit) };
  },
});

/** A book club or prize: its published picks accumulate, so a refresh adds the newest ones in front of what the shelf has. */
const history = (spec: DynamicSpec): DynamicSpec => ({ ...spec, merge: 'append' });

/* ------------------------------ source: Service95's own Book Club page ------------------------------ */

/**
 * The club's own list, read by the /api/service95 function (the browser cannot read another site's pages). When that cannot be
 * read (no function in a local dev server, the site down, its layout changed), Wikipedia's list is used instead and the shelf says
 * so in Customize Store. Either way a failure changes nothing: the saved list stays.
 */
const serviceSpec = (): DynamicSpec => {
  const wiki = wikiSpec(
    ['Service95'],
    { title: /^(title|book)/i, author: /^(author|writer)/i, when: /(month|date|year|read|pick|selected)/i },
    when => `Service95 Monthly Read · ${when}`,
    7 * DAY,
    'Wikipedia: Service95 (the Book Club list)',
  );
  return {
    source: 'service95.com/book-club',
    handle: 'service95.com/book-club',
    kind: 'official',
    fallbackSource: wiki.source,
    refreshMs: 7 * DAY, // a new pick appears at the start of a month; weekly means it is on the shelf within days, not up to a month late
    minSeeds: 8,
    cap: 60, // the whole archive (about 40 monthly reads and counting) stays on the shelf
    fetch: async (shelf, signal) => {
      const j = await getJson('/api/service95', { timeout: 20000, signal });
      const seeds = (Array.isArray(j?.books) ? j.books : [])
        .filter((b: any) => b && typeof b.title === 'string' && b.title.trim() && typeof b.author === 'string' && b.author.trim() && typeof b.when === 'string')
        .map((b: any) => [b.title.trim(), b.author.trim(), `Service95 Monthly Read · ${b.when}`] as Seed);
      if (seeds.length >= 8) return { seeds, official: true };
      const fallback = await wiki.fetch(shelf, signal);
      return fallback && { ...fallback, official: false };
    },
  };
};

/* ------------------------------ source: Oprah Daily's list + Wikipedia's "Oprah's Book Club 2.0" ------------------------------ */

/** How many of Oprah Daily's newest picks one refresh looks at (the rest of the page is older than the shelf needs). */
const OPRAH_NEWEST = 18;
const OPRAH_WIKI_PAGES = ["Oprah's Book Club 2.0"]; // 2012 on: every pick since Wild
const OPRAH_WIKI_RULE: ColumnRule = { title: /^(title|book|selection)/i, author: /^author/i, when: /(date|month|year|selected|announced)/i, minRows: 1, minPicks: 1 };

/** Oprah Daily's newest picks as shelf entries (undated). Two books chosen at once become two covers, not one unfindable title. */
export function oprahNewest(official: { title: string; author: string }[], max = OPRAH_NEWEST): Seed[] {
  return official.slice(0, max).flatMap(p => splitPairedTitle(p.title).map(title => [title, p.author, "Oprah's Book Club"] as Seed));
}

/** The book without its subtitle, as one key ("Hidden Valley Road: Inside the Mind of..." is "Hidden Valley Road" on Wikipedia). */
const mainTitle = (t: string) => titleKey(t.split(/:\s/)[0]);

/**
 * Oprah's Book Club. Two sources, read together in ONE refresh; either one alone is enough:
 *  - Oprah Daily's own list (/api/oprah): the official record, the first to have a new pick, but with no dates. Its picks that
 *    Wikipedia does not have yet go on top, labelled "Oprah's Book Club".
 *  - Wikipedia's "Oprah's Book Club 2.0" table (2012 on): the picks with their dates ("Oprah's Book Club · Jun 2026"). It is also
 *    the stand-in when Oprah Daily cannot be read.
 * Either way only books the shelf does not have are added in front: the default list keeps its order and labels.
 */
export function oprahSeeds(official: { title: string; author: string }[], dated: Seed[]): Seed[] {
  const known = new Set(dated.map(s => mainTitle(s[0])));
  return [...oprahNewest(official).filter(s => !known.has(mainTitle(s[0]))), ...dated];
}

const oprahSpec = (): DynamicSpec => ({
  source: 'oprahdaily.com (the complete Oprah\'s Book Club list)',
  handle: 'oprahdaily.com + wikipedia: Oprah\'s Book Club 2.0',
  kind: 'official',
  fallbackSource: "Wikipedia: Oprah's Book Club 2.0 (the picks table)",
  refreshMs: 3 * DAY,
  minSeeds: 5,
  cap: 60,
  keepExisting: true,
  fetch: async (_shelf, signal) => {
    const [daily, wiki] = await Promise.all([
      getJsonDetailed('/api/oprah', { timeout: 20000, signal, retries: 1 }),
      fetchWikiPicks(OPRAH_WIKI_PAGES, OPRAH_WIKI_RULE, signal).catch(() => null),
    ]);
    const official = (Array.isArray(daily.data?.picks) ? daily.data.picks : []).filter((p: any) => p && typeof p.title === 'string' && typeof p.author === 'string');
    const dated = (wiki ?? []).slice(0, 12).flatMap(p => splitPairedTitle(p.title).map(title => [title, p.author, `Oprah's Book Club · ${p.when}`] as Seed));
    if (!official.length && !dated.length) throw new Error(`${oprahProblem(daily.status, daily.failure)}; Wikipedia's list could not be read either`);
    return { seeds: oprahSeeds(official, dated), official: official.length > 0 };
  },
});

/** Why /api/oprah gave nothing, in words for Customize Store (so a failing refresh says what to fix). */
const oprahProblem = (status: number, failure?: string) =>
  status === 404 || failure === 'not-json' ? 'the Oprah function is not running here: it only exists on the deployed site'
  : status === 502 ? 'Oprah Daily could not be read: the page blocked the request or its layout changed (run npm run check:oprah)'
  : failure === 'timeout' ? 'Oprah Daily took too long' : failure === 'network' ? 'no connection' : `Oprah Daily answered nothing usable (${status || failure || 'unknown'})`;

/* ------------------------------ source: Open Library discovery ------------------------------ */

const JUNK = /\b(box(ed)? set|collection|omnibus|study guide|summary of|summary &|workbook|analysis of|sparknotes|cliffsnotes|bundle|\d+ books?)\b/i;

/**
 * Pick a shelf from Open Library search hits. The hits arrive in the order OL's own reader-activity sort gave them; that order
 * is blended with how many readers rated each book (OL's own counts), how well, and how new it is. One book per author, covers
 * only, explicit books and study guides / box sets left out.
 */
export function rankDiscovery(hits: Hit[], o: { year: number; limit: number; minRatings?: number }): Seed[] {
  const now = new Date(o.year, 6, 1);
  const total = hits.length || 1;
  const rated = (h: Hit) => (h.book.ratingCount || 0) >= (o.minRatings ?? 3);
  let pool = hits.map((h, i) => ({ h, i })).filter(({ h }) => (h.book.coverId || h.book.coverUrl) && !isUnknownAuthor(h.book.author) && !JUNK.test(h.book.title) && !isBlocked(h.book.title, h.flags));
  if (pool.filter(({ h }) => rated(h)).length >= o.limit) pool = pool.filter(({ h }) => rated(h)); // otherwise a young list keeps its unrated books

  const scored = pool.map(({ h, i }) => {
    const b = h.book;
    const readers = Math.min(1, Math.log10((b.ratingCount || 0) + 1) / READER_CAPS.ol);
    const quality = b.ratingAverage ? Math.max(0, Math.min(1, (shrunkRating(b.ratingAverage, b.ratingCount) - 3.5) / 1.5)) : 0;
    return { b, score: (1 - i / total) * 45 + readers * 30 + quality * 15 + recencyValue(b.year, now) * 10 };
  });
  const authors = new Set<string>();
  const seeds: Seed[] = [];
  for (const { b } of scored.sort((x, y) => y.score - x.score)) {
    const a = authorKey(b.author);
    if (authors.has(a)) continue;
    authors.add(a);
    seeds.push([b.title, b.author]);
    if (seeds.length >= o.limit) break;
  }
  return seeds;
}

/** Hand-picked staples kept at the end of a discovery shelf, so a genre shelf still has its classics. */
const withStaples = (found: Seed[], base: CuratedShelf, keep: number, size = 12): Seed[] => {
  const staples = base.seeds.slice(0, keep);
  const head = cleanSeeds(found).filter(([t, a]) => !staples.some(s => titleKey(s[0]) === titleKey(t) && authorKey(s[1]) === authorKey(a)));
  return [...head.slice(0, size - staples.length), ...staples];
};

interface Discovery { query: (year: number) => string; keep?: number; yearsBack?: number }

const olSpec = (d: Discovery): DynamicSpec => ({
  source: 'Open Library search (reader activity, ratings), recent books',
  kind: 'generated',
  refreshMs: 30 * DAY,
  minSeeds: 8,
  fetch: async (base, signal) => {
    const year = new Date().getFullYear();
    const q = d.query(year);
    // A discovery search is heavy for Open Library (a subject + year range, sorted by readers): the default 6.5 s wait was too short and every
    // genre shelf said "Could not update". It waits up to 25 s, asks for 40 books (enough to rank 12), and falls back to the unsorted search.
    const slow = { retries: 1, timeout: 25000, signal };
    let hits = await searchOpenLibrary({ q, sort: 'want_to_read' }, 40, slow);
    if (!hits.length && !signal?.aborted) hits = await searchOpenLibrary({ q }, 40, slow);
    const keep = d.keep ?? 0;
    const found = rankDiscovery(hits, { year, limit: 12 - keep });
    return found.length ? { seeds: keep ? withStaples(found, base, keep) : found } : null;
  },
});

const recent = (years: number) => (y: number) => `language:eng AND first_publish_year:[${y - years} TO ${y}]`;
const genre = (subjects: string, keep = 4): DynamicSpec => olSpec({ query: y => `(${subjects}) AND ${recent(4)(y)}`, keep });

/* ------------------------------ source: the Inklings Book Club podcast feed ------------------------------ */

/**
 * Jack Edwards' Inklings Book Club has no list of its own; its podcast has one episode a month about the pick, titled "Author: Book".
 * /api/inklings (functions/api/inklings.js) reads the feed and keeps only the episodes that say they are the pick. New picks go in
 * front; the picks already on the shelf keep their place and label.
 */
const inklingsSpec = (): DynamicSpec => ({
  source: 'the Inklings Book Club podcast feed (feeds.megaphone.fm/inklings)',
  handle: 'feeds.megaphone.fm/inklings',
  kind: 'official',
  refreshMs: 7 * DAY,
  minSeeds: 5,
  cap: 60,
  keepExisting: true,
  fetch: async (_shelf, signal) => {
    const j = await getJson('/api/inklings', { timeout: 20000, signal });
    const seeds = (Array.isArray(j?.books) ? j.books : [])
      .filter((b: any) => b && typeof b.title === 'string' && b.title.trim() && typeof b.author === 'string' && b.author.trim() && typeof b.when === 'string')
      .map((b: any) => [b.title.trim(), b.author.trim(), `Inklings Pick · ${b.when}`] as Seed);
    return seeds.length >= 5 ? { seeds, official: true } : null;
  },
});

/* ------------------------------ source: Nobel laureates (Wikipedia) + their best-known book (Open Library) ------------------------------ */

/** The laureates in Wikipedia's table, newest first: [{ year, name }]. Columns are found by header ("Year", "Laureate"). */
export function nobelLaureates(tables: ReturnType<typeof parseWikiTables>): { year: number; name: string }[] {
  const out: { year: number; name: string }[] = [];
  for (const t of tables) {
    const iYear = t.headers.findIndex(h => /^year/i.test(h.trim()));
    // Wikipedia heads two columns "Laureate" (a picture, then the name): the name is the last one
    const iName = t.headers.map(h => /^laureate/i.test(h.trim())).lastIndexOf(true);
    if (iYear < 0 || iName < 0 || t.rows.length < 20) continue;
    for (const r of t.rows) {
      const year = Number((r[iYear] || '').match(/\b(19|20)\d{2}\b/)?.[0]);
      const name = cleanAuthorName((r[iName] || '').split('\u2063')[0]); // a shared year lists several laureates: the first
      if (year && name && isSaneAuthor(name)) out.push({ year, name });
    }
  }
  return out.sort((a, b) => b.year - a.year);
}

/** The year a Nobel seed's label ends with ("Nobel Prize in Literature 2024"), or NaN. */
const nobelYear = (s: Seed): number => Number(String(s[2] ?? '').match(/(\d{4})\s*$/)?.[1]);

/**
 * The laureates whose year the shelf does not have yet, NEWEST first, at most `limit`. The source's own order is not trusted (a list that
 * runs oldest to newest used to fill the shelf with the OLDEST missing winners); a year that is not here yet is never one from the future.
 */
export function nobelMissing(laureates: { year: number; name: string }[], have: Set<number>, thisYear: number, limit = 4): { year: number; name: string }[] {
  return laureates.filter(l => !have.has(l.year) && l.year <= thisYear).sort((a, b) => b.year - a.year).slice(0, limit);
}

/** The shelf order: latest year first, so a new year always lands at the front. Seeds without a year go after the dated ones; ties keep their order. */
export function nobelOrder(seeds: Seed[]): Seed[] {
  const y = (s: Seed) => { const n = nobelYear(s); return Number.isNaN(n) ? -Infinity : n; };
  return [...seeds].sort((a, b) => (y(a) === y(b) ? 0 : y(a) < y(b) ? 1 : -1));
}

/**
 * The Nobel shelf: one book per laureate. A year the shelf does not have yet is added in front: the laureate comes from Wikipedia's
 * table, the book is the laureate's most-wanted book on Open Library (GreatReads' choice: the Nobel names an author, not a book, so
 * this is said on the shelf's info). A year already on the shelf is never looked at again, so a book is not swapped later.
 */
const nobelSpec = (): DynamicSpec => ({
  source: 'nobelprize.org (the laureate; Wikipedia as backup) + Open Library (their most-wanted book, GreatReads\' choice)',
  handle: 'api.nobelprize.org/2.1/laureates?nobelPrizeCategory=lit (backup: wikipedia: List of Nobel laureates in Literature)',
  kind: 'fallback',
  refreshMs: 7 * DAY,
  minSeeds: 5,
  cap: 60,
  keepExisting: true,
  order: nobelOrder,
  fetch: async (shelf, signal) => {
    // The Nobel Foundation's own list first (up to date the day the prize is announced), Wikipedia's table (which lags) as the backup
    const official = await getJson('/api/nobel', { timeout: 20000, signal }).catch(() => null);
    let laureates: { year: number; name: string }[] = (Array.isArray(official?.laureates) ? official.laureates : [])
      .filter((l: any) => l && Number.isInteger(l.year) && typeof l.name === 'string' && isSaneAuthor(cleanAuthorName(l.name)))
      .map((l: any) => ({ year: l.year as number, name: cleanAuthorName(l.name) }));
    if (laureates.length < 20) {
      const text = await fetchWikitext('List of Nobel laureates in Literature', signal);
      laureates = text ? nobelLaureates(parseWikiTables(text)) : [];
    }
    if (laureates.length < 20) return null;
    const have = new Set([...shelf.seeds, ...(saved.get(shelf.id)?.seeds ?? [])].map(nobelYear));
    const todo = nobelMissing(laureates, have, new Date().getFullYear());
    const added: Seed[] = [];
    for (const l of todo) {
      const hits = await searchOpenLibrary({ q: `author:"${l.name}"` , sort: 'want_to_read' }, 20, { retries: 1 }).catch(() => [] as Hit[]);
      const pick = hits.find(h => (h.book.coverId || h.book.coverUrl) && authorsCompatible(h.book.author, l.name) && !JUNK.test(h.book.title) && !isBlocked(h.book.title, h.flags));
      if (pick) added.push([pick.book.title, l.name, `Nobel Prize in Literature ${l.year}`]);
    }
    return { seeds: nobelOrder([...added, ...shelf.seeds]) }; // the hand-picked list rides along so a week with nothing new is "unchanged", not a failure; latest year first
  },
});

/* ------------------------------ source: the newest Goodreads Choice Awards ------------------------------ */

/**
 * goodreads.com/award links each year's winners page; /api/goodreads-choice (functions/api/goodreads-choice.js) follows the newest one,
 * so once Goodreads publishes the 2026 winners the shelf becomes "Goodreads Choice Awards 2026" with the new winners (it REPLACES the
 * old year, it does not pile up). A page that cannot be read leaves the saved winners alone.
 */
const goodreadsSpec = (): DynamicSpec => ({
  source: 'goodreads.com/award (the newest Goodreads Choice Awards winners)',
  handle: 'goodreads.com/award → choiceawards/best-books-YYYY (newest year)',
  kind: 'official',
  refreshMs: 3 * DAY,
  minSeeds: 8,
  fetch: async (_shelf, signal) => {
    const j = await getJson('/api/goodreads-choice', { timeout: 25000, signal });
    const year = Number(j?.year);
    const seeds = (Array.isArray(j?.books) ? j.books : [])
      .filter((b: any) => b && typeof b.title === 'string' && b.title.trim() && typeof b.author === 'string' && b.author.trim() && typeof b.category === 'string')
      .map((b: any) => [b.title.trim(), b.author.trim(), `Goodreads Choice ${year} · ${b.category.trim()}`] as Seed);
    return Number.isInteger(year) && year > 2010 && seeds.length >= 8 ? { seeds, title: `Goodreads Choice Awards ${year}`, official: true } : null;
  },
});

/* ------------------------------ the registry ------------------------------ */

const prize = (): Pick<ColumnRule, 'title' | 'author' | 'when'> => ({ title: /^(title|novel|book|work|winning (book|work))/i, author: /^(author|writer|winner)/i, when: /^(year|date)/i });

export const DYNAMIC_SPECS: Record<string, DynamicSpec> = {
  // Newest books of the year, by reader interest. Heading follows the calendar year.
  new2026: { ...olSpec({ query: y => `language:eng AND first_publish_year:${y}` }), title: now => `New in ${now.getFullYear()}`, refreshMs: 7 * DAY },

  // Published picks, from Wikipedia's lists (see wikiLists.ts). The shelf's labels show each pick's own date.
  // Oprah Daily's own list for the newest picks, Wikipedia's 2.0 table for the dates (and as the fallback): see oprahSpec
  oprah: history(oprahSpec()),
  womens: history(wikiSpec(
    // Pages are tried in turn; one without a readable winners table is skipped. (The winners may live on a list page of their own.)
    ["Women's Prize for Fiction", "List of Women's Prize for Fiction winners"],
    { ...prize(), result: /^(result|status|outcome)/i, winner: /winner/i, onePerYear: true, firstTitleLine: true },
    when => `Women's Prize ${when}`,
    7 * DAY,
    "Wikipedia: Women's Prize for Fiction (winners)",
  )),
  intbooker: history(wikiSpec(
    ['International Booker Prize'],
    // the title cell reads "At Night All Blood Is Black" and, on the next line, the original "Frère d'âme": the English title is the pick
    { ...prize(), result: /^(result|status|outcome)/i, winner: /winner/i, onePerYear: true, firstTitleLine: true },
    when => `International Booker ${when}`,
    7 * DAY,
    'Wikipedia: International Booker Prize (winners)',
  )),

  // More prizes, same method: Wikipedia's winners tables (the winner is the first row of each year), new winners added on top.
  // A table that cannot be read leaves the saved list alone, so the worst case is today's behaviour.
  booker: history(wikiSpec(
    ['List of winners and shortlisted authors of the Booker Prize', 'Booker Prize'],
    { ...prize(), result: /^(result|status|outcome)/i, winner: /winner/i, onePerYear: true },
    when => `Booker Prize ${when}`,
    7 * DAY,
    'Wikipedia: Booker Prize (winners)',
  )),
  pulitzer: history(wikiSpec(
    ['Pulitzer Prize for Fiction'],
    { ...prize(), result: /^(result|status|outcome)/i, winner: /winner/i, onePerYear: true },
    when => `Pulitzer Prize ${when}`,
    7 * DAY,
    'Wikipedia: Pulitzer Prize for Fiction (winners)',
  )),
  nba: history(wikiSpec(
    ['National Book Award for Fiction'],
    { ...prize(), result: /^(result|status|outcome)/i, winner: /winner/i, onePerYear: true },
    when => `National Book Award ${when}`,
    7 * DAY,
    'Wikipedia: National Book Award for Fiction (winners)',
  )),
  hugo: history(wikiSpec(
    ['Hugo Award for Best Novel'],
    { ...prize(), result: /^(result|status|outcome)/i, winner: /winner/i, onePerYear: true },
    when => `Hugo Award ${when}`,
    7 * DAY,
    'Wikipedia: Hugo Award for Best Novel (winners)',
  )),
  nebula: history(wikiSpec(
    ['Nebula Award for Best Novel'],
    { ...prize(), result: /^(result|status|outcome)/i, winner: /winner/i, onePerYear: true },
    when => `Nebula Award ${when}`,
    7 * DAY,
    'Wikipedia: Nebula Award for Best Novel (winners)',
  )),

  // Goodreads Choice Awards: the newest year's winners, replacing the old year's (see goodreadsSpec)
  goodreadschoice: goodreadsSpec(),

  // The Nobel: laureate from nobelprize.org (Wikipedia as backup), their most-wanted book from Open Library (see nobelSpec)
  nobel: history(nobelSpec()),

  // Top Fiction / Top Non-fiction: recent, widely wanted books from Open Library reader data (GreatReads discovery, not a chart),
  // the shelf's first four hand-picked staples kept at the end. The NYT lists at the top of the Store are the official charts.
  topfiction: { ...genre('subject:fiction', 4), source: 'Open Library search (most-wanted recent fiction)', refreshMs: 14 * DAY },
  topnonfiction: { ...genre('subject:nonfiction OR subject:"non-fiction"', 4), source: 'Open Library search (most-wanted recent non-fiction)', refreshMs: 14 * DAY },
  // More genres from Goodreads' genre list: the same discovery as the other genre shelves (recent, widely wanted), four hand-picked staples kept
  horror: genre('subject:horror'),
  ya: genre('subject:\"young adult fiction\" OR subject:\"young adult\"'),
  biography: genre('subject:biography OR subject:autobiography'),
  crime: genre('subject:\"crime fiction\" OR subject:crime'),
  contemporary: genre('subject:\"contemporary fiction\" OR subject:\"contemporary women\"'),
  cookbooks: genre('subject:cookbooks OR subject:cooking'),
  humor: genre('subject:humor OR subject:comedy'),

  // Book clubs with a published list of every monthly pick (Wikipedia keeps these tables current)
  reeses: history(wikiSpec(
    ["Reese's Book Club"],
    // The page has two tables: adult picks (dated "Year and Month") and YA picks (dated "Date"); the shelf is the adult picks
    { title: /^title/i, author: /^author/i, when: /^year and month/i },
    when => `Reese's Book Club · ${when}`,
    7 * DAY,
    "Wikipedia: Reese's Book Club (adult Book Club Picks table)",
  )),
  // Service95 publishes its own list: the Book Club page is read server-side by /api/service95 (functions/api/service95.js).
  // Wikipedia's list stays as the fallback, used (and labelled as such) only when the official page can't be read.
  service95: history(serviceSpec()),
  // The Inklings Book Club (Jack Edwards): its podcast has one episode a month about the pick (see inklingsSpec)
  inklingsclub: history(inklingsSpec()),

  // Recent, widely read books in the genre (Open Library), with the shelf's first four hand-picked staples kept at the end
  romance: genre('subject:romance'),
  mystery: genre('subject:mystery OR subject:thriller OR subject:"detective and mystery stories"'),
  scifi: genre('subject:"science fiction"'),
  selfhelp: genre('subject:"self-help" OR subject:"self-improvement" OR subject:"personal development"'),
  fantasy: genre('subject:fantasy'),
  memoir: genre('subject:memoir OR subject:autobiography OR subject:memoirs'),
  historical: genre('subject:"historical fiction"'),
};

/** Shelf id -> source object, as the Store needs it: self-refreshing when it has a spec, plain curated otherwise. */
export const shelfSourceFor = (shelf: CuratedShelf): ShelfSource & { seeded?: () => Book[] } =>
  DYNAMIC_SPECS[shelf.id] ? dynamicCuratedSource(shelf, DYNAMIC_SPECS[shelf.id]) : curatedSource(shelf);
