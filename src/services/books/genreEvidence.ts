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

/** Share of a book's subject entries that name the genre: a work with ONE incidental tag among twenty (The Hobbit's graphic edition) is not of the genre. */
export function termShare(subjects: readonly string[] | undefined, terms: readonly string[]): number {
  const list = (subjects || []).filter(s => typeof s === 'string' && s.trim());
  if (!list.length) return 1; // nothing known: not held against the book
  return list.filter(s => subjectEvidence([s], terms) === 'yes').length / list.length;
}

/** Books ABOUT a subject for scholars (university-press studies, proceedings, catalogues) rather than for readers of the genre. Only a book few readers rated is dropped. */
const ACADEMIC_TITLE = /\b(proceedings|encyclop[a]?edia|handbook|companion to|catalogue?|bibliography|dictionary|symposium|conference|journal of|studies in|museums?|university press|textbook|anthology of (essays|studies))\b/i;
const ACADEMIC_SUBJECT = /(history and criticism|analysis, appreciation|musicolog|ethnomusicolog|bibliograph|congresses|catalogs?\b|study and teaching|dictionaries|encyclopedias|handbooks|manuals|textbooks|exegesis|hermeneutics|church history|performance practice)/i;
export function looksAcademic(b: Pick<Book, 'title' | 'ratingCount'>, subjects: readonly string[] | undefined): boolean {
  if (Number(b.ratingCount) >= 100) return false; // a book many readers rated is for readers
  return ACADEMIC_TITLE.test(b.title) || !!subjects?.some(s => ACADEMIC_SUBJECT.test(s));
}

/** Keeps the books that may belong to the genre. Genres without `subjectTerms` are not filtered. */
export function filterByGenreEvidence(g: Pick<SearchGenre, 'subjectTerms' | 'kind'> & Partial<Pick<SearchGenre, 'readerGenre' | 'minTermShare'>>, books: Book[], subjectsOf: (b: Book) => string[] | undefined = defaultSubjects): Book[] {
  if (!g.subjectTerms?.length) return books;
  return books.filter(b => {
    const subjects = subjectsOf(b);
    if (g.kind === 'nonfiction' && isFictionBySubjects(subjects)) return false;
    if (subjectEvidence(subjects, g.subjectTerms!) === 'no') return false;
    if (g.minTermShare && termShare(subjects, g.subjectTerms!) < g.minTermShare) return false;
    if (g.readerGenre && looksAcademic(b, subjects)) return false;
    return true;
  });
}

/** After ratings are known: a reader genre keeps only books some readers rated (5+ ratings), so unrated scholarly records never fill a shelf. */
export const MIN_READERS = 5;
export function dropUnread(g: Pick<SearchGenre, 'readerGenre'>, books: Book[]): Book[] {
  return g.readerGenre ? books.filter(b => Number(b.ratingCount) >= MIN_READERS) : books;
}

/**
 * Is a freshly built list complete enough to be shared (Fill)? A list passes only with 20+ books, 60%+ of them rated, and, for a genre with `subjectTerms`,
 * subject evidence for 70%+ (a book with no subject list counts half). One rated book never makes a list complete. Returns the first failed check, or undefined.
 */
export const FILL_MIN_BOOKS = 20;
export function fillGateFailure(g: Pick<SearchGenre, 'subjectTerms'>, books: Book[], isRated: (b: Book) => boolean, subjectsOf: (b: Book) => string[] | undefined = defaultSubjects): string | undefined {
  if (books.length < FILL_MIN_BOOKS) return `only ${books.length} books (need ${FILL_MIN_BOOKS})`;
  const rated = books.filter(isRated).length;
  if (rated / books.length < 0.6) return `only ${rated} of ${books.length} rated (need 60%)`;
  if (g.subjectTerms?.length) {
    const score = books.reduce((n, b) => { const e = subjectEvidence(subjectsOf(b), g.subjectTerms!); return n + (e === 'yes' ? 1 : e === 'unknown' ? 0.5 : 0); }, 0);
    if (score / books.length < 0.7) return `only ${Math.round(100 * score / books.length)}% of books name the genre in their own subjects (need 70%)`;
  }
  return undefined;
}

function defaultSubjects(b: Book): string[] | undefined {
  const all = providerFactsFor({ id: b.id === undefined ? undefined : String(b.id), identity: b.identity }).flatMap(f => [...(f.subjects || []), ...(f.genres || [])]);
  return all.length ? all : undefined;
}
