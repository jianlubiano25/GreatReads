import { BUILTIN_DICTIONARY } from '../data/defaultWords';

export interface LookupResult {
  word: string;
  phonetic: string;
  partOfSpeech: string;
  definition: string;
  definitions: string[];
  example: string;
  etymology?: string;
  synonyms: string[];
  audioUrl?: string;
  source: 'builtin' | 'dictionary-api' | 'wiktionary' | 'fallback';
}

/**
 * Clean and normalize a search query
 */
export function cleanWord(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^["'“‘(]+|[)"'”’,.!?]+$/g, '');
}

/**
 * Look up a word, fast: saved answers return at once, the built-in list is instant, then the two online dictionaries (Free Dictionary first; Wiktionary
 * starts on its own if the first fails or stalls). Nothing waits on the pronunciation for long, and word-forms look up their roots side by side.
 */
const CACHE_MAX = 200;
const answers = new Map<string, LookupResult>(); // this session only: a repeat search is instant
const inFlight = new Map<string, Promise<LookupResult | null>>(); // the same word asked twice at once is one request
const remember = (word: string, r: LookupResult) => {
  if (answers.size >= CACHE_MAX) answers.delete(answers.keys().next().value as string);
  answers.set(word, r);
};

function fromBuiltin(word: string): LookupResult | null {
  if (!Object.hasOwn(BUILTIN_DICTIONARY, word)) return null;
  const item = BUILTIN_DICTIONARY[word];
  return {
    word,
    phonetic: item.phonetic,
    partOfSpeech: item.partOfSpeech,
    definition: item.definition,
    definitions: item.definitions || [item.definition],
    example: item.example,
    etymology: item.etymology,
    synonyms: item.synonyms || [],
    source: 'builtin',
  };
}

/** A fetch that gives up after `ms` (or when `outer` aborts). */
async function getJson(url: string, ms: number, outer?: AbortSignal, headers?: Record<string, string>): Promise<any | null> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  const onOuter = () => c.abort();
  outer?.addEventListener('abort', onOuter);
  try {
    const res = await fetch(url, { signal: c.signal, headers });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
    outer?.removeEventListener('abort', onOuter);
  }
}

/** The pronunciation is a nicety: wait for it a moment, never for seconds. */
const ipaSoon = (word: string): Promise<string> => Promise.race([fetchIpa(word), new Promise<string>(r => setTimeout(() => r(''), 1500))]);

async function fetchFreeDict(word: string): Promise<LookupResult | null> {
  const data = await getJson(`https://api.dictionaryapi.dev/v2/entries/en/${encodeURIComponent(word)}`, 4000);
  if (!Array.isArray(data) || data.length === 0) return null;
  const entry = data[0];
  const phoneticsList = data.flatMap((e: any) => e.phonetics || []);
  const phoneticObj = phoneticsList.find((p: any) => p.text) || {};
  const audioObj =
    phoneticsList.find((p: any) => /-us\.mp3/.test(p.audio || '')) ||
    phoneticsList.find((p: any) => p.audio && p.audio.length > 0);

  const meanings = entry.meanings || [];
  const partOfSpeech = (meanings[0] || {}).partOfSpeech || 'noun';
  const allDefs: string[] = [];
  let firstExample = '';
  const allSynonyms: string[] = [];
  for (const m of meanings) {
    if (Array.isArray(m.synonyms)) allSynonyms.push(...m.synonyms);
    if (Array.isArray(m.definitions)) {
      for (const d of m.definitions) {
        if (d.definition) allDefs.push(d.definition);
        if (d.example && !firstExample) firstExample = d.example;
        if (Array.isArray(d.synonyms)) allSynonyms.push(...d.synonyms);
      }
    }
  }
  const text = entry.phonetic || data.find((e: any) => e.phonetic)?.phonetic || phoneticObj.text;
  return {
    word: entry.word || word,
    phonetic: text || (await ipaSoon(word)) || '',
    partOfSpeech,
    definition: allDefs[0] || 'Definition unavailable.',
    definitions: allDefs.slice(0, 4),
    example: firstExample || '',
    etymology: entry.origin || undefined,
    synonyms: Array.from(new Set(allSynonyms)).slice(0, 6),
    audioUrl: audioObj?.audio ? String(audioObj.audio).replace(/^\/\//, 'https://') : undefined,
    source: 'dictionary-api',
  };
}

async function fetchWiktionary(word: string, signal?: AbortSignal): Promise<LookupResult | null> {
  const data = await getJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`, 4000, signal, { Accept: 'application/json' });
  const first = data?.en?.[0];
  if (!first) return null;
  const defs: string[] = [];
  let ex = '';
  for (const defObj of first.definitions || []) {
    const cleanText = (defObj.definition || '').replace(/<[^>]*>?/gm, '').trim(); // Wiktionary definitions may have HTML tags
    if (cleanText) defs.push(cleanText);
    if (defObj.examples && defObj.examples.length > 0 && !ex) ex = (defObj.examples[0] || '').replace(/<[^>]*>?/gm, '').trim();
  }
  if (defs.length === 0) return null;
  return {
    word,
    phonetic: signal?.aborted ? '' : (await ipaSoon(word)) || '',
    partOfSpeech: first.partOfSpeech?.toLowerCase() || 'word',
    definition: defs[0],
    definitions: defs.slice(0, 4),
    example: ex,
    synonyms: [],
    source: 'wiktionary',
  };
}

async function fetchOnline(word: string): Promise<LookupResult | null> {
  const wik = new AbortController();
  let wikP: Promise<LookupResult | null> | null = null;
  const startWik = () => (wikP ??= fetchWiktionary(word, wik.signal));
  const hedge = setTimeout(startWik, 1500); // Free Dictionary is slow today: ask Wiktionary too instead of waiting for the full timeout
  const fd = await fetchFreeDict(word);
  clearTimeout(hedge);
  if (fd) { wik.abort(); return fd; }
  return startWik();
}

async function fetchEntry(word: string): Promise<LookupResult | null> {
  const built = fromBuiltin(word);
  if (built) return built;
  const saved = answers.get(word);
  if (saved) return saved;
  let p = inFlight.get(word);
  if (!p) {
    p = fetchOnline(word).then(r => { if (r) remember(word, r); return r; }).finally(() => inFlight.delete(word));
    inFlight.set(word, p);
  }
  return p;
}

/** IPA from Wiktionary's English section (used when the dictionary API has no phonetic text). */
async function fetchIpa(word: string): Promise<string> {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 4000);
    const res = await fetch(
      `https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(word)}&prop=wikitext&format=json&formatversion=2&redirects=1&origin=*`,
      { signal: c.signal },
    );
    clearTimeout(t);
    if (!res.ok) return '';
    const text: string = (await res.json())?.parse?.wikitext || '';
    const english = (text.split(/==\s*English\s*==/i)[1] || '').split(/\n==[^=]/)[0];
    const m = english.match(/\{\{IPA\|en\|([^}|]+)/i);
    if (!m) return '';
    const ipa = m[1].trim();
    return /^[/[]/.test(ipa) ? ipa : `/${ipa}/`;
  } catch {
    return '';
  }
}

function stemCandidates(w: string): string[] {
  const c: string[] = [];
  if ((w.endsWith('ies') || w.endsWith('ied')) && w.length > 4) c.push(w.slice(0, -3) + 'y');
  if (w.endsWith('ed') && w.length > 4) c.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('ing') && w.length > 5) c.push(w.slice(0, -3), w.slice(0, -3) + 'e');
  const dbl = w.match(/^(.*[aeiou])([^aeiouwxy])\2(?:ed|ing)$/); // stopped -> stop, running -> run
  if (dbl) c.push(dbl[1] + dbl[2]);
  if (w.endsWith('es') && w.length > 4) c.push(w.slice(0, -2));
  if (w.endsWith('s') && w.length > 3) c.push(w.slice(0, -1));
  return c;
}

const W = "([a-z][a-z'-]{1,})";
const ROOT_PATTERNS: RegExp[] = [
  // "The state of being queasy." / "Being queasy" / "The quality of happy"
  new RegExp(`^\\s*(?:the\\s+)?(?:(?:state|quality|condition|fact|act)\\s+of\\s+)?being\\s+${W}\\s*\\.?\\s*$`, 'i'),
  new RegExp(`^\\s*(?:the\\s+)?(?:state|quality|condition)\\s+of\\s+${W}\\s*\\.?\\s*$`, 'i'),
  // "simple past tense and past participle of placate", "present participle of X", "third-person singular simple present indicative of X", "plural of X", "comparative form of X"...
  new RegExp(`^\\s*(?:\\([^)]*\\)\\s*)?(?:the\\s+)?(?:simple\\s+)?(?:(?:past|present|third[- ]person singular|plural|comparative|superlative)(?:\\s+(?:tense|participle|form|simple present|simple past|indicative|singular|and\\s+(?:simple\\s+)?(?:past\\s+)?(?:tense|participle)))*|gerund|participle|alternative (?:form|spelling)|obsolete (?:form|spelling)|inflection|form)\\s+of\\s+${W}`, 'i'),
  // "In a queasy manner"
  new RegExp(`^\\s*(?:in|with)\\s+an?\\s+${W}\\s+(?:manner|way|fashion)\\s*\\.?\\s*$`, 'i'),
];

/**
 * The root word a derived-form definition points at: "The state of being queasy." -> "queasy", "Simple past tense and past participle of placate." -> "placate".
 * An ordinary definition returns "". The root must be a plain word that differs from the word itself.
 */
export function rootFromDefinition(word: string, definition: string): string {
  for (const re of ROOT_PATTERNS) {
    const root = definition.match(re)?.[1]?.toLowerCase();
    if (root && root !== word.toLowerCase()) return root;
  }
  return '';
}

/** "placated" / "queasiness": a definition that only points at the root word says nothing on its own, so the root's own meaning follows it. */
async function addRootMeaning(r: LookupResult): Promise<LookupResult> {
  try {
    const root = rootFromDefinition(r.word, r.definition);
    if (!root) return r;
    const base = await fetchEntry(root);
    const rootDef = base?.definition;
    if (!rootDef || rootDef === 'Definition unavailable.' || rootFromDefinition(root, rootDef)) return r; // no meaning found, or the "root" is itself only a form
    const first = r.definition.replace(/\s+$/, '');
    const joined = `${/[.!?]$/.test(first) ? first : first + '.'} ${root[0].toUpperCase() + root.slice(1)}: ${rootDef}`;
    return { ...r, definition: joined, definitions: [joined, ...r.definitions.slice(1)] };
  } catch {
    return r;
  }
}

export async function lookupWord(rawWord: string): Promise<LookupResult> {
  const word = cleanWord(rawWord);
  if (!word) throw new Error('Please enter a word to look up');
  const direct = await fetchEntry(word);
  if (direct) return addRootMeaning(direct);
  // The word itself is unknown: try its likely base forms side by side (not one after the other), best guess first
  const stems = stemCandidates(word);
  const found = await Promise.all(stems.map(st => fetchEntry(st)));
  const i = found.findIndex(Boolean);
  if (i >= 0) return found[i]!;
  return {
    word,
    phonetic: '',
    partOfSpeech: 'word',
    definition: 'A term found while reading. Enter its meaning below or keep as a reference.',
    definitions: ['A term found while reading.'],
    example: '',
    synonyms: [],
    source: 'fallback',
  };
}

/**
 * Pronounce a word: recorded audio when we have it, otherwise the device voice.
 */
let currentAudio: HTMLAudioElement | null = null;

export function speakWord(word: string, audioUrl?: string) {
  try { currentAudio?.pause(); } catch {}
  if (audioUrl) {
    try {
      const audio = new Audio(audioUrl.replace(/^\/\//, 'https://'));
      currentAudio = audio;
      audio.play().catch(() => speakWithSynthesis(word));
      return;
    } catch {}
  }
  speakWithSynthesis(word);
}

function speakWithSynthesis(word: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  try {
    // iOS/Safari drop a speak() that comes right after cancel(), so wait a beat when something was playing
    const busy = synth.speaking || synth.pending;
    if (busy) synth.cancel();
    const say = () => {
      const u = new SpeechSynthesisUtterance(word);
      u.lang = 'en-US';
      u.rate = 0.85;
      const voices = synth.getVoices();
      const v = voices.find(x => x.lang === 'en-US' && x.localService) || voices.find(x => x.lang.startsWith('en'));
      if (v) u.voice = v;
      if (synth.paused) synth.resume();
      synth.speak(u);
    };
    if (busy) setTimeout(say, 90); else say();
  } catch (e) {
    console.warn('Speech synthesis failed', e);
  }
}
