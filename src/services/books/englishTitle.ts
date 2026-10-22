import type { Book } from '../../types';
import { isUnknownAuthor, knownEnglishTitle, primaryAuthor, titleKey } from './identity';
import { titleLooksForeign } from './language';
import { resolveBook } from './resolve';

/**
 * GreatReads shows English titles. A saved book whose title is in another language ("変な絵") gets its English one: the other sites that matched the book, or
 * Open Library's English editions (resolveBook does this, from its saved result when there is one), else the short list of known titles. '' when there is nothing to
 * change: an English title, no English title found anywhere, or a lookup that failed (it is simply asked again next launch). Nothing here changes the book's id.
 */
export async function englishTitleOf(book: Pick<Book, 'id' | 'title' | 'author' | 'identity'>): Promise<string> {
  if (!titleLooksForeign(book.title)) return '';
  const known = knownEnglishTitle(book.title);
  if (known) return known;
  const id = book.identity || {};
  const r = await resolveBook({ title: book.title, author: isUnknownAuthor(book.author) ? '' : primaryAuthor(book.author), isbn: id.isbn13 || id.isbn10, fallbackId: book.id }).catch(() => null);
  const t = r?.book.title?.trim() || '';
  return t && !titleLooksForeign(t) && titleKey(t) !== titleKey(book.title) ? t : '';
}
