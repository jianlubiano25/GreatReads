import { getJsonDetailed, type GetOpts, type JsonResult } from '../http';
import { bump } from '../perf';
import { authorVariants, cleanIsbn, isbnPair, titleVariants, titlesMatch, authorListMatches } from '../identity';
import { difficultyFor, hasRealSummary, isKnownGenre, makeBook } from '../model';
import { externalRating } from '../ratings';
import type { CallOpts, Hit } from './types';

const GB = 'https://www.googleapis.com/books/v1';
const PROXY = '/api/google-books';
const FIELDS = 'id,volumeInfo(title,authors,publisher,description,categories,pageCount,publishedDate,averageRating,ratingsCount,maturityRating,imageLinks,industryIdentifiers,language)';

/**
 * How Google Books is reached.
 *  - "proxy" (the browser, deployed or `npm run dev`, unless a key was pasted in developer mode): this site's own /api/google-books function (functions/api/google-books.js),
 *    which holds the key as the Cloudflare secret GOOGLE_BOOKS_API_KEY. NO key ships in the app.
 *  - "direct" (Node: `npm run prefetch:store`, the check scripts, the tests): googleapis.com, with GOOGLE_BOOKS_API_KEY (or VITE_GOOGLE_BOOKS_API_KEY)
 *    from the environment. `npm run dev` may also use VITE_GOOGLE_BOOKS_API_KEY from .env.local, because Vite's dev server does not run Pages Functions;
 *    that read is guarded by import.meta.env.DEV, which a production build replaces with `false`, so the key never reaches the deployed bundle.
 */
type Mode = 'proxy' | 'direct';
let modeForTests: Mode | null = null;
/** Tests only: force proxy / direct mode (null = decide from where the code runs). */
export const setGoogleModeForTests = (m: Mode | null) => { modeForTests = m; proxyNotConfigured = false; };
let browserForTests: boolean | null = null;
/** Tests only: pretend the code runs in a browser (true) or in Node (false); null = detect. */
export const setBrowserForTests = (b: boolean | null) => { browserForTests = b; };
const inNode = (): boolean => { if (browserForTests !== null) return !browserForTests; try { return !!(globalThis as any).process?.versions?.node; } catch { return false; } };
const devKey = (): string => {
  try { if ((import.meta as any).env?.DEV) return String((import.meta as any).env?.VITE_GOOGLE_BOOKS_API_KEY || ''); } catch {}
  return '';
};
const nodeKey = (): string => {
  try { return String((globalThis as any).process?.env?.GOOGLE_BOOKS_API_KEY || (globalThis as any).process?.env?.VITE_GOOGLE_BOOKS_API_KEY || ''); } catch { return ''; }
};
/**
 * Developer mode: a key pasted into Profile is kept on THIS device only (localStorage; never in a backup, never sent to this site's server) and the app
 * then calls Google directly with it. Without one, the browser uses the proxy. A key Google refuses is set aside for 15 minutes and the proxy takes over.
 */
const OWN_KEY = 'readlife.googleKey1';
const ownKey = (): string => { try { return localStorage.getItem(OWN_KEY) || ''; } catch { return ''; } };
export const hasOwnGoogleKey = (): boolean => !!ownKey();
/** Plausible shape of a Google API key (letters, digits, - and _), so a stray paste is refused. */
export const looksLikeGoogleKey = (k: string): boolean => /^[A-Za-z0-9_-]{20,100}$/.test(k.trim());
/** Save (or, with an empty string, remove) the key. Returns false when the text does not look like a key. A change clears what this session learned about the old key / the proxy. */
export function setOwnGoogleKey(k: string): boolean {
  const key = k.trim();
  if (key && !looksLikeGoogleKey(key)) return false;
  try { key ? localStorage.setItem(OWN_KEY, key) : localStorage.removeItem(OWN_KEY); } catch { return false; }
  keyRejectedAt = 0;
  proxyNotConfigured = false;
  return true;
}

const apiKey = (): string => (inNode() ? nodeKey() || devKey() : ownKey() || devKey());
const mode = (): Mode => modeForTests ?? (inNode() || (apiKey() && !keyRejected()) ? 'direct' : 'proxy');

/**
 * A refused key is set aside for 15 minutes, not for the whole session: a 403 can be a passing quota / rate-limit answer, and a fixed key (restrictions changed in Google
 * Cloud) is picked up without closing the app. A key that is really wrong costs one extra request per 15 minutes (the same "does it work without the key" check as before).
 */
const KEY_RETRY_MS = 15 * 60 * 1000;
let keyRejectedAt = 0;
const keyRejected = (): boolean => keyRejectedAt > 0 && Date.now() - keyRejectedAt < KEY_RETRY_MS;
const withKey = (url: string) => (apiKey() && !keyRejected() ? `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey())}` : url);

interface GbParams { volumeId?: string; q?: string; maxResults?: number; startIndex?: number; langRestrict?: string; printType?: string; fields: string }
/** The request URL for the current mode. Same parameters either way; only the host and the key differ. */
function gbUrl(p: GbParams): string {
  const parts: string[] = [];
  if (p.q !== undefined) parts.push(`q=${encodeURIComponent(p.q)}`);
  if (p.maxResults) parts.push(`maxResults=${p.maxResults}`);
  if (p.startIndex) parts.push(`startIndex=${p.startIndex}`);
  if (p.langRestrict) parts.push(`langRestrict=${p.langRestrict}`);
  if (p.printType) parts.push(`printType=${p.printType}`);
  parts.push(`fields=${encodeURIComponent(p.fields)}`);
  if (mode() === 'proxy') return `${PROXY}?${p.volumeId ? `volumeId=${encodeURIComponent(p.volumeId)}&` : ''}${parts.join('&')}`;
  return p.volumeId ? `${GB}/volumes/${encodeURIComponent(p.volumeId)}?${parts.join('&')}` : `${GB}/volumes?${parts.join('&')}`;
}

/** The proxy said its secret is missing: not asked again this session (every ask would fail the same way, and be retried). */
let proxyNotConfigured = false;

/**
 * Every Google Books request goes through here.
 * Proxy mode: no key is involved. A "not_configured" answer (503: the Cloudflare secret is missing for this deployment) is noticed once and counted
 * (`__rlPerf()` shows `google.proxyNotConfigured`), so "the secret is not set" can be told apart from "Google has no rating" and the failing call is not repeated per book.
 * Direct mode: a key that Google rejects (HTTP 400 "API key not valid", or 403 because the key is restricted to other sites or APIs) fails EVERY request, which
 * looked exactly like "Google has no ratings". So a rejected key is noticed once (counters only, never the key itself), and the request is repeated without it
 * (Google's shared anonymous quota), for the next 15 minutes. `__rlPerf()` shows `google.keyConfigured` and `google.keyRejected`.
 */
async function googleJson(url: string, opts: GetOpts): Promise<JsonResult> {
  if (mode() === 'proxy') {
    if (proxyNotConfigured) return { data: null, status: 503, failure: 'http' };
    bump('google.viaProxy');
    const r = await getJsonDetailed(url, opts);
    if (!r.data && r.status === 503 && r.body?.error === 'not_configured') {
      proxyNotConfigured = true;
      bump('google.proxyNotConfigured');
      try { console.warn('[GreatReads] /api/google-books answered "not_configured": set the Cloudflare Pages secret GOOGLE_BOOKS_API_KEY (Production and Preview) and redeploy.'); } catch {}
    }
    return r;
  }
  bump(apiKey() ? 'google.keyConfigured' : 'google.keyMissing');
  const r = await getJsonDetailed(withKey(url), opts);
  if (r.data || !apiKey() || keyRejected() || (r.status !== 400 && r.status !== 403)) return r;
  // 400 / 403 can also be one odd query, so the key is blamed only when the same request WORKS without it
  const again = await getJsonDetailed(url, opts);
  if (!again.data) return r;
  keyRejectedAt = Date.now();
  bump('google.keyRejected');
  try { console.warn(`[GreatReads] Google Books refused the configured API key (HTTP ${r.status}) but answers without it, so requests go without it for the next 15 minutes (in the browser, through /api/google-books). Check the key's website and API restrictions in Google Cloud.`); } catch {}
  return again;
}
/** Tests only: forget that the key was refused. */
export const resetGoogleKeyForTests = () => { keyRejectedAt = 0; proxyNotConfigured = false; };

