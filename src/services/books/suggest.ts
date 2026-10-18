import type { Book } from '../../types';
import { SEARCH_GENRES } from '../../data/searchGenres';
import { DEFAULT_BOOKS } from '../../data/defaultBooks';
import { normQ } from './query';

/**
 * "Did you mean...": a typed word that is not a word we know, but is one letter off a word we do, is offered back corrected ("fanatsy" -> "fantasy").
 * The words we know are the genres, the hand-picked books, and the titles and authors of the reader's own books. Pure and offline: nothing is fetched.
 */
const words = (text: string): string[] => normQ(text).split(' ').filter(Boolean);

/** Edit distance counting a swap of two neighbouring letters as one edit (the commonest typo). `max` stops early. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const MIN_LEN = 4;
const addWords = (set: Set<string>, text: string) => { for (const w of words(text)) if (w.length >= MIN_LEN && !/^\d+$/.test(w)) set.add(w); };

let base: Set<string> | null = null;
function baseVocab(): Set<string> {
  if (base) return base;
  base = new Set();
  for (const g of SEARCH_GENRES) {
    addWords(base, g.label); addWords(base, g.query);
    for (const s of g.subgenres) { addWords(base, s.label); addWords(base, s.query); }
    for (const [t, a] of g.picks ?? []) { addWords(base, t); addWords(base, a); }
  }
  for (const b of DEFAULT_BOOKS) { addWords(base, b.title); addWords(base, b.author); }
  return base;
}

const own = new WeakMap<readonly Book[], Set<string>>();
export function suggestionVocab(known: readonly Book[] = []): Set<string> {
  let v = own.get(known);
  if (!v) {
    v = new Set(baseVocab());
    for (const b of known) { addWords(v, b.title); addWords(v, b.author); }
    own.set(known, v);
  }
  return v;
}

/** The query with every misspelt word put right, or null when nothing needed (or could be) changed. */
export function didYouMean(text: string, vocab: ReadonlySet<string>): string | null {
  const typed = words(text);
  if (!typed.length) return null;
  let changed = false;
  const out = typed.map(w => {
    if (w.length < MIN_LEN || vocab.has(w) || /\d/.test(w)) return w;
    const allow = w.length >= 8 ? 2 : 1;
    let best = ''; let bestD = allow + 1;
    for (const c of vocab) {
      if (c[0] !== w[0] && c[1] !== w[1]) continue; // a typo rarely changes the first two letters at once
      const dist = editDistance(w, c, allow);
      if (dist < bestD || (dist === bestD && best && c < best)) { best = c; bestD = dist; }
    }
    if (best && bestD <= allow) { changed = true; return best; }
    return w;
  });
  return changed ? out.join(' ') : null;
}
