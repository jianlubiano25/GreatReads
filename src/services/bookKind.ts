import type { Book } from '../types';

export type BookKind = 'fiction' | 'nonfiction';

const NONFICTION = /non-?fiction|memoir|autobiograph|biograph|self-?help|philosoph|psycholog|essay|journalis|history|science|business|econom|politic|religio|spiritual|travel|cook|health|wellness|nature|true crime|career|creativity|productivity|reference/i;
const FICTION = /fiction|novel|fantasy|romance|romcom|mystery|thriller|crime|horror|dystopi|myth|satire|classic|literary|epistolary|speculative|sci-?fi|adventure|short stories|poetry|translated/i;

export function bookKind(book: Pick<Book, 'genre'>): BookKind {
  const genre = (book.genre || '').trim();
  if (/non-?fiction/i.test(genre)) return 'nonfiction';
  if (/historical fiction|science fiction|sci-?fi|fiction/i.test(genre)) return 'fiction';
  if (NONFICTION.test(genre)) return 'nonfiction';
  if (FICTION.test(genre)) return 'fiction';
  return 'fiction';
}