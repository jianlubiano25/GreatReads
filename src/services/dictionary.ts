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
 * Look up word meaning with multiple fallback layers:
 * 1. Built-in local dictionary (instant, offline)
 * 2. Free Dictionary API (api.dictionaryapi.dev)
 * 3. Wiktionary API (en.wiktionary.org)
 * 4. Stem / base form fallback
 */
async function fetchEntry(word: string): Promise<LookupResult | null> {

  // 1. Check built-in dictionary first
  if (Object.hasOwn(BUILTIN_DICTIONARY, word)) {
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

  // 2. Query Free Dictionary API
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(`https://api.dictionaryapi.dev/v2/entries/en/${encodeURIComponent(word)}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const entry = data[0];
        const phoneticsList = data.flatMap((e: any) => e.phonetics || []);
        const phoneticObj = phoneticsList.find((p: any) => p.text) || {};
        const audioObj =
          phoneticsList.find((p: any) => /-us\.mp3/.test(p.audio || '')) ||
          phoneticsList.find((p: any) => p.audio && p.audio.length > 0);

        const meanings = entry.meanings || [];
        const firstMeaning = meanings[0] || {};
        const partOfSpeech = firstMeaning.partOfSpeech || 'noun';

        const allDefs: string[] = [];
        let firstExample = '';
        const allSynonyms: string[] = [];

        for (const m of meanings) {
          if (Array.isArray(m.synonyms)) {
            allSynonyms.push(...m.synonyms);
          }
          if (Array.isArray(m.definitions)) {
            for (const d of m.definitions) {
              if (d.definition) allDefs.push(d.definition);
              if (d.example && !firstExample) firstExample = d.example;
              if (Array.isArray(d.synonyms)) allSynonyms.push(...d.synonyms);
            }
          }
        }

        const primaryDef = allDefs[0] || 'Definition unavailable.';

        return {
          word: entry.word || word,
          phonetic: entry.phonetic || data.find((e: any) => e.phonetic)?.phonetic || phoneticObj.text || (await fetchIpa(word)) || '',
          partOfSpeech,
          definition: primaryDef,
          definitions: allDefs.slice(0, 4),
          example: firstExample || '',
          etymology: entry.origin || undefined,
          synonyms: Array.from(new Set(allSynonyms)).slice(0, 6),
          audioUrl: audioObj?.audio ? String(audioObj.audio).replace(/^\/\//, 'https://') : undefined,
          source: 'dictionary-api',
        };
      }
    }
  } catch (err) {
    console.warn('Free Dictionary API failed, trying Wiktionary...', err);
  }

  // 3. Fallback: Wiktionary API
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const enEntries = data.en || [];
      if (enEntries.length > 0) {
        const firstSection = enEntries[0];
        const partOfSpeech = firstSection.partOfSpeech?.toLowerCase() || 'word';
        const defs: string[] = [];
        let ex = '';

        for (const defObj of firstSection.definitions || []) {
          // Wiktionary definitions may have HTML tags
          const cleanText = (defObj.definition || '').replace(/<[^>]*>?/gm, '').trim();
          if (cleanText) defs.push(cleanText);
          if (defObj.examples && defObj.examples.length > 0 && !ex) {
            ex = (defObj.examples[0] || '').replace(/<[^>]*>?/gm, '').trim();
          }
        }

        if (defs.length > 0) {
          return {
            word,
            phonetic: (await fetchIpa(word)) || '',
            partOfSpeech,
            definition: defs[0],
            definitions: defs.slice(0, 4),
            example: ex,
            synonyms: [],
            source: 'wiktionary',
          };
        }
      }
    }
  } catch (err) {
    console.warn('Wiktionary lookup failed:', err);
  }

  return null;
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
  if (w.endsWith('es') && w.length > 4) c.push(w.slice(0, -2));
  if (w.endsWith('s') && w.length > 3) c.push(w.slice(0, -1));
  return c;
}

export async function lookupWord(rawWord: string): Promise<LookupResult> {
  const word = cleanWord(rawWord);
  if (!word) throw new Error('Please enter a word to look up');
  const direct = await fetchEntry(word);
  if (direct) return direct;
  for (const stem of stemCandidates(word)) {
    const r = await fetchEntry(stem);
    if (r) return r;
  }
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
