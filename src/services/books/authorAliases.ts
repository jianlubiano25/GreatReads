import { persistentCache } from './cache';
import { authorKey, isUnknownAuthor } from './identity';

/**
 * One writer, several names (a pen name and the legal name: the jacket says T. Kingfisher, Open Library files the book under Ursula Vernon).
 * Nothing here is a list of authors: names are grouped only from what the catalogues themselves say (Open Library's alternate names for an author, or two
 * records of the very same book, same work or edition, that name the author differently), and the group is kept on the device.
 *  - the names of a group count as ONE author when books are matched (identity.ts authorsCompatible);
 *  - the group shows the name a bookshop prints (Apple, Google, a curated or hand-entered record before Open Library), once such a record has been seen.
 */
interface Group { keys: string[]; shown?: string; rank?: number; /** the real spellings seen ("Ursula Vernon", "T. Kingfisher"), for a picker; matching only ever uses `keys` */ names?: string[] }
// v2: groups saved by v1 could hold different people (a title-only Apple lookup once linked two authors of "The Witch"); they are dropped and relearned under the stricter rules
try { localStorage.removeItem('readlife.authorAliases1'); } catch {}
const store = persistentCache<Group>('readlife.authorAliases2', {
  ttl: 365 * 24 * 60 * 60 * 1000,
  max: 400,
  validate: v => !!v && Array.isArray(v.keys) && v.keys.every((k: unknown) => typeof k === 'string'),
});

/** Teach that these names are one author. `shown` (with its source rank) is the name to display, kept only if it outranks the name already shown. */
export function learnAuthorGroup(names: Array<string | undefined>, shown?: { name: string; rank: number }): void {
  const known = names.filter((n): n is string => !!n && !isUnknownAuthor(n));
  const keys = [...new Set(known.map(authorKey).filter(Boolean))];
  if (keys.length < 2 && !(shown && keys.length)) return;
  try {
    let all = [...keys];
    let best: { name: string; rank: number } | undefined = shown && !isUnknownAuthor(shown.name) ? shown : undefined;
    for (const k of keys) {
      const g = store.get(k);
      if (!g) continue;
      all.push(...g.keys);
      if (g.shown && (g.rank ?? 0) > (best?.rank ?? -1)) best = { name: g.shown, rank: g.rank ?? 0 };
    }
    all = [...new Set(all)];
    if (all.length < 2) return;
    if (all.length > 6) return; // nobody writes under that many names: a group this big is two or more people chained together by a wrong link, so it is not grown further
    // real spellings, one per key, the jacket name first
    const spelled = new Map<string, string>();
    for (const n of [...(best ? [best.name] : []), ...known, ...keys.flatMap(k => store.get(k)?.names ?? [])]) { const k = authorKey(n); if (k && !spelled.has(k)) spelled.set(k, n); }
    const names = [...spelled.values()].slice(0, 6);
    for (const k of all) store.set(k, { keys: all, shown: best?.name, rank: best?.rank, names });
  } catch {}
}

/** Are these two author keys names of one author (by what has been learned)? */
export function sameAuthorByAlias(ka: string, kb: string): boolean {
  try { return !!ka && !!kb && !!store.get(ka)?.keys.includes(kb); } catch { return false; }
}

/** The name to show for this author: the jacket name when the group has one, else the name as given. */
export const hasAuthorGroup = (name = ""): boolean => { try { return !isUnknownAuthor(name) && (store.get(authorKey(name))?.keys.length ?? 0) > 1; } catch { return false; } };

export function preferredAuthor(name = ''): string {
  try {
    const g = isUnknownAuthor(name) ? undefined : store.get(authorKey(name));
    return g?.shown && authorKey(g.shown) !== authorKey(name) ? g.shown : name;
  } catch { return name; }
}

/** The names this author is known by (jacket name first), as spelled by the catalogues: for a small "show this name" choice. Empty when no alias group is known. */
export function authorNames(name = ''): string[] {
  try {
    const g = isUnknownAuthor(name) ? undefined : store.get(authorKey(name));
    return g && g.keys.length > 1 ? (g.names ?? []) : [];
  } catch { return []; }
}

/**
 * May these two names join one group? Not when either name already belongs to an alias group that does not include the other: two people each already known by other
 * names are not made one author by a single lookup.
 */
export function canJoinAuthors(a = '', b = ''): boolean {
  try {
    if (isUnknownAuthor(a) || isUnknownAuthor(b)) return false;
    const ka = authorKey(a), kb = authorKey(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    const ga = store.get(ka), gb = store.get(kb);
    if (ga && ga.keys.length > 1 && !ga.keys.includes(kb)) return false;
    if (gb && gb.keys.length > 1 && !gb.keys.includes(ka)) return false;
    return true;
  } catch { return false; }
}

/** Take this author out of its alias group and forget the group (a wrong link): the names are relearned only from solid evidence. Returns true when a group was removed. */
export function unlinkAuthorGroup(name = ''): boolean {
  try {
    const g = store.get(authorKey(name));
    if (!g) return false;
    for (const k of [...g.keys, authorKey(name)]) store.delete(k);
    return true;
  } catch { return false; }
}

/** Forget every learned alias group on this device (for a cleanup or a test). */
export function clearAuthorAliases(): void { try { store.clear(); } catch {} }
