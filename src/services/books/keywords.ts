/**
 * Simple topic / mood / genre mappings for keyword searching (the Keywords button, and a box that holds only a mood such as "cozy").
 *
 * A catalog's subject index knows "Classic literature" and "Mystery fiction", not "cozy" or "fast-paced". Each entry says
 *   search: what else to ask the catalogs for (one extra phrase at most is ever used),
 *   fit:    which words in a book's genre / description / title count as a match for the typed word, so "cozy" also finds "heartwarming",
 *   swap:   the short form used when the word is typed together with others ("classics mystery" is asked as "classic mystery").
 * Pure and tiny on purpose: deterministic, no network, no new dependency.
 */

interface Alias { search: string[]; fit: string[]; swap?: string; classic?: boolean }

const ALIASES: Record<string, Alias> = {
  classic: { search: ['classic literature'], fit: ['classic', 'classics', 'literary', 'timeless', 'canon'], swap: 'classic', classic: true },
  cozy: { search: ['cozy mystery', 'heartwarming'], fit: ['cozy', 'cosy', 'heartwarming', 'charming', 'comforting', 'gentle', 'feelgood'] },
  dark: { search: ['dark fantasy', 'gothic'], fit: ['dark', 'darker', 'gothic', 'noir', 'grim', 'sinister', 'macabre', 'haunting', 'bleak'] },
  hopeful: { search: ['uplifting'], fit: ['hopeful', 'hope', 'uplifting', 'inspiring', 'redemption', 'redemptive', 'heartwarming', 'optimistic'] },
  'fast paced': { search: ['thriller', 'suspense'], fit: ['thriller', 'suspense', 'gripping', 'action', 'adventure', 'pulse', 'fastpaced', 'unputdownable'] },
  mystery: { search: [], fit: ['mystery', 'detective', 'crime', 'whodunit', 'sleuth', 'murder', 'investigation'] },
};
ALIASES.cosy = ALIASES.cozy;
ALIASES.fastpaced = ALIASES['fast paced'];
ALIASES['page turner'] = ALIASES['fast paced'];
ALIASES.uplifting = ALIASES.hopeful;

/** The words that carry a meaning: a plural or "-ies" ending is dropped so "classics" meets "classic" and "mysteries" meets "mystery". */
export const stem = (w: string): string => {
  if (w.length <= 4 || w.endsWith('ss')) return w;
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  return w.endsWith('s') ? w.slice(0, -1) : w;
};

/** One typed word (or the pair "fast paced") and what counts as finding it. */
export interface KeywordGroup {
  /** The typed words */
  text: string;
  /** Words that count as a match, stemmed (always includes the typed word itself) */
  words: string[];
  /** The mapping is "classic": an old, widely read book counts too, because catalogs rarely label books as classics */
  classic: boolean;
  /** The mapping that applied, if any */
  alias?: Alias;
}

/** Split normalised query words into groups, joining two adjacent words when they form one mapped phrase ("fast paced"). */
export function keywordGroups(tokens: readonly string[]): KeywordGroup[] {
  const out: KeywordGroup[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const pair = i + 1 < tokens.length ? `${tokens[i]} ${tokens[i + 1]}` : '';
    const key = pair && ALIASES[pair] ? pair : ALIASES[tokens[i]] ? tokens[i] : ALIASES[stem(tokens[i])] ? stem(tokens[i]) : '';
    const alias = key ? ALIASES[key] : undefined;
    const text = key === pair && pair ? pair : tokens[i];
    if (key === pair && pair) i++;
    const words = [...new Set([...text.split(' '), ...(alias?.fit ?? [])].map(stem))];
    out.push({ text, words, classic: !!alias?.classic, alias });
  }
  return out;
}

/** Does the whole query consist of ONE mapped word or phrase ("cozy", "fast paced", "classics")? Then it is a mood / genre, not a title. */
export const isMoodQuery = (tokens: readonly string[]): boolean => {
  const g = keywordGroups(tokens);
  return g.length === 1 && !!g[0].alias && (g[0].alias.search.length > 0 || g[0].classic);
};

/**
 * What to ask the catalogs for: the typed words first, then at most ONE more phrase from the mapping ("cozy" -> "cozy mystery",
 * "classics mystery" -> "classic mystery"). Never the same phrase twice.
 */
export function keywordPhrases(tokens: readonly string[]): string[] {
  const text = tokens.join(' ');
  const out = [text];
  const groups = keywordGroups(tokens);
  const first = groups.find(g => g.alias && (g.alias.swap || g.alias.search.length));
  if (!first || !first.alias) return out;
  const extra = groups.length === 1
    ? first.alias.search[0]
    : groups.map(g => (g === first ? first.alias!.swap ?? first.text : g.text)).join(' ');
  if (extra && extra !== text) out.push(extra);
  return out;
}
