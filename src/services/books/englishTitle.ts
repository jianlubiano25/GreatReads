import type { Book } from '../../types';
import { persistentCache } from './cache';
import { bookKey, isUnknownAuthor, knownEnglishTitle, primaryAuthor, titleKey } from './identity';
import { titleLooksForeign } from './language';
import { resolveBook } from './resolve';
import { findOpenLibrary } from './sources/openLibrary';
import { appleJacketAuthor, lookupApple } from './sources/appleBooks';
import { authorNames, hasAuthorGroup, learnAuthorGroup, preferredAuthor } from './authorAliases';

/**
 * Names as GreatReads shows them: the book's ENGLISH title ("変な絵" -> "Strange Pictures") and the author name printed on the jacket (T. Kingfisher, not her legal
 * name). Both are applied when a book is drawn (displayBook: instant, from what is already known), never by editing the saved record, so nothing is lost and a
 * restored backup shows the same. What is not known yet is looked up in the background (refreshNames) and shows the next time the list is drawn.
 */
const titles = persistentCache<string>('readlife.englishTitles1', { ttl: 365 * 24 * 60 * 60 * 1000, max: 300, validate: v => typeof v === 'string' });
const checked = persistentCache<number>('readlife.namesChecked2', { ttl: 30 * 24 * 60 * 60 * 1000, max: 500, validate: v => typeof v === 'number' });

/** The English title of a non-English title, from what is known right now ('' when unknown). No network. A title on the known list needs no language guess. */
export const englishTitleNow = (title = ''): string => {
  try {
    const known = knownEnglishTitle(title);
    if (known) return known;
    return titleLooksForeign(title) ? titles.get(titleKey(title)) || '' : '';
  } catch { return ''; }
};

/* ---- "show this name instead" (owner only in the UI): a display choice for ONE book on this device, like a cover pick. The saved title / author are never touched. ---- */
export interface NameChoice { title?: 'original'; author?: string }
const choices = persistentCache<NameChoice>('readlife.nameChoices1', { ttl: 5 * 365 * 24 * 60 * 60 * 1000, max: 300, validate: v => !!v && typeof v === 'object' && (v.title === undefined || v.title === 'original') && (v.author === undefined || typeof v.author === 'string') });
const choiceKey = (b: Pick<Book, 'title' | 'originalTitle'>): string => titleKey(b.originalTitle || b.title);
const listeners = new Set<() => void>();
/** Called when a name choice changes (so lists redraw). Returns the unsubscribe. */
export const subscribeNames = (fn: () => void): (() => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const nameChoiceOf = (b: Pick<Book, 'title' | 'originalTitle'>): NameChoice => { try { return choices.get(choiceKey(b)) || {}; } catch { return {}; } };

/** Remember (or, with `{}`, forget) which title / author to show for this book. `title: 'original'` shows the catalogue title instead of the English one. */
export function setNameChoice(b: Pick<Book, 'title' | 'originalTitle'>, choice: NameChoice): void {
  try {
    const k = choiceKey(b);
    if (!k) return;
    if (choice.title || choice.author) choices.set(k, { ...(choice.title ? { title: choice.title } : {}), ...(choice.author ? { author: choice.author } : {}) });
    else choices.delete(k);
  } catch {}
  listeners.forEach(fn => { try { fn(); } catch {} });
}

/** What the owner can pick between for this book: the English and the original title (only when an English one is known), the jacket and the other names of the author. */
export function nameAlternates(b: Pick<Book, 'title' | 'originalTitle' | 'author'>): { titles: string[]; authors: string[] } {
  const raw = b.originalTitle || b.title;
  const en = englishTitleNow(raw);
  return { titles: en && titleKey(en) !== titleKey(raw) ? [en, raw] : [], authors: authorNames(b.author) };
}

/** The book as it is shown: English title and jacket author name when known (or the owner's choice for this book); the same object when nothing changes. */
export function displayBook<T extends Book>(b: T): T {
  let out = b;
  const pick = nameChoiceOf(b);
  if (pick.title === 'original') {
    if (b.originalTitle && b.title !== b.originalTitle) out = { ...out, title: b.originalTitle };
  } else {
    const en = englishTitleNow(b.title);
    if (en && en !== b.title) out = { ...out, title: en, originalTitle: b.originalTitle || b.title };
  }
  const author = pick.author || preferredAuthor(b.author);
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
export async function refreshNames(book: Pick<Book, 'id' | 'title' | 'author' | 'identity'> & Partial<Pick<Book, 'year'>>): Promise<boolean> {
  const key = bookKey(book as any);
  try { if (checked.get(key)) return false; } catch {}
  let changed = false;
  const en = await englishTitleOf(book);
  if (en) { try { titles.set(titleKey(book.title), en); } catch {} changed = true; } // under the ORIGINAL title, so the next draw is instant
  if (!isUnknownAuthor(book.author)) {
    const q = { title: en || book.title, author: primaryAuthor(book.author) };
    await findOpenLibrary(q).catch(() => null); // learns the author's other names, when Open Library lists any
    const before = preferredAuthor(book.author);
    // The jacket name wins. With a known alias group Apple can be asked for this author directly; without one (Open Library often has no alternate names) it is asked by
    // title alone, and accepted only when unambiguous (see appleJacketAuthor) and, when both years are known, from the same year.
    let jacket = hasAuthorGroup(book.author) ? (await lookupApple(q).catch(() => ({ hit: null }))).hit?.book.author || '' : '';
    if (!jacket) {
      const a = await appleJacketAuthor(q.title).catch(() => null);
      const y = String(book.year || '').slice(0, 4);
      if (a && !isUnknownAuthor(a.author) && (!/^\d{4}$/.test(y) || !a.year || Math.abs(Number(y) - Number(a.year)) <= 1)) jacket = a.author;
    }
    if (jacket && !isUnknownAuthor(jacket)) learnAuthorGroup([book.author, jacket], { name: jacket, rank: 3 });
    changed = changed || preferredAuthor(book.author) !== before;
  }
  try { checked.set(key, Date.now()); } catch {}
  return changed;
}
