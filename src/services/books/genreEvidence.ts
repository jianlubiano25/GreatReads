/**
 * Does a book's OWN subject list say it belongs to a genre? (C18)
 * Open Library's subject search returns the most-read works that carry the word anywhere, so "sports" brought Harry Potter, "music" Green Eggs and Ham,
 * "religion" Dracula and "graphic novels" Sapiens. A book now joins a genre's list only when one of its own subjects names the genre
 * (`SearchGenre.subjectTerms`), and a nonfiction genre drops a book whose subjects call it fiction. A book with no subject list at all is kept:
 * nothing is known against it. Pure; the subjects come from what the providers already returned (providerFacts).
 */
import type { Book } from '../../types';
import type { SearchGenre } from '../../data/searchGenres';
import { providerFactsFor } from './providerFacts';

const words = (s: string): string[] => s.toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
const stem = (w: string) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
/** a subject that says the book is fiction (checked only for nonfiction genres) */
const FICTION = /\b(fiction|novels?|fantasy|horror tales|short stories|stories in rhyme|juvenile literature|fairy tales)\b/i;

export type Evidence = 'yes' | 'no' | 'unknown';

/** yes: some subject names every word of one term (word starts match: "sport" fits "Sports", "olymp" fits "Olympic games"); no: subjects exist and none does; unknown: no subjects. */
export function subjectEvidence(subjects: readonly string[] | undefined, terms: readonly string[]): Evidence {
  const list = (subjects || []).filter(s => typeof s === 'string' && s.trim());
  if (!list.length) return 'unknown';
  const entries = list.map(words);
  for (const term of terms) {
    const tw = words(term).map(stem);
    if (tw.length && entries.some(e => tw.every(t => e.some(w => w.startsWith(t))))) return 'yes';
  }
  return 'no';
}

export const isFictionBySubjects = (subjects: readonly string[] | undefined): boolean => !!subjects?.some(s => FICTION.test(s));

/** Keeps the books that may belong to the genre. Genres without `subjectTerms` are not filtered. */
export function filterByGenreEvidence(g: Pick<SearchGenre, 'subjectTerms' | 'kind'>, books: Book[], subjectsOf: (b: Book) => string[] | undefined = defaultSubjects): Book[] {
  if (!g.subjectTerms?.length) return books;
  return books.filter(b => {
    const subjects = subjectsOf(b);
    if (g.kind === 'nonfiction' && isFictionBySubjects(subjects)) return false;
    return subjectEvidence(subjects, g.subjectTerms!) !== 'no';
  });
}

function defaultSubjects(b: Book): string[] | undefined {
  const all = providerFactsFor({ id: b.id === undefined ? undefined : String(b.id), identity: b.identity }).flatMap(f => [...(f.subjects || []), ...(f.genres || [])]);
  return all.length ? all : undefined;
}