/**
 * Developer mode "Test": ask Google (through whichever route the app is using now) for one volume and say what happened, in words.
 * Never includes the key. `route` is "own key" (direct) or "server" (/api/google-books).
 */
export async function checkGoogleBooks(): Promise<{ route: 'own key' | 'server'; ok: boolean; status: number; message: string }> {
  const route = mode() === 'direct' ? 'own key' : 'server';
  // A random (valid) startIndex makes every test a request nobody has made before: the service worker keeps Google answers for 12 hours and serves
  // the old copy when Google errors, which would let a key that stopped working still pass the test.
  const base = gbUrl({ q: 'intitle:"Dune" inauthor:"Frank Herbert"', maxResults: 3, startIndex: 1 + Math.floor(Math.random() * 30), fields: 'totalItems' });
  let res: Response;
  try { res = await fetch(route === 'own key' ? withKey(base) : base); } catch { return { route, ok: false, status: 0, message: 'Could not reach the network.' }; }
  let body: any = null;
  try { body = await res.json(); } catch {}
  if (res.ok) return { route, ok: true, status: res.status, message: 'Works: Google answered.' };
  const reason: string = typeof body?.reason === 'string' ? body.reason : body?.error?.errors?.[0]?.reason || '';
  const code = reason || (typeof body?.error === 'string' ? body.error : '');
  const known: Record<string, string> = {
    not_configured: 'The server has no GOOGLE_BOOKS_API_KEY secret for this deployment (add it in Cloudflare for Production and Preview, then redeploy).',
    rate_limited: 'Google says the quota is used up for now.',
    rateLimitExceeded: 'Google says the quota is used up for now.',
    dailyLimitExceeded: 'Google says the daily quota is used up.',
    quotaExceeded: 'Google says the quota is used up for now.',
    ipRefererBlocked: 'The key is restricted to certain websites: restrict it by API (Books API) only.',
    keyInvalid: 'Google does not accept this key.',
    accessNotConfigured: "The Books API is not enabled for this key's project.",
  };
  return { route, ok: false, status: res.status, message: `${known[code] || 'Google refused the request.'} (HTTP ${res.status}${code ? `, ${String(code).replace(/[^A-Za-z_]/g, '')}` : ''})` };
}

const cleanThumb = (raw: string) => raw.replace(/^http:\/\//i, 'https://').replace('&edge=curl', '');

/** A Google Books volume -> Book. The id format ("gb_<volume id>") is saved in people's libraries: never change it. */
export function gbItemToHit(item: any, fallbackTitle = ''): Hit {
  const v = item?.volumeInfo || {};
  const author = v.authors?.[0] || 'Unknown Author';
  const pages = v.pageCount || 0;
  const ids: { type: string; identifier: string }[] = v.industryIdentifiers || [];
  const isbn = isbnPair(ids.find(i => i.type === 'ISBN_13')?.identifier || ids.find(i => i.type === 'ISBN_10')?.identifier);
  const thumb = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || '';
  const book = makeBook({
    id: `gb_${item?.id || Date.now()}`,
    title: v.title || fallbackTitle,
    author,
    year: v.publishedDate ? String(v.publishedDate).slice(0, 4) : '',
    genre: (v.categories || []).join(', ') || 'General',
    summary: v.description ? String(v.description).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) : `A book by ${author}.`,
    pageCount: pages,
    coverUrl: thumb ? cleanThumb(thumb) : undefined,
    ratingAverage: v.averageRating || undefined,
    ratingCount: v.ratingsCount || undefined,
    spineColor: '#8a5a3b',
    source: 'google',
    identity: { gbVolume: item?.id, ...isbn },
  });
  return { book, flags: { language: v.language ? String(v.language).toLowerCase() : undefined, subjects: v.categories, description: v.description ? String(v.description) : undefined, googleMaturity: v.maturityRating, publisher: v.publisher ? String(v.publisher) : undefined } };
}

