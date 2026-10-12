import type { Book } from '../../types';

/** Builders and tiny helpers shared by every source, so a book looks the same whichever API it came from. */

export const difficultyFor = (pages: number) => (!pages ? 0 : pages > 450 ? 3 : pages > 250 ? 2 : 1);

/** Placeholder summaries older versions saved; recognised so a real description can replace them. */
export const hasRealSummary = (t?: string) => !!t && t.length >= 60 && !/^(A distinguished work by|A book by) /.test(t) && !/^.+ by .+\.$/.test(t);
export const isKnownGenre = (g?: string) => !!g && !/^(book|general)$/i.test(g);

export const plainText = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** Rating quality that cannot be gamed by a handful of votes: pulled toward a typical 3.8 until there are plenty of ratings. */
export function shrunkRating(avg?: number, count?: number, prior = 3.8, weight = 40): number {
  if (!avg) return 0;
  const n = Math.max(0, count || 0);
  return (avg * n + prior * weight) / (n + weight);
}

/** A complete Book with sensible blanks. Every source adapter goes through this. */
export function makeBook(p: Partial<Book> & Pick<Book, 'id' | 'title'>): Book {
  const author = p.author || 'Unknown Author';
  const pages = p.pageCount || 0;
  return {
    shelf: 'mine',
    difficulty: difficultyFor(pages),
    isOnDevice: false,
    year: '',
    genre: 'Book',
    summary: `A distinguished work by ${author}.`,
    authorBio: '',
    pageCount: pages,
    spineColor: '#6b6f80',
    addedAt: Date.now(),
    ...p,
    author,
  };
}

/**
 * Best-guess genre label from subject/category strings. Returns '' when nothing matches.
 * Matches whole words only (so "software" is not "war" and "magic realism" is not fantasy).
 */
export function genreFromSubjects(subjects: string[] = []): string {
  const t = subjects.join(' | ').toLowerCase();
  if (!t) return '';
  const fiction = t.replace(/non-?fiction/g, '');
  const any = (re: RegExp, text = t) => re.test(text);
  if (any(/\b(memoirs?|autobiograph\w*|biograph(y|ies))\b/)) return 'Memoir';
  if (any(/\b(self[- ]help|self[- ]improvement|personal (development|growth)|habits?|motivational?)\b/)) return 'Self-help';
  if (any(/\b(romance|love stor(y|ies))\b/, fiction)) return 'Romance';
  if (any(/\b(fantasy|dragons?|wizards?)\b/, fiction)) return 'Fantasy';
  if (any(/\b(science fiction|sci-?fi)\b/, fiction)) return 'Science fiction';
  if (any(/\b(mystery|mysteries|thrillers?|detectives?|suspense)\b/, fiction)) return 'Mystery';
  if (any(/\bhistorical fiction\b/, fiction)) return 'Historical fiction';
  if (any(/\b(fiction|novels?)\b/, fiction)) return 'Fiction';
  if (any(/\b(business|economics?|entrepreneur\w*|finance)\b/)) return 'Business';
  if (any(/\b(history|wars?|politic\w*)\b/)) return 'History';
  if (any(/\b(philosoph\w*|religion|spiritual\w*)\b/)) return 'Philosophy';
  if (any(/\b(science|nature|technology|mathematic\w*)\b/)) return 'Science';
  return '';
}
