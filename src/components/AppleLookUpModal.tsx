import React, { useState, useEffect, useRef } from 'react';
import { useModalA11y } from '../hooks/useModalA11y';
import { Book, WordItem } from '../types';
import { lookupWord, speakWord, LookupResult } from '../services/dictionary';
import { Volume2, Search, ExternalLink, BookMarked, Check, Loader2, Sparkles, X } from 'lucide-react';

interface AppleLookUpModalProps {
  initialWord?: string;
  existingWordItem?: WordItem | null;
  books: Book[];
  onClose: () => void;
  onSaveWord: (wordItem: WordItem) => void;
}

export const AppleLookUpModal: React.FC<AppleLookUpModalProps> = ({
  initialWord = '',
  existingWordItem,
  books,
  onClose,
  onSaveWord,
}) => {
  useModalA11y(onClose);
  const [query, setQuery] = useState(existingWordItem ? existingWordItem.word : initialWord);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  
  // Custom user inputs
  const [selectedBookId, setSelectedBookId] = useState<string | number>(existingWordItem?.bookId ?? '');
  const [quoteSentence, setQuoteSentence] = useState(existingWordItem?.quoteSentence || '');
  const [customDefinition, setCustomDefinition] = useState(existingWordItem?.definition || '');
  const [wikiData, setWikiData] = useState<{ title: string; extract: string; img?: string; url?: string } | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const debounceTimer = useRef<any>(null);
  // Only the most recent lookup may update the screen (a slow answer for an older word is ignored).
  const lookupSeq = useRef(0);

  // Perform lookup with debounce
  const runLookup = async (wordToSearch: string) => {
    const seq = ++lookupSeq.current;
    const isStale = () => seq !== lookupSeq.current;
    const clean = wordToSearch.trim().toLowerCase();
    if (!clean) {
      setLookupResult(null);
      setWikiData(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      // 1. Dictionary lookup
      const res = await lookupWord(clean);
      if (isStale()) return;
      setLookupResult(res);

      // 2. Wikipedia summary lookup
      try {
        const wikiRes = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(clean.replace(/ /g, '_'))}`
        );
        if (isStale()) return;
        if (wikiRes.ok) {
          const w = await wikiRes.json();
          if (isStale()) return;
          if (w.type !== 'disambiguation' && w.extract) {
            setWikiData({
              title: w.title,
              extract: w.extract,
              img: w.thumbnail?.source,
              url: w.content_urls?.mobile?.page || w.content_urls?.desktop?.page,
            });
          } else {
            setWikiData(null);
          }
        } else {
          setWikiData(null);
        }
      } catch {
        setWikiData(null);
      }
    } catch (err: any) {
      console.warn('Lookup error:', err);
    } finally {
      if (!isStale()) setLoading(false);
    }
  };

  useEffect(() => {
    if (query.trim()) {
      runLookup(query);
    }
    return () => {
      clearTimeout(debounceTimer.current);
      lookupSeq.current++; // closing the sheet cancels any lookup still running
    };
  }, []);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    // The old answer belongs to the old word: drop it now so "Add to Word Garden" can't save it under what you just typed
    lookupSeq.current++;
    setLookupResult(null);
    setWikiData(null);
    setLoading(!!val.trim());
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      runLookup(val);
    }, 450);
  };

  const handleSave = () => {
    const w = query.trim();
    if (!w) return;

    const matchedBook = books.find(b => String(b.id) === String(selectedBookId));
    const primaryDef = customDefinition.trim() || lookupResult?.definition || 'Definition saved by user.';

    const ex =
      existingWordItem && existingWordItem.word.toLowerCase() === (lookupResult?.word || w).toLowerCase()
        ? existingWordItem
        : undefined;

    const newWordItem: WordItem = {
      id: existingWordItem?.id || `word_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      word: lookupResult?.word || w,
      phonetic: lookupResult?.phonetic || ex?.phonetic || '',
      audioUrl: lookupResult?.audioUrl || ex?.audioUrl,
      partOfSpeech: lookupResult?.partOfSpeech || ex?.partOfSpeech || 'word',
      definition: primaryDef,
      definitions: lookupResult?.definitions || ex?.definitions || [primaryDef],
      example: lookupResult?.example || ex?.example || '',
      etymology: lookupResult?.etymology ?? ex?.etymology,
      synonyms: lookupResult?.synonyms || ex?.synonyms || [],
      bookId: selectedBookId === '' ? undefined : selectedBookId, // book id 0 is a real book
      bookTitle: matchedBook?.title,
      quoteSentence: quoteSentence.trim() || undefined,
      isLearned: existingWordItem ? existingWordItem.isLearned : false,
      addedAt: existingWordItem ? existingWordItem.addedAt : Date.now(),
    };

    onSaveWord(newWordItem);
    setSavedSuccess(true);
    setTimeout(() => {
      onClose();
    }, 600);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 overflow-y-auto animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[580px] max-h-[92dvh] sm:max-h-[88dvh] bg-[#f5f0e6] dark:bg-[#181410] text-[#201a15] dark:text-[#f0e6d6] rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-y-auto overscroll-contain flex flex-col border border-[#e3d7c3] dark:border-[#382f25]"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Look Up"
      >
        {/* Apple Look Up Navigation Bar */}
        <div className="sticky top-0 z-20 px-5 py-3.5 bg-[#f5f0e6]/95 dark:bg-[#181410]/95 backdrop-blur-md border-b border-[#e3d7c3] dark:border-[#382f25] flex items-center justify-between">
          <div className="w-12" />
          <h3 className="font-semibold text-base tracking-tight text-[#201a15] dark:text-[#f0e6d6]">
            Look Up
          </h3>
          <button
            onClick={onClose}
            className="text-sm font-semibold text-[#2e5934] dark:text-[#86b880] hover:opacity-80 px-2 py-1"
          >
            Done
          </button>
        </div>

        {/* Search Input Bar */}
        <div className="p-4 bg-[#fbf7ee] dark:bg-[#231d17] border-b border-[#e3d7c3] dark:border-[#382f25]">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-[#706256] dark:text-[#a89a8a] absolute left-3.5 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={handleQueryChange}
              placeholder="Search or type any word"
              className="w-full pl-10 pr-10 py-2.5 bg-[#f5f0e6] dark:bg-[#181410] text-[#201a15] dark:text-[#f0e6d6] rounded-xl text-base border border-[#e3d7c3] dark:border-[#382f25] focus:outline-none focus:ring-2 focus:ring-[#2e5934]"
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              spellCheck="false"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  clearTimeout(debounceTimer.current);
                  lookupSeq.current++;
                  setQuery('');
                  setLookupResult(null);
                  setWikiData(null);
                  setLoading(false);
                }}
                className="absolute right-3 p-1 text-[#706256] dark:text-[#a89a8a] hover:text-[#201a15]"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Content Body: Apple Dictionary & Wikipedia cards */}
        <div className="p-5 flex-1 flex flex-col gap-5 overflow-y-auto">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-[#706256] dark:text-[#a89a8a] gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#2e5934] dark:text-[#86b880]" />
              <p className="text-sm font-medium">Looking up “{query}”…</p>
            </div>
          ) : lookupResult ? (
            <>
              {/* Apple Dictionary Section */}
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a] block mb-2 px-1">
                  Apple Dictionary · English
                </span>

                <div className="bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] rounded-2xl p-5 shadow-sm">
                  {/* Word Header with Audio Button */}
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="font-serif-display text-2xl sm:text-3xl text-[#201a15] dark:text-[#f0e6d6]">
                      {lookupResult.word}
                    </h2>
                    <button
                      onClick={() => speakWord(lookupResult.word, lookupResult.audioUrl)}
                      className="p-2 rounded-full bg-[#e8efe7] dark:bg-[#243422] text-[#2e5934] dark:text-[#86b880] hover:scale-105 active:scale-95 transition-all"
                      title="Listen to pronunciation"
                      aria-label={`Listen to pronunciation of ${lookupResult.word}`}
                    >
                      <Volume2 className="w-5 h-5" />
                    </button>
                  </div>

                  {lookupResult.phonetic && (
                    <div className="text-sm font-sans text-[#706256] dark:text-[#a89a8a] mb-3">
                      {lookupResult.phonetic}
                    </div>
                  )}

                  {/* Part of Speech */}
                  <div className="text-xs font-bold uppercase tracking-wide text-[#925838] dark:text-[#d89e70] italic mb-2">
                    {lookupResult.partOfSpeech}
                  </div>

                  {/* Numbered Definitions */}
                  <ol className="space-y-3 pl-5 list-decimal text-sm leading-relaxed text-[#201a15] dark:text-[#f0e6d6]">
                    {lookupResult.definitions.map((def, idx) => (
                      <li key={idx} className="pl-1">
                        <span>{def}</span>
                        {idx === 0 && lookupResult.example && (
                          <p className="mt-1 text-xs text-[#706256] dark:text-[#a89a8a] italic">
                            “{lookupResult.example}”
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>

                  {/* Synonyms */}
                  {lookupResult.synonyms && lookupResult.synonyms.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-[#e3d7c3] dark:border-[#382f25] text-xs text-[#706256] dark:text-[#a89a8a]">
                      <span className="font-semibold text-[#201a15] dark:text-[#f0e6d6]">Synonyms: </span>
                      {lookupResult.synonyms.join(', ')}
                    </div>
                  )}

                  {/* Etymology / Word Origin */}
                  {lookupResult.etymology && (
                    <div className="mt-3 pt-3 border-t border-[#e3d7c3] dark:border-[#382f25] text-xs text-[#706256] dark:text-[#a89a8a]">
                      <span className="font-semibold text-[#201a15] dark:text-[#f0e6d6]">Origin: </span>
                      {lookupResult.etymology}
                    </div>
                  )}
                </div>
              </div>

              {/* Wikipedia Card if available */}
              {wikiData && (
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a] block mb-2 px-1">
                    Wikipedia
                  </span>
                  <div className="bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] rounded-2xl p-4 flex gap-4 items-start shadow-sm">
                    {wikiData.img && (
                      <img
                        src={wikiData.img}
                        alt=""
                        className="w-16 h-16 rounded-xl object-cover shrink-0 border border-[#e3d7c3] dark:border-[#382f25]"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <b className="text-sm font-semibold text-[#201a15] dark:text-[#f0e6d6] block mb-1">
                        {wikiData.title}
                      </b>
                      <p className="text-xs text-[#706256] dark:text-[#a89a8a] line-clamp-3 leading-relaxed mb-2">
                        {wikiData.extract}
                      </p>
                      {wikiData.url && (
                        <a
                          href={wikiData.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-[#2e5934] dark:text-[#86b880] inline-flex items-center gap-1 hover:underline"
                        >
                          <span>Read full entry on Wikipedia</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : query.trim() ? (
            <div className="bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] rounded-2xl p-6 text-center">
              <p className="text-sm text-[#706256] dark:text-[#a89a8a] mb-3">
                No automatic definition found for “{query}”. You can still add your own personal definition below.
              </p>
              <a
                href={`https://www.google.com/search?q=${encodeURIComponent('define ' + query)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-[#e8efe7] dark:bg-[#243422] text-[#2e5934] dark:text-[#86b880]"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Search Web for “{query}”</span>
              </a>
            </div>
          ) : (
            <div className="py-12 text-center text-[#706256] dark:text-[#a89a8a]">
              <Sparkles className="w-8 h-8 mx-auto mb-2 text-[#2e5934] dark:text-[#86b880] opacity-80" />
              <p className="text-sm font-medium">Type a word above to see its definition, origin, and audio.</p>
            </div>
          )}

          {/* Book association & notes section */}
          {query.trim() && (
            <div className="bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] rounded-2xl p-4 flex flex-col gap-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a]">
                Reading Context &amp; Notes
              </span>

              {/* Book Select */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#706256] dark:text-[#a89a8a]">From which book? (optional)</label>
                <select
                  value={selectedBookId}
                  onChange={e => setSelectedBookId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#f5f0e6] dark:bg-[#181410] text-[#201a15] dark:text-[#f0e6d6] rounded-xl border border-[#e3d7c3] dark:border-[#382f25] focus:outline-none"
                >
                  <option value="">None / Independent word</option>
                  {books.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
                </select>
              </div>

              {/* Context Sentence */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#706256] dark:text-[#a89a8a]">
                  Sentence or page quote where you found it (optional)
                </label>
                <textarea
                  value={quoteSentence}
                  onChange={e => setQuoteSentence(e.target.value)}
                  placeholder="e.g. She found quiet solace within the sunlit pages..."
                  rows={2}
                  className="w-full p-2.5 text-sm bg-[#f5f0e6] dark:bg-[#181410] text-[#201a15] dark:text-[#f0e6d6] rounded-xl border border-[#e3d7c3] dark:border-[#382f25] focus:outline-none"
                />
              </div>

              {/* Custom definition override */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#706256] dark:text-[#a89a8a]">
                  My own meaning or memory cue (optional)
                </label>
                <input
                  type="text"
                  value={customDefinition}
                  onChange={e => setCustomDefinition(e.target.value)}
                  placeholder="Custom summary or personal takeaway"
                  className="w-full px-3 py-2 text-sm bg-[#f5f0e6] dark:bg-[#181410] text-[#201a15] dark:text-[#f0e6d6] rounded-xl border border-[#e3d7c3] dark:border-[#382f25] focus:outline-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Sticky Save Action Bar */}
        <div className="sticky bottom-0 p-4 bg-[#f5f0e6] dark:bg-[#181410] border-t border-[#e3d7c3] dark:border-[#382f25]">
          <button
            onClick={handleSave}
            disabled={!query.trim() || savedSuccess}
            className={`w-full min-h-[46px] rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all shadow-sm ${
              savedSuccess
                ? 'bg-emerald-600 text-white'
                : 'bg-[#2e5934] text-white hover:bg-[#244729] active:scale-[0.98]'
            } disabled:opacity-50`}
          >
            {savedSuccess ? (
              <>
                <Check className="w-4 h-4" />
                <span>Saved to Word Garden ✓</span>
              </>
            ) : existingWordItem ? (
              <span>Save Changes</span>
            ) : (
              <>
                <BookMarked className="w-4 h-4" />
                <span>Add to Word Garden</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
