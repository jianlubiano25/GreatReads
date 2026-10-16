/**
 * Your own Library tags and shelves.
 * - A "tag" is a chip above the Library; tapping it shows only the books you put in it.
 * - A "shelf" is a row of books (like Reading now / Up next) that you name and fill yourself.
 * Kept in localStorage on this device under their own key, so they never touch your reading data.
 */
export interface Collection {
  id: string;
  name: string;
  kind: 'tag' | 'shelf';
  /** Ids (as text) of the Library books in it */
  bookIds: string[];
}

export const COLLECTIONS_KEY = 'readlife.libcollections1';
const MAX_COLLECTIONS = 60;
const MAX_NAME = 40;

/** Repairs whatever was saved: wrong shapes, duplicate ids, missing names. Never throws. */
export function sanitizeCollections(raw: unknown): Collection[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Collection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    const name = typeof o.name === 'string' ? o.name.trim().slice(0, MAX_NAME) : '';
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const ids = Array.isArray(o.bookIds) ? o.bookIds.filter((x): x is string => typeof x === 'string') : [];
    out.push({ id, name, kind: o.kind === 'shelf' ? 'shelf' : 'tag', bookIds: [...new Set(ids)] });
    if (out.length >= MAX_COLLECTIONS) break;
  }
  return out;
}

export function loadCollections(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Collection[] {
  try {
    const text = storage?.getItem(COLLECTIONS_KEY);
    return text ? sanitizeCollections(JSON.parse(text)) : [];
  } catch {
    return [];
  }
}

export function saveCollections(list: Collection[], storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(COLLECTIONS_KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: the lists simply are not kept */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export const newCollectionId = (): string => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The books of `c` that are still in the Library, in the order you added them. */
export function booksOf<T extends { id: string | number }>(c: Collection, books: T[]): T[] {
  const byId = new Map(books.map(b => [String(b.id), b]));
  return c.bookIds.map(id => byId.get(id)).filter((b): b is T => !!b);
}
