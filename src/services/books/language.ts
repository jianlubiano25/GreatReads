/**
 * English preference. GreatReads shows English titles, descriptions and author bios: a book whose catalogue record is in another language
 * (Open Library lists Camus's novel as "L’étranger", a Spanish blurb, a French bio) is replaced by an English one when any source has it.
 * No language model and no extra request: a conservative word-list check. When unsure the text is treated as English (nothing is replaced).
 */

const EN = new Set('the and of to in is that it with as for was his her he she by on at from this but an be are has had who their they not have were which been its one also into after about when more than other all'.split(' '));
const FOREIGN = new Set((
  // French
  'le la les des du un une et est que qui dans pour par sur avec ce cette ses sont au aux il elle ils elles pas plus mais ou où comme sa son leurs nous vous été être très ' +
  // Spanish / Portuguese
  'el los las del una por con para es se su sus lo al como pero más muy fue han hay não uma os um em dos das ' +
  // German / Dutch
  'der die das und ist nicht mit von ein eine zu auf den dem des auch für sich wie er sie es im ' +
  'het een van op te voor zijn niet maar ' +
  // Italian
  'il di che per sono da gli nel della delle degli'
).split(' '));

const words = (t: string): string[] => t.toLowerCase().normalize('NFC').split(/[^\p{L}\p{M}]+/u).filter(Boolean);

/** Share of letters that are not Latin script (Cyrillic, CJK, Arabic, ...). */
function nonLatinShare(t: string): number {
  const letters = t.match(/\p{L}/gu);
  if (!letters || !letters.length) return 0;
  return letters.filter(c => !/\p{Script=Latin}/u.test(c)).length / letters.length;
}

/** Is this running text (a description, an author bio) English? Short text and unclear text count as English. */
export function looksEnglish(text = ''): boolean {
  if (nonLatinShare(text) > 0.3) return false;
  const w = words(text);
  if (w.length < 8) return true;
  const en = w.filter(x => EN.has(x)).length;
  const foreign = w.filter(x => FOREIGN.has(x)).length;
  return !(foreign / w.length > 0.12 && en < foreign);
}

const FOREIGN_LEADERS = new Set('le la les l el los las der die das il lo gli un une des du ein eine een het um uma'.split(' '));

/**
 * Does a TITLE look like it is not English ("L’étranger", "Der Process", "Cien años de soledad", a non-Latin script)? Only a hint that an English title
 * is worth looking for: an English title with an accent ("Pokémon") passes the check and the lookup simply finds the same title.
 */
export function titleLooksForeign(title = ''): boolean {
  if (!title.trim()) return false;
  if (nonLatinShare(title) > 0.3) return true;
  if (/[àâäçèêëîïôöùûüÿñãõìòœæß¿¡]/i.test(title)) return true; // letters English words almost never carry (é is left out: "café", "Pokémon", "fiancé")
  const w = words(title);
  if (w.length >= 2 && FOREIGN_LEADERS.has(w[0]) && !EN.has(w[1])) return true; // "L’étranger" (l + etranger), "Der Process"
  const foreign = w.filter(x => FOREIGN.has(x)).length;
  return w.length >= 3 && foreign >= 2 && foreign > w.filter(x => EN.has(x)).length;
}
