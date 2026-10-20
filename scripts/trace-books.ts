/**
 * Shows, for a list of books, which edition the app settles on and what it would show: title, About, cover, and the ids it is pinned to.
 * Problems are flagged (a title or About that is not English, no cover, a cover that is not Apple's / a Google front / an Open Library edition's).
 * Uses the app's real resolver and the real Apple / Google / Open Library, so run it from your own computer:
 *
 *   npm run trace:books                                  (the books below)
 *   npm run trace:books -- "Dear Debbie|Freida McFadden" "The Stranger|Albert Camus|9780679720201"     (your own: title|author|isbn)
 *
 * Optional: GOOGLE_BOOKS_API_KEY=... for Google's higher quota (same as npm run prefetch:store).
 */
import { resolveBook } from '../src/services/books/resolve';
import { lookupSummary } from '../src/services/books/details';
import { looksEnglish, titleLooksForeign } from '../src/services/books/language';
import { hasRealSummary, isAppleCoverUrl } from '../src/services/books/model';

const DEFAULT = ['Dear Debbie|Freida McFadden', 'The Witch|Freida McFadden', 'Carl’s Doomsday Scenario|Matt Dinniman', 'The Stranger|Albert Camus', 'L’Étranger|Albert Camus', 'Dune|Frank Herbert', 'Verity|Colleen Hoover', 'Piranesi|Susanna Clarke', 'The Let Them Theory|Mel Robbins', 'One Hundred Years of Solitude|Gabriel García Márquez'];
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const list = (args.length ? args : DEFAULT).map(s => { const [title, author = '', isbn = ''] = s.split('|'); return { title, author, isbn }; });

const coverKind = (b: any) => (b.coverUrl ? (isAppleCoverUrl(b.coverUrl) ? 'apple' : /books\.google|googleusercontent/.test(b.coverUrl) ? 'google' : 'link') : b.coverId ? 'openlibrary' : 'NONE');
let problems = 0;
for (const q of list) {
  const r = await resolveBook({ ...q, apple: true });
  if (!r) { console.log(`✗ ${q.title}: not found by any source\n`); problems++; continue; }
  const b = r.book;
  const about = hasRealSummary(b.summary) ? b.summary : await lookupSummary(b); // what the book info would end up showing
  const flags: string[] = [];
  if (titleLooksForeign(b.title)) flags.push('title looks foreign');
  if (!about || !looksEnglish(about)) flags.push('About missing or not English');
  if (coverKind(b) === 'NONE') flags.push('no cover');
  problems += flags.length ? 1 : 0;
  const id = b.identity || {};
  console.log(`${flags.length ? '⚠' : '✓'} ${b.title}  —  ${b.author}`);
  console.log(`   cover: ${coverKind(b)}   isbn13: ${id.isbn13 || '-'}   google: ${id.gbVolume || '-'}   openlibrary: ${id.olWork || '-'}`);
  console.log(`   About: ${(about || '').slice(0, 110).replace(/\s+/g, ' ') || '(none)'}`);
  if (flags.length) console.log(`   PROBLEM: ${flags.join('; ')}`);
  console.log('');
}
console.log(problems ? `${problems} of ${list.length} books need a look.` : `All ${list.length} books look right.`);
setTimeout(() => process.exit(0), 600);
