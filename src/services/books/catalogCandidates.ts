/**
 * Published catalog works as candidates (C19 genre fills, C20 search). Reads only the copy this device already keeps (catalogCovers.ts): no network,
 * no writes. A catalog work becomes a plain Book (same shape a provider hit has), so the existing dedupe (`sameWork`: Open Library work id, ISBN,
 * title + author with aliases) folds it into the provider results; the provider's record comes first, so its id stays and the catalog only fills gaps.
 */
import type { Book } from '../../types';
import type { SearchGenre } from '../../data/searchGenres';
import { catalogCopy, type CatalogWork } from './catalogCovers';
import { subjectEvidence } from './genreEvidence';
import { isKnownGenre } from './model';
import { authorWords, contentTokens, normQ, tokenHits, type ParsedQuery } from './query';

const SITES: Record<string, NonNullable<Book['ratingSource']>> = { apple_books: 'apple', apple: 'apple', google_books: 'google', google: 'google', open_library: 'openlibrary', openlibrary: 'openlibrary', hardcover: 'hardcover' };

/** A published work that was merged into another is not a candidate (the canonical work is). */
const live = (w: CatalogWork): boolean => !!w && !!w.title && !(w.identifiers && typeof w.identifiers.mergedInto === 'string' && w.identifiers.mergedInto);

export function catalogBookOf(w: CatalogWork): Book {
  const text = (type: string) => w.content?.find(c => c.type === type && (!c.language || /^en/i.test(c.language)))?.content || '';
  const meta = (f: string) => w.metadata?.find(m => m.field === f)?.value;
  const ed = w.editions?.find(e => e.year || e.pages) ?? w.editions?.[0];
  const year = String(meta('year') ?? ed?.year ?? '');
  const pages = Number(meta('pageCount') ?? ed?.pages) || 0;
  const genre = String(meta('genre') ?? w.genres?.find(isKnownGenre) ?? '');
  // the rating with the most readers behind it (an average and a count always stay together)
  const rated = (w.ratings || []).filter(r => Number(r.average) >= 1 && Number(r.average) <= 5 && Number(r.count) > 0 && SITES[r.source]).sort((a, b) => Number(b.count) - Number(a.count))[0];
  const olWork = typeof w.identifiers?.olWork === 'string' ? (w.identifiers.olWork as string) : undefined;
  const isbn13 = ed?.isbn13 || undefined;
  const isbn10 = ed?.isbn10 || undefined;
  const book: Book = {
    id: `catalog_${w.id}`, title: w.title, author: w.author || '', shelf: 'mine', difficulty: pages > 450 ? 3 : pages > 250 ? 2 : pages > 0 ? 1 : 0, isOnDevice: false,
    year: /^\d{3,4}$/.test(year) ? year : '', genre: isKnownGenre(genre) ? genre : '', summary: text('book_description'), authorBio: text('author_bio'), pageCount: pages,
    source: 'manual',
  };
  if (w.cover && /^https:\/\//i.test(w.cover)) book.coverUrl = w.cover;
  if (rated) { book.ratingAverage = Number(rated.average); book.ratingCount = Number(rated.count); book.ratingSource = SITES[rated.source]; }
  if (olWork || isbn13 || isbn10) book.identity = { ...(olWork ? { olWork } : {}), ...(isbn13 ? { isbn13 } : {}), ...(isbn10 ? { isbn10 } : {}) };
  return book;
}

const publishedWorks = (): CatalogWork[] => Object.values(catalogCopy().works).filter(live);

/* ------------------------------ C19: genre fills ------------------------------ */

const stemWord = (w: string) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
const same = (a: string, b: string) => normQ(a).split(' ').map(stemWord).join(' ') === normQ(b).split(' ').map(stemWord).join(' ');

/**
 * Reliable genre evidence = the work's OWN `genres` (set by the owner / the fill from provider receipts) names the genre: the label, the typed word, an alias,
 * or (for a genre with `subjectTerms`) every word of one of its terms. The title, the description and a loose word match are never evidence, and a work with no
 * genres says nothing (it is not a candidate; nothing is backfilled here).
 */
export function genreEvidenceOfWork(g: Pick<SearchGenre, 'label' | 'query' | 'aliases' | 'subjectTerms'>, w: Pick<CatalogWork, 'genres'>): boolean {
  const genres = (w.genres || []).filter(x => typeof x === 'string' && isKnownGenre(x));
  if (!genres.length) return false;
  const names = [g.label, g.query, ...(g.aliases || [])];
  if (genres.some(x => names.some(n => same(x, n)))) return true;
  return !!g.subjectTerms?.length && subjectEvidence(genres, g.subjectTerms) === 'yes';
}

export const CATALOG_GENRE_MAX = 40;

/** Published works with reliable genre evidence for `g`, best-rated first (at most `max`). */
export function catalogGenreCandidates(g: SearchGenre, works: readonly CatalogWork[] = publishedWorks(), max = CATALOG_GENRE_MAX): Book[] {
  return works.filter(w => live(w) && genreEvidenceOfWork(g, w)).map(catalogBookOf)
    .sort((a, b) => (b.ratingCount || 0) - (a.ratingCount || 0))
    .slice(0, max);
}

/* ------------------------------ C20: search ------------------------------ */

const wordsOf = (...parts: (string | undefined)[]) => parts.flatMap(p => normQ(p || '').split(' ')).filter(Boolean);

/**
 * Published works that fit what was typed: every content word of the query is a word of the work's title (aliases included) or author (aliases included);
 * the last word may be a beginning. rank() then narrows by Title / Author scope and orders them with everything else. Returns [] for a topic search.
 */
export function catalogSearchCandidates(q: ParsedQuery, limit = 20, works: readonly CatalogWork[] = publishedWorks()): Book[] {
  if (q.isbn || q.scope === 'keywords' || q.mood || q.keywords) return [];
  const need = contentTokens(q.tokens);
  const qa = q.author.split(' ').filter(Boolean);
  if (!need.length && !qa.length) return [];
  const last = need[need.length - 1];
  const out: Book[] = [];
  for (const w of works) {
    if (!live(w)) continue;
    const title = wordsOf(w.title, ...(w.aliases || []));
    const author = [w.author, ...(w.authorAliases || [])].flatMap(a => authorWords(a || ''));
    if (qa.length && !qa.every((t, i) => tokenHits(t, author, i === qa.length - 1) > 0)) continue;
    if (need.length) {
      const pool = q.scope === 'title' ? title : q.scope === 'author' && !qa.length ? author : [...title, ...author];
      if (!need.every(t => tokenHits(t, pool, q.partial && t === last) > 0)) continue;
    }
    out.push(catalogBookOf(w));
  }
  return out.sort((a, b) => (b.ratingCount || 0) - (a.ratingCount || 0)).slice(0, limit);
}
