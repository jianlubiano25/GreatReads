/**
 * Fiction or non-fiction? Decided from the genre / subject / category words the sources actually gave (Open Library subjects,
 * Google categories, Apple genres, or a NYT list name). It does not guess from titles: when the words are silent, the answer
 * is 'unknown' and the book is left out of a fiction/non-fiction shelf rather than put in the wrong one.
 */
export type BookKind = 'fiction' | 'nonfiction' | 'unknown';

const NONFICTION = /\b(non-?fiction|memoirs?|autobiograph\w*|biograph\w*|self[- ]help|self[- ]improvement|personal (development|growth)|history|historical (account|analysis)|essays?|true crime|politic\w*|business|economics?|finance|investing|psycholog\w*|philosoph\w*|religion|spiritual\w*|science|nature|technology|mathematic\w*|health|fitness|cook(ing|books?)|travel|parenting|relationships?|reference|education|journalism|current events|sociolog\w*|self-?improvement|productivity|mindfulness|wellness)\b/i;
const FICTION = /\b(fiction|novels?|fantasy|romance|romcom|mystery|mysteries|thrillers?|suspense|crime fiction|horror|sci-?fi|science fiction|dystopi\w*|literary|historical fiction|short stor(y|ies)|fairy ?tales?|fables?|myths?|legends?|graphic novels?|comics|manga|satire|westerns?|detective)\b/i;

/** Apple's genre names use "&" and a few special words ("Fiction & Literature", "Mysteries & Thrillers", "Biographies & Memoirs"). */
export function kindOfWords(words: string[] = []): BookKind {
  const text = words.join(' | ');
  if (!text.trim()) return 'unknown';
  const nonfictionFlag = /\bnon-?fiction\b/i.test(text);
  const fictionText = text.replace(/non-?fiction/gi, ' ');
  const f = FICTION.test(fictionText);
  const n = nonfictionFlag || NONFICTION.test(fictionText);
  if (nonfictionFlag && !/\b(fiction|novel)\b/i.test(fictionText)) return 'nonfiction';
  if (f && !n) return 'fiction';
  if (n && !f) return 'nonfiction';
  if (f && n) {
    // both appear (e.g. "Biography & Autobiography | Fiction"): the more specific non-fiction words win unless the label says it is a novel
    return /\b(novels?|literary|romance|fantasy|thrillers?|mystery|fiction)\b/i.test(fictionText) && !/\b(memoirs?|biograph\w*|essays?|self[- ]help)\b/i.test(fictionText) ? 'fiction' : 'nonfiction';
  }
  return 'unknown';
}

/** Combine the evidence from several sources: the majority wins, a tie is 'unknown'. */
export function kindFromSources(...wordLists: (string[] | undefined)[]): BookKind {
  const votes = { fiction: 0, nonfiction: 0 };
  for (const w of wordLists) {
    const k = kindOfWords(w);
    if (k !== 'unknown') votes[k]++;
  }
  return votes.fiction === votes.nonfiction ? 'unknown' : votes.fiction > votes.nonfiction ? 'fiction' : 'nonfiction';
}
