import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Sprout } from 'lucide-react';
import type { WordItem, ReadingState } from '../../types';
import { BUILTIN_DICTIONARY } from '../../data/defaultWords';
import { lookupWord } from '../../services/dictionary';
import { WordCard } from '../cards';
import { TabPane } from './TabPane';

interface Props {
  active: boolean;
  state: Pick<ReadingState, 'words'>;
  updateWord: (wordId: string, updates: Partial<WordItem>) => void;
  editWord: (word: WordItem) => void;
  lookupAgain: (word: string) => void;
  toggleWordLearned: (wordId: string) => void;
  confirmDeleteWord: (word: WordItem) => void;
  onLookupNew: () => void;
  onPractice: () => void;
  onPasteWords: () => void;
}

/** The Word Garden tab: words you have collected, with search, filters and quick actions. */
export function WordsTab({ active, state, updateWord, editWord, lookupAgain, toggleWordLearned, confirmDeleteWord, onLookupNew, onPractice, onPasteWords }: Props) {
  // Word Garden filters & search
  const [wordFilter, setWordFilter] = useState<'all' | 'learning' | 'learned'>('all');
  const [wordSearchQuery, setWordSearchQuery] = useState('');

  // Words saved without a pronunciation get one filled in. Each word is tried once per two weeks (remembered on
  // this device), so a word the dictionary doesn't know doesn't cause a network request on every launch.
  const triedPhonetic = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!active) return;
    const KEY = 'readlife.phoneticTried';
    if (!triedPhonetic.current) {
      triedPhonetic.current = new Set();
      try {
        const saved: Record<string, number> = JSON.parse(localStorage.getItem(KEY) || '{}');
        for (const [id, t] of Object.entries(saved)) if (Date.now() - t < 14 * 86400000) triedPhonetic.current.add(id);
      } catch {}
    }
    const tried = triedPhonetic.current;
    let cancelled = false;
    (async () => {
      const todo = state.words
        .filter(w => {
          const lower = (w.word || '').toLowerCase();
          const builtinPhonetic = Object.hasOwn(BUILTIN_DICTIONARY, lower) ? BUILTIN_DICTIONARY[lower].phonetic : undefined;
          return !w.phonetic && !builtinPhonetic && !tried.has(w.id);
        })
        .slice(0, 12);
      for (const w of todo) {
        if (cancelled) return;
        tried.add(w.id);
        try {
          const saved: Record<string, number> = JSON.parse(localStorage.getItem(KEY) || '{}');
          saved[w.id] = Date.now();
          localStorage.setItem(KEY, JSON.stringify(saved));
        } catch {}
        try {
          const r = await lookupWord(w.word);
          if (r.phonetic || r.audioUrl) {
            updateWord(w.id, { phonetic: r.phonetic || undefined, audioUrl: r.audioUrl, partOfSpeech: w.partOfSpeech || r.partOfSpeech });
          }
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [active, state.words.length]);

  // Filtered words
  const filteredWords = useMemo(() => {
    const q = wordSearchQuery.toLowerCase().trim();
    const wordsList = state.words || [];
    return wordsList.filter(w => {
      const matchFilter =
        wordFilter === 'all'
          ? true
          : wordFilter === 'learned'
          ? w.isLearned
          : !w.isLearned;
      const matchQuery =
        !q ||
        (w.word && (w.word || '').toLowerCase().includes(q)) ||
        (w.definition && w.definition.toLowerCase().includes(q)) ||
        (w.bookTitle && w.bookTitle.toLowerCase().includes(q));
      return matchFilter && matchQuery;
    });
  }, [state.words, wordFilter, wordSearchQuery]);

  // Searching for a word that is not in the garden yet offers to look it up and add it
  const searchedWord = wordSearchQuery.trim();
  const canAddSearchedWord =
    searchedWord.length > 0 &&
    searchedWord.length <= 40 &&
    !state.words.some(w => (w.word || '').toLowerCase() === searchedWord.toLowerCase());

  return (
    <TabPane active={active}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-serif-display text-2xl sm:text-3xl text-[#201a15] dark:text-[#f0e6d6]">
              Word Garden
            </h2>
            <p className="text-xs sm:text-sm text-[#706256] dark:text-[#a89a8a]">
              Words you've discovered while reading. Look up meanings instantly using Apple Books dictionary.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onLookupNew()}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#2e5934] text-white hover:bg-[#244729] flex items-center gap-1.5 shadow-sm"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Look up a word</span>
            </button>
            <button
              onClick={() => onPractice()}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-[#2e5934] text-[#2e5934] dark:text-[#86b880] hover:bg-[#2e5934]/10"
            >
              Quiz Me
            </button>
            <button
              onClick={() => onPasteWords()}
              className="px-3 py-2 rounded-xl text-xs font-semibold border border-[#e3d7c3] dark:border-[#382f25] text-[#706256] dark:text-[#a89a8a] hover:bg-black/5"
            >
              Paste Words
            </button>
          </div>
        </div>

        {/* Word Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-3 items-center">
          <div className="relative w-full sm:flex-1">
            <Search className="w-4 h-4 text-[#706256] dark:text-[#a89a8a] absolute left-3 top-3 pointer-events-none" />
            <input
              type="search"
              value={wordSearchQuery}
              onChange={e => setWordSearchQuery(e.target.value)}
              placeholder="Search discovered words or meanings…"
              className="w-full pl-9 pr-4 py-2 bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] text-xs rounded-xl focus:outline-none"
            />
          </div>

          <div className="flex gap-2 w-full sm:w-auto">
            <button
              onClick={() => setWordFilter('all')}
              className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                wordFilter === 'all'
                  ? 'bg-[#2e5934] text-white border-[#2e5934]'
                  : 'border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17] text-[#706256] dark:text-[#a89a8a]'
              }`}
            >
              All ({state.words.length})
            </button>
            <button
              onClick={() => setWordFilter('learning')}
              className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                wordFilter === 'learning'
                  ? 'bg-[#2e5934] text-white border-[#2e5934]'
                  : 'border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17] text-[#706256] dark:text-[#a89a8a]'
              }`}
            >
              Learning ({state.words.filter(w => !w.isLearned).length})
            </button>
            <button
              onClick={() => setWordFilter('learned')}
              className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                wordFilter === 'learned'
                  ? 'bg-[#2e5934] text-white border-[#2e5934]'
                  : 'border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17] text-[#706256] dark:text-[#a89a8a]'
              }`}
            >
              Learned ({state.words.filter(w => w.isLearned).length})
            </button>
          </div>
        </div>

        {canAddSearchedWord && (
          <button
            type="button"
            onClick={() => lookupAgain(searchedWord)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed border-[#2e5934] text-[#2e5934] dark:text-[#86b880] dark:border-[#86b880] bg-[#2e5934]/5 hover:bg-[#2e5934]/10 text-sm font-semibold active:scale-[0.99] transition-all"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span className="truncate">Add “{searchedWord}” to Word Garden</span>
          </button>
        )}

        {/* Word Cards Grid */}
        {filteredWords.length === 0 ? (
          <div className="p-12 text-center text-[#706256] dark:text-[#a89a8a] bg-[#fbf7ee] dark:bg-[#231d17] rounded-2xl border border-[#e3d7c3] dark:border-[#382f25]">
            <Sprout className="w-8 h-8 mx-auto mb-2 text-[#2e5934] opacity-70" />
            <p className="text-sm font-medium">{canAddSearchedWord ? `“${searchedWord}” is not in your garden yet. Tap the button above to add it.` : 'No words found. Tap "Look up a word" to add your first discovery!'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredWords.map(w => (
              <WordCard
                key={w.id}
                word={w}
                onEdit={editWord}
                onLookup={lookupAgain}
                onToggleLearned={toggleWordLearned}
                onDelete={confirmDeleteWord}
              />
            ))}
          </div>
        )}
      </div>
    </TabPane>
  );
}