/** English volumes only (`langRestrict=en`): English titles, covers and blurbs are preferred. An exact ISBN / volume lookup is the one edition asked for, so it is not restricted. */
const searchUrl = (q: string, max: number, start = 0, anyLanguage = false) =>
  gbUrl({ q, maxResults: Math.min(40, max), startIndex: start, langRestrict: anyLanguage ? undefined : 'en', printType: 'books', fields: `totalItems,items(${FIELDS})` });

export async function searchGoogle(q: string, max: number, opts: CallOpts & { anyLanguage?: boolean } = {}): Promise<Hit[]> {
  const data = (await googleJson(searchUrl(q, max, opts.start, opts.anyLanguage), { signal: opts.signal })).data;
  if (typeof data?.totalItems === 'number') opts.onTotal?.(data.totalItems);
  return (data?.items || []).map((i: any) => gbItemToHit(i));
}

/** The exact edition for an ISBN. */
export async function googleByIsbn(isbn: string, opts: CallOpts = {}): Promise<Hit | null> {
  const clean = cleanIsbn(isbn);
  if (!clean) return null;
  return (await searchGoogle(`isbn:${clean}`, 3, { ...opts, anyLanguage: true }))[0] ?? null;
}

export async function googleVolume(id: string, opts: CallOpts = {}): Promise<Hit | null> {
  const item = (await googleJson(gbUrl({ volumeId: id, fields: FIELDS }), { signal: opts.signal })).data;
  return item ? gbItemToHit(item) : null;
}

/** Is this Google volume the book that was asked for? Title and author must agree; an unknown wanted author or an empty title contradicts nothing. */
const isWanted = (h: Hit, q: { title: string; author?: string }): boolean => (!q.title.trim() || titlesMatch(h.book.title, q.title)) && authorListMatches(h.book.author, q.author || '');

/** Is this volume in English (or does Google not say)? */
export const isEnglishVolume = (h: Hit): boolean => !h.flags.language || h.flags.language === 'en';

/** What a caller wants from a Google volume. Only a missing NEEDED field is worth another search (a cover lookup does not care about the description). */
export type GoogleNeed = 'cover' | 'pages' | 'year' | 'text';
const ALL_NEEDS: readonly GoogleNeed[] = ['cover', 'pages', 'year', 'text'];

/** Does this volume lack a needed field (cover, pages, year, a real description)? Ratings are not counted: see findGoogleRating. */
export const isSparseGoogle = (h: Hit, need: readonly GoogleNeed[] = ALL_NEEDS): boolean =>
  (need.includes('cover') && !h.book.coverUrl) || (need.includes('pages') && !h.book.pageCount) || (need.includes('year') && !h.book.year) || (need.includes('text') && !hasRealSummary(h.book.summary));

/**
 * Fill a volume's GAPS, field by field, from other editions of the SAME book (the caller passes only volumes that matched the wanted
 * title and author). A value the volume already has is never replaced; identity (the volume id and ISBNs) stays the volume's own, so the
 * result still names one exact edition. A rating is taken whole (average + count together) from one edition, never mixed.
 */
