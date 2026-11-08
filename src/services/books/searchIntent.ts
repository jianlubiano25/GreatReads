/**
 * Search intent (C20): what a plain search most likely wants, read from the candidates themselves (no network, no new request).
 *  - TITLE / SERIES intent: when the books whose titles contain what was typed ("harry potter", "dark matter") are mostly ONE author's, that author is the
 *    intended one: their books get a bonus and a same-title book by somebody else that few readers know is pushed down. Two authors of similar weight
 *    (a truly ambiguous title) give no bonus at all.
 *  - ACADEMIC records (proceedings, theses, "searches for ...") with few readers rank below the trade book unless the query itself asks for that kind of book.
 * Only ever an adjustment to the existing score; exact-title and author-name tiers (search.ts) stay in charge. Pure.
 */
import type { Book } from '../../types';
import { authorKey, isUnknownAuthor, titleKey } from './identity';
import { authorWords, contentTokens, normQ, tokenHits, type ParsedQuery } from './query';

export const INTENT_BONUS = 20;
export const INTENT_OTHER_PENALTY = 25;
export const ACADEMIC_PENALTY = 30;
export const SHORT_FORM_PENALTY = 35;
const FEW_READERS = 100;
export const EXACT_READERS_MAX = 30;
const ACADEMIC = /\b(proceedings|symposium|monograph|bibliograph\w*|dissertation|thesis|journal of|annals of|handbook of|textbook|treatise|encyclopedia of|lecture notes|conference|workshop|astrophysical|cosmological|searches for|constraints on|detection of|physics of|principles of|advances in|university press|(?:19|20)\d\d (?:edition|annual))\b/i;

const titleWords = (b: Pick<Book, 'title'>) => normQ(b.title || '').replace(/^(the|a|an) /, '').split(' ').filter(Boolean);
const weight = (b: Book) => Math.log10((b.ratingCount || 0) + 1) + 0.3;

/** Is this a plain title / series / author search (not an ISBN, a topic, a mood, or one with a separate author)? */
const plain = (q: ParsedQuery) => !q.author && !q.isbn && !q.keywords && !q.mood && q.scope !== 'keywords' && q.scope !== 'author' && contentTokens(q.tokens).length > 0;

/** Does the book's title hold every content word of the query (the last one may be a beginning)? */
export function titleHoldsQuery(b: Pick<Book, 'title'>, q: ParsedQuery): boolean {
  const need = contentTokens(q.tokens);
  const words = titleWords(b);
  return need.length > 0 && need.every((t, i) => tokenHits(t, words, q.partial && i === need.length - 1) > 0);
}

export interface Intent { key: string; max: number; anchor: number; /** the typed words are somebody's name: books BY them lead (search.ts), so the title-readers bonus stays off */ named?: boolean }
const NONE: Intent = { key: '', max: 0, anchor: 0 };
const isExact = (b: Pick<Book, 'title'>, q: ParsedQuery) => titleWords(b).join(' ') === q.text.replace(/^(the|a|an) /, '');
/** Readers of the best-known book whose title IS what was typed (0 when none has real readership): the anchor every other title match is measured against. */
export function anchorOf(books: readonly Book[], q: ParsedQuery): number {
  if (!plain(q)) return 0;
  const best = Math.max(0, ...books.filter(b => isExact(b, q)).map(b => b.ratingCount || 0));
  return best >= 100 ? best : 0;
}
/** The author (authorKey) most of the title-matching books belong to, or ''. */
export const dominantAuthor = (books: readonly Book[], q: ParsedQuery): string => intentOf(books, q).key;
/** The dominant author and the readers of their best-known matching book (a same-title book by somebody else with a tenth of that is not what was meant). */
export function intentOf(books: readonly Book[], q: ParsedQuery): Intent {
  if (!plain(q)) return NONE;
  const anchor = anchorOf(books, q);
  const words = contentTokens(q.tokens);
  const named = words.length >= 2 && books.some(b => !isUnknownAuthor(b.author) && words.every(w => tokenHits(w, authorWords(b.author), false) > 0));
  if (named) return { ...NONE, named: true };
  const groups = new Map<string, { w: number; n: number; readers: number }>();
  let total = 0;
  for (const b of books) {
    if (isUnknownAuthor(b.author) || !titleHoldsQuery(b, q)) continue;
    const k = authorKey(b.author);
    if (!k) continue;
    const g = groups.get(k) || { w: 0, n: 0, readers: 0 };
    g.w += weight(b); g.n += 1; g.readers += b.ratingCount || 0;
    groups.set(k, g);
    total += weight(b);
  }
  let best = '';
  let top: { w: number; n: number; readers: number } | undefined;
  for (const [k, g] of groups) if (!top || g.w > top.w) { best = k; top = g; }
  if (!top || total <= 0 || top.w / total < 0.6 || top.readers < 500) return anchor ? { ...NONE, anchor } : NONE; // real readership decides: ten unrated records by one name are not a series
  const max = Math.max(...books.filter(b => authorKey(b.author) === best && titleHoldsQuery(b, q)).map(b => b.ratingCount || 0));
  return { key: best, max, anchor };
}

/** Score adjustment for one book (0 when nothing applies). `dom` comes from `intentOf` over the whole candidate list. */
export function intentAdjust(b: Book, q: ParsedQuery, intent: Intent): number {
  const dom = intent.key;
  if (!plain(q)) return 0;
  let adj = 0;
  const holds = titleHoldsQuery(b, q);
  const exact = titleWords(b).join(' ') === q.text.replace(/^(the|a|an) /, ''); // literally the title; "Harry Potter: Proceedings of ..." only has it as its short form
  const shortForm = !exact && titleKey(b.title) === titleKey(q.text); // search.ts credits it as an exact title: undone below for a book few readers know
  const readers = b.ratingCount || 0;
  // Among books that carry the typed title (exactly, or as its short form) the one people read leads: readers are worth up to +30, so a sparse record of the real book still beats a tidy record nobody has rated
  if (!intent.named && (exact || shortForm || titleKey(b.title) === titleKey(q.text))) adj += Math.min(EXACT_READERS_MAX, Math.log10(readers + 1) * 8);
  if (dom && holds && authorKey(b.author) === dom) adj += INTENT_BONUS;
  else if (holds && !exact && (dom || intent.anchor) && (readers < FEW_READERS || readers < Math.max(intent.max, intent.anchor) / 10)) {
    // Somebody typed a title that a well-read book carries exactly: a book that only HAS those words (a research record, a subtitle match) comes after it, whatever it is about
    adj -= INTENT_OTHER_PENALTY + (shortForm ? SHORT_FORM_PENALTY : 0);
  }
  if (!exact && (b.ratingCount || 0) < FEW_READERS && ACADEMIC.test(`${b.title} ${(b.summary || '').slice(0, 200)}`) && !ACADEMIC.test(q.text)) adj -= ACADEMIC_PENALTY;
  return adj;
}
