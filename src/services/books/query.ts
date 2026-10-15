import { cleanIsbn } from './identity';

/**
 * Reading what was typed into the search box.
 *
 * The box takes a title, an author, a keyword / topic, an ISBN, or a mix:
 *   "dune"                      title (or anything: it is also tried as an author and a keyword)
 *   "harry pot"                 a title still being typed: the last word may be only a beginning
 *   "stephen king"              an author
 *   "dune by frank herbert"     title + author
 *   "books by stephen king"     author
 *   "books about dragons"       keywords
 *   "author: toni morrison" / "inauthor:morrison" / "title:beloved" / "intitle:beloved"
 *   "978-0-8021-4853-7"         an ISBN
 * A separate Author box (Add Book) is merged in as the author.
 */

/** Lower-case, accent-free, letters and digits only: "Brontë!" and "bronte" compare equal. */
export const normQ = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'to', 'for', 'by', 'with', 'at', 'is', 'it']);

/** What the box is searching: everything (title, author, keywords), titles only, or authors only (the Goodreads-style selector next to the box). */
export type SearchScope = 'all' | 'title' | 'author' | 'keywords';

export interface ParsedQuery {
  /** The scope the reader picked; 'title' and 'author' keep only results whose title / author match what was typed */
  scope: SearchScope;
  /** What to match against titles (and, when no author was given, against authors and keywords): normalised */
  text: string;
  /** The author part, normalised ('' when none was given) */
  author: string;
  /** The ISBN, when the box holds one */
  isbn: string;
  /** Words of `text` */
  tokens: string[];
  /** The last word may be unfinished ("harry pot"): it is matched as a beginning, and searched with a wildcard */
  partial: boolean;
  /** The reader asked for books ABOUT something ("books about dragons") */
  keywords: boolean;
  /** Set when "x by y" was split into a title and an author: the whole phrase, because "Death by Water" is one title. It is searched and ranked too. */
  full: string;
  /** Stable key for caches */
  key: string;
}

/** `by`: read "title by author" as a title and an author (the search box does; bulk import, which has a column for each, does not). */
export function parseQuery(rawTitle: string, rawAuthor = '', by = true, scope: SearchScope = 'all'): ParsedQuery {
  let title = (rawTitle || '').replace(/\s+/g, ' ');
  let author = (rawAuthor || '').trim();
  if (scope === 'author') { author = title.trim() || author; title = ''; } // everything typed is an author's name
  else if (scope === 'title' || scope === 'keywords') by = false; // "Death by Water" is one title; keywords are never "x by y"
  const trailingSpace = /\s$/.test(rawTitle || '');
  let keywords = scope === 'keywords'; // topics, themes and moods ("cozy", "dragons"): searched as subjects and matched against genre / description

  const isbn = cleanIsbn((rawTitle || '').trim()); // an ISBN is found from any scope
  if (isbn) return { scope: 'all', text: isbn, author: '', isbn, tokens: [isbn], partial: false, keywords: false, full: '', key: `isbn:${isbn}` };
  let full = '';

  // Search operators, as Google Books writes them
  const op = title.match(/^\s*(inauthor|author|intitle|title)\s*:\s*(.*)$/i);
  if (op) {
    if (/author/i.test(op[1])) { if (!author) author = op[2]; title = ''; } else title = op[2];
  } else if (!author && by) {
    const byAuthor = title.match(/^\s*(?:books?|novels?|works?)\s+by\s+(.+)$/i);
    const about = title.match(/^\s*(?:books?|novels?)\s+(?:about|on)\s+(.+)$/i);
    const titleBy = title.match(/^\s*(.{2,}?)\s+by\s+(.{2,})$/i);
    if (byAuthor) { author = byAuthor[1]; title = ''; }
    else if (about) { title = about[1]; keywords = true; }
    else if (titleBy) { full = normQ(title); title = titleBy[1]; author = titleBy[2]; }
  }

  const text = normQ(title);
  const authorN = normQ(author);
  const tokens = text.split(' ').filter(Boolean);
  const last = tokens[tokens.length - 1] || '';
  // A finished-looking last word (followed by a space, or a stop word) is matched whole; a short unfinished one is a beginning
  const partial = !!last && !trailingSpace && !STOP.has(last) && !!title.trim();
  return { scope, text, author: authorN, isbn: '', tokens, partial, keywords, full, key: `${text}${partial ? '*' : ''}|${authorN}|${full}${scope === 'all' ? '' : `|${scope}`}` };
}

/** Does `token` (a query word) match one of `words`? Whole word, or, for the word being typed, the beginning of one. */
export const tokenHits = (token: string, words: readonly string[], asPrefix: boolean): 0 | 0.7 | 1 => {
  let best: 0 | 0.7 | 1 = 0;
  for (const w of words) {
    if (w === token) return 1;
    if (asPrefix && token.length >= 2 && w.startsWith(token)) best = 0.7;
  }
  return best;
};

/** Words that carry meaning: stop words and one-letter words never decide a match by themselves. */
export const contentTokens = (tokens: readonly string[]): string[] => {
  const real = tokens.filter(t => t.length > 1 && !STOP.has(t));
  return real.length ? real : [...tokens];
};