export function fillGoogleGaps(base: Hit, others: readonly Hit[]): Hit {
  const book = { ...base.book };
  const flags = { ...base.flags };
  for (const o of others) {
    if (o === base || (o.book.identity?.gbVolume && o.book.identity.gbVolume === base.book.identity?.gbVolume)) continue;
    if (!book.coverUrl && !book.coverId && o.book.coverUrl) book.coverUrl = o.book.coverUrl;
    if (!book.pageCount && o.book.pageCount) { book.pageCount = o.book.pageCount; book.difficulty = difficultyFor(o.book.pageCount); }
    if (!book.year && o.book.year) book.year = o.book.year;
    if (!hasRealSummary(book.summary) && hasRealSummary(o.book.summary)) { book.summary = o.book.summary; flags.description = o.flags.description; }
    if (!isKnownGenre(book.genre) && isKnownGenre(o.book.genre)) { book.genre = o.book.genre; flags.subjects = o.flags.subjects; }
    if (!externalRating(book) && externalRating(o.book)) { book.ratingAverage = o.book.ratingAverage; book.ratingCount = o.book.ratingCount; }
  }
  return { book, flags };
}

/** Most searches spent looking for another edition to fill an exact-ISBN volume's gaps (the ISBN lookup itself is not counted): one, as the book is named. */
const SPARSE_SEARCHES = 1;

/** The plain search "Title Author" (no intitle:/inauthor: operators): the one fallback tried after the strict searches found nothing. */
const looseQuery = (title: string, author?: string): string => `${title} ${author || ''}`.trim();

/** The matching editions of the first title / author variant whose search finds any (at most `maxSearches` searches). */
async function matchingEditions(q: { title: string; author?: string }, opts: CallOpts, maxSearches = Infinity): Promise<Hit[]> {
  const generic = !q.author || /^(Unknown|Featured) Author$/.test(q.author);
  // The title as given, without its subtitle, then each half of a dual title; the author as given, then with a hyphen closed up (see openLibrary.ts). The first
  // search that finds the book wins.
  let searches = 0;
  for (const title of titleVariants(q.title)) {
    for (const author of generic ? [undefined] : authorVariants(q.author)) {
      if (searches >= maxSearches) return [];
      searches++;
      const matches = (await searchGoogle(`intitle:"${title}"${author ? ` inauthor:"${author}"` : ''}`, 6, opts)).filter(h => isWanted(h, q));
      if (matches.length || opts.signal?.aborted) return matches;
    }
  }
  // Strict intitle:/inauthor: often finds nothing although a plain "Title Author" search finds the book: ONE loose search, same filter.
  // Not when the caller capped the searches (an exact-ISBN volume only looks for gaps to fill): that must not cost more requests.
  if (maxSearches === Infinity) return (await searchGoogle(looseQuery(q.title, generic ? undefined : q.author), 10, opts)).filter(h => isWanted(h, q));
  return [];
}

/**
 * Best match for a book we only know by name (an ISBN lookup is preferred when there is one).
 *  - An exact-ISBN volume is used only when it IS the wanted book (title and author agree): an ISBN that belongs to another book, or to a
 *    bundle, must not lend that book's cover, pages or description.
 *  - A volume that is sparse (no cover, pages, year or real description) is completed from the other matching editions found by title and
 *    author, field by field (fillGoogleGaps). Those come free with a title search that was made anyway; for an exact-ISBN volume at most
 *    SPARSE_SEARCHES extra search is made, and only when a field the caller NEEDS is missing (`need`, default all of them).
 */
