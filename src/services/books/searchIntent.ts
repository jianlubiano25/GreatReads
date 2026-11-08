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
import { contentTokens, normQ, tokenHits, type ParsedQuery } from './query';

export const INTENT_BONUS = 20;
export const INTENT_OTHER_PENALTY = 25;
export const ACADEMIC_PENALTY = 30;
export const SHORT_FORM_PENALTY = 35;
const FEW_READERS = 100;
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

export interface Intent { key: string; max: number }
const NONE: Intent = { key: '', max: 0 };
/** The author (authorKey) most of the title-matching books belong to, or ''. */
export const dominantAuthor = (books: readonly Book[], q: ParsedQuery): string => intentOf(books, q).key;
/** The dominant author and the readers of their best-known matching book (a same-title book by somebody else with a tenth of that is not what was meant). */
export function intentOf(books: readonly Book[], q: ParsedQuery): Intent {
  if (!plain(q)) return NONE;
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
  if (!top || total <= 0 || top.w / total < 0.6 || top.readers < 500) return NONE; // real readership decides: ten unrated records by one name are not a series
  const max = Math.max(...books.filter(b => authorKey(b.author) === best && titleHoldsQuery(b, q)).map(b => b.ratingCount || 0));
  return { key: best, max };
}

/** Score adjustment for one book (0 when nothing applies). `dom` comes from `intentOf` over the whole candidate list. */
export function intentAdjust(b: Book, q: ParsedQuery, intent: Intent): number {
  const dom = intent.key;
  if (!plain(q)) return 0;
  let adj = 0;
  const holds = titleHoldsQuery(b, q);
  const exact = titleWords(b).join(' ') === q.text.replace(/^(the|a|an) /, ''); // literally the title; "Harry Potter: Proceedings of ..." only has it as its short form
  const shortForm = !exact && titleKey(b.title) === titleKey(q.text); // search.ts credits it as an exact title: undone below for a book few readers know
  if (dom && holds) {
    if (authorKey(b.author) === dom) adj += INTENT_BONUS;
    else if (!exact && ((b.ratingCount || 0) < FEW_READERS || (b.ratingCount || 0) < intent.max / 10)) adj -= INTENT_OTHER_PENALTY + (shortForm ? SHORT_FORM_PENALTY : 0);
  }
  if (!exact && (b.ratingCount || 0) < FEW_READERS && ACADEMIC.test(`${b.title} ${(b.summary || '').slice(0, 200)}`) && !ACADEMIC.test(q.text)) adj -= ACADEMIC_PENALTY;
  return adj;
}
