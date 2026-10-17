/**
 * The searches the reader has actually used (pressed Enter on, or opened a book from), newest first, so the Search tab can offer them again.
 * A few short strings in localStorage; failures (private mode, full storage) are silent.
 */
const KEY = 'readlife.recentSearches';
export const RECENT_SEARCH_MAX = 8;

const clean = (q: string) => q.trim().replace(/\s+/g, ' ');

export function getRecentSearches(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && !!clean(x)).slice(0, RECENT_SEARCH_MAX) : [];
  } catch { return []; }
}

const save = (list: string[]) => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {} };

export function rememberSearch(q: string): string[] {
  const text = clean(q);
  if (text.length < 2) return getRecentSearches();
  const list = [text, ...getRecentSearches().filter(x => x.toLowerCase() !== text.toLowerCase())].slice(0, RECENT_SEARCH_MAX);
  save(list);
  return list;
}

export function forgetSearch(q: string): string[] {
  const list = getRecentSearches().filter(x => x.toLowerCase() !== clean(q).toLowerCase());
  save(list);
  return list;
}

export function clearRecentSearches(): string[] { save([]); return []; }