export async function findGoogle(q: { title: string; author?: string; isbn?: string }, opts: CallOpts = {}, need: readonly GoogleNeed[] = ALL_NEEDS): Promise<Hit | null> {
  let exact: Hit | null = null;
  if (cleanIsbn(q.isbn)) {
    const byIsbn = await googleByIsbn(q.isbn!, opts);
    if (byIsbn && isWanted(byIsbn, q)) exact = byIsbn;
    if (exact && !isSparseGoogle(exact, need) && isEnglishVolume(exact)) return exact;
  }
  const matches = await matchingEditions(q, opts, exact && isEnglishVolume(exact) ? SPARSE_SEARCHES : Infinity);
  // The exact edition is in another language: an English edition of the same book (found by title and author) stands in for it; with none, the exact edition is kept
  if (exact && !isEnglishVolume(exact)) {
    const english = matches.filter(isEnglishVolume).reduce<Hit | undefined>((best, h) => (!best || (h.book.ratingCount || 0) > (best.book.ratingCount || 0) ? h : best), undefined);
    if (english) return fillGoogleGaps(english, matches);
  }
  if (exact) return fillGoogleGaps(exact, matches);
  // Editions of one book differ in whether Google has ratings for them: take the best-rated match, else the first
  const found = matches.reduce<Hit | undefined>((best, h) => (!best || (h.book.ratingCount || 0) > (best.book.ratingCount || 0) ? h : best), undefined);
  return found ? fillGoogleGaps(found, matches) : null;
}

/** Most searches spent looking for one book's Google rating (the ISBN edition, then title / author variants). */
const RATING_SEARCHES = 4;

/**
 * The Google Books rating of a book: a hit whose averageRating (1-5) and ratingsCount (above 0) come as a pair. Editions of one book differ in
 * whether Google rates them, so an unrated edition is not the end: the other matching editions of each title / author variant are tried
 * (at most RATING_SEARCHES requests). `failed` tells an API / network error (5xx and 429 retried once) from a successful answer with no
 * rated edition, so an error is never remembered as "Google has no rating".
 */
export async function findGoogleRating(q: { title: string; author?: string; isbn?: string }, opts: CallOpts = {}): Promise<{ hit: Hit | null; failed: boolean }> {
  let failed = false;
  let unavailable = false; // rate limited, down or unreachable (a 400 for one odd query says nothing about the next)
  let searches = 0;
  const bestRated = (hits: Hit[]) => hits.filter(h => externalRating(h.book)).reduce<Hit | null>((b, h) => (!b || (h.book.ratingCount || 0) > (b.book.ratingCount || 0) ? h : b), null);
  const search = async (query: string): Promise<Hit[]> => {
    searches++;
    const r = await googleJson(searchUrl(query, 20), { signal: opts.signal, retries: 1 });
    if (!r.data) {
      failed = true;
      if (r.status === 0 || r.status === 429 || r.status >= 500) unavailable = true;
    }
    return (r.data?.items || []).map((i: any) => gbItemToHit(i));
  };
  const isbn = cleanIsbn(q.isbn);
  if (isbn) {
    const exact = bestRated((await search(`isbn:${isbn}`)).filter(h => isWanted(h, q))); // an ISBN that belongs to another book lends it no rating
    if (exact) return { hit: exact, failed: false };
  }
  const generic = !q.author || /^(Unknown|Featured) Author$/.test(q.author);
  const ok = (h: Hit) => titlesMatch(h.book.title, q.title) && authorListMatches(h.book.author, q.author || '');
  for (const title of titleVariants(q.title)) {
    for (const author of generic ? [undefined] : authorVariants(q.author)) {
      // After an API error (rate limit, outage) the next searches would fail the same way: stop instead of spending up to 4 x 2 requests per book
      if (unavailable || opts.signal?.aborted) return { hit: null, failed };
      if (searches >= RATING_SEARCHES) break; // the strict budget is spent: only the single loose fallback below may follow
      const found = bestRated((await search(`intitle:"${title}"${author ? ` inauthor:"${author}"` : ''}`)).filter(ok));
      if (found) return { hit: found, failed: false };
    }
  }
  // Strict intitle:/inauthor: often finds nothing although a plain "Title Author" search finds the book. ONE extra search (outside RATING_SEARCHES), same `ok` filter.
  if (unavailable || opts.signal?.aborted) return { hit: null, failed };
  const loose = bestRated((await search(looseQuery(q.title, generic ? undefined : q.author))).filter(ok));
  if (loose) return { hit: loose, failed: false };
  return { hit: null, failed };
}
