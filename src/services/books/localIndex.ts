import type { Book } from '../../types';
import { persistentCache } from './cache';
import { bookKey, titleKey, authorKey } from './identity';
import { isBlocked } from './quality';
import { contentTokens, normQ, tokenHits, type ParsedQuery } from './query';

/**
 * Instant matches: books the app has already fetched for earlier searches, kept on this device (a few hundred, newest last, oldest dropped).
 * Typing "harry pot" shows "Harry Potter" the moment the second word starts, before any network answer, and works offline.
 *
 * This is a cache of the app's own search answers, never user data: it can be wiped at any time (it is on the re-downloadable list) and
 * nothing depends on it. Books are stored exactly as the search returned them (same `id`), so a book added from here is the same record
 * it would have been from the live answer. Blocked (explicit / satanic / demonic) books are never stored.
 */
const seen = persistentCache<Book>('readlife.seen1', { ttl: 45 * 24 * 60 * 60 * 1000, max: 300, validate: v => !!v && typeof (v as Book).title === 'string' });

/** Words of every stored book, computed once per book */
const words = new Map<string, { title: string[]; author: string[]; all: string[] }>();
const wordsOf = (b: Book) => {
  const k = String(b.id);
  let w = words.get(k);
  if (!w || w.title.join(' ') !== normQ(b.title)) {
    const title = normQ(b.title).split(' ').filter(Boolean);
    const author = normQ(b.author).split(' ').filter(Boolean);
    w = { title, author, all: [...title, ...author] };
    words.set(k, w);
  }
  return w;
};

/** The in-memory list, newest search answers last */
let list: Book[] | null = null;
const KEY = (b: Book) => `${bookKey(b)}|${titleKey(b.title)}|${authorKey(b.author)}`;

function load(): Book[] {
  if (list) return list;
  list = [];
  try {
    const raw = localStorage.getItem('readlife.seen1');
    const obj = raw ? JSON.parse(raw) : {};
    for (const e of Object.values<any>(obj)) if (e && e.v && typeof e.v.title === 'string') list.push(e.v as Book);
  } catch {
    /* no storage: the list lives only as long as the page */
  }
  return list;
}

/** Remember books a search returned (blocked ones never). Newest last. */
export function rememberSeen(books: Book[]): void {
  const cur = load();
  for (const b of books) {
    if (!b.title || isBlocked(b.title)) continue;
    const k = KEY(b);
    const i = cur.findIndex(x => KEY(x) === k);
    if (i >= 0) cur.splice(i, 1);
    cur.push(b);
    seen.set(k, b);
  }
  if (cur.length > 300) cur.splice(0, cur.length - 300);
}

/** Books already seen that match what was typed: every word of the query is a word (or, for the word being typed, a beginning) of the title or author. */
export function localMatches(q: ParsedQuery, limit = 8): Book[] {
  if (q.isbn || (!q.tokens.length && !q.author)) return [];
  const need = contentTokens(q.tokens);
  const authorWords = q.author ? q.author.split(' ').filter(Boolean) : [];
  const out: Book[] = [];
  for (const b of load()) {
    const w = wordsOf(b);
    const lastNeed = need[need.length - 1];
    const textOk = need.every(t => tokenHits(t, q.author ? w.title : w.all, q.partial && t === lastNeed) > 0);
    const authorOk = authorWords.every((t, i) => tokenHits(t, w.author, i === authorWords.length - 1) > 0);
    if (textOk && authorOk && !isBlocked(b.title)) out.push(b);
  }
  return out.slice(-Math.max(limit * 3, 24)).reverse(); // newest first; ranking decides the order shown
}

/** Match a provided list (e.g. the reader's library) with the same rules as localMatches. Does not write to the seen cache. */
export function matchKnownBooks(books: readonly Book[], q: ParsedQuery, limit = 8): Book[] {
  if (q.isbn || (!q.tokens.length && !q.author) || !books.length) return [];
  const need = contentTokens(q.tokens);
  const authorWords = q.author ? q.author.split(' ').filter(Boolean) : [];
  const out: Book[] = [];
  for (const b of books) {
    if (!b.title || isBlocked(b.title)) continue;
    const w = wordsOf(b);
    const lastNeed = need[need.length - 1];
    const textOk = !need.length || need.every(t => tokenHits(t, q.author ? w.title : w.all, q.partial && t === lastNeed) > 0);
    const authorOk = !authorWords.length || authorWords.every((t, i) => tokenHits(t, w.author, i === authorWords.length - 1) > 0);
    if (textOk && authorOk) out.push(b);
  }
  return out.slice(0, Math.max(limit * 3, 24));
}

/** Tests only */
export function forgetSeenForTests(): void {
  for (const b of load()) seen.delete(KEY(b));
  load().length = 0;
  words.clear();
}
