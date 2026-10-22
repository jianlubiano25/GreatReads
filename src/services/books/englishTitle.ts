import type { Book } from '../../types';
import { persistentCache } from './cache';
import { bookKey, isUnknownAuthor, knownEnglishTitle, primaryAuthor, titleKey } from './identity';
import { titleLooksForeign } from './language';
import { resolveBook } from './resolve';
import { findOpenLibrary } from './sources/openLibrary';
import { lookupApple } from './sources/appleBooks';
import { hasAuthorGroup, learnAuthorGroup, preferredAuthor } from './authorAliases';

/**
 * Names as GreatReads shows them: the book's ENGLISH title ("変な絵" -> "Strange Pictures") and the author name printed on the jacket (T. Kingfisher, not her legal
 * name). Both are applied when a book is drawn (displayBook: instant, from what is already known), never by editing the saved record, so nothing is lost and a
 * restored backup shows the same. What is not known yet is looked up in the background (refreshNames) and shows the next time the list is drawn.
 */
const titles = persistentCache<string>('readlife.englishTitles1', { ttl: 365 * 24 * 60 * 60 * 1000, max: 300, validate: v => typeof v === 'string' });
const checked = persistentCache<number>('readlife.namesChecked1', { ttl: 30 * 24 * 60 * 60 * 1000, max: 500, validate: v => typeof v === 'number' });

/** The English title of a non-English title, from what is known right now ('' when unknown). No network. */
export const englishTitleNow = (title = ''): string => {
  if (!titleLooksForeign(title)) return '';
  try { return knownEnglishTitle(title) || titles.get(titleKey(title)) || ''; } catch { return ''; }
};

/** The book as it is shown: English title and jacket author name when known; the same object when nothing changes. */
export function displayBook<T extends Book>(b: T): T {
  let out = b;
  const en = englishTitleNow(b.title);
  if (en && en !== b.title) out = { ...out, title: en, originalTitle: b.originalTitle || b.title };
  const author = preferredAuthor(b.author);
  if (author !== b.author) out = { ...out, author };
  return out;
}

/** English title from the other sites that matched the book or Open Library's English editions (resolveBook), else the known list. '' when there is none. */
export async function englishTitleOf(book: Pick<Book, 'id' | 'title' | 'author' | 'identity'>): Promise<string> {
  if (!titleLooksForeign(book.title)) return '';
  const known = knownEnglishTitle(book.title);
  if (known) return known;
  const id = book.identity || {};
  const r = await resolveBook({ title: book.title, author: isUnknownAuthor(book.author) ? '' : primaryAuthor(book.author), isbn: id.isbn13 || id.isbn10, fallbackId: book.id }).catch(() => null);
  const t = r?.book.title?.trim() || '';
  return t && !titleLooksForeign(t) && titleKey(t) !== titleKey(book.title) ? t : '';
}

/**
 * Background, once a month per book: find its English title, and whether its author goes by another name. Open Library says whether the author has other names
 * (that is learned while it is searched); only then is Apple asked what name the book's jacket prints. Returns true when something was learned (redraw).
 */
export async function refreshNames(book: Pick<Book, 'id' | 'title' | 'author' | 'identity'>): Promise<boolean> {
  const key = bookKey(book as any);
  try { if (checked.get(key)) return false; } catch {}
  let changed = false;
  const en = await englishTitleOf(book);
  if (en) { try { titles.set(titleKey(book.title), en); } catch {} changed = true; }
  if (!isUnknownAuthor(book.author)) {
    const q = { title: en || book.title, author: primaryAuthor(book.author) };
    await findOpenLibrary(q).catch(() => null);
    if (hasAuthorGroup(book.author)) {
      const apple = (await lookupApple(q).catch(() => ({ hit: null }))).hit;
      if (apple?.book.author) { const before = preferredAuthor(book.author); learnAuthorGroup([book.author, apple.book.author], { name: apple.book.author, rank: 3 }); changed = changed || preferredAuthor(book.author) !== before; }
    }
  }
  try { checked.set(key, Date.now()); } catch {}
  return changed;
}
