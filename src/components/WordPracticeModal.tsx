import React, { useState } from 'react';
import { WordItem } from '../types';
import { speakWord } from '../services/dictionary';
import { Volume2, Check, RotateCcw, X, Sparkles } from 'lucide-react';

interface WordPracticeModalProps {
  words: WordItem[];
  onClose: () => void;
  onMarkLearned: (id: string) => void; // sets the word to learned (never toggles it back)
}

export const WordPracticeModal: React.FC<WordPracticeModalProps> = ({
  words,
  onClose,
  onMarkLearned,
}) => {
  const [index, setIndex] = useState(0);
  const [isRevealed, setIsRevealed] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);

  // Only words you are still learning, fixed when the quiz opens so marking one learned doesn't shift the list
  const [practiceList] = useState<WordItem[]>(() => words.filter(w => !w.isLearned));
  const currentWord = practiceList[index];

  const handleNext = (learned: boolean) => {
    if (learned && currentWord) {
      onMarkLearned(currentWord.id);
      setSessionCount(prev => prev + 1);
    }
    setIsRevealed(false);
    setIndex(prev => prev + 1);
  };

  const isCompleted = index >= practiceList.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[480px] bg-[#fbf7ee] dark:bg-[#231d17] text-[#201a15] dark:text-[#f0e6d6] rounded-3xl shadow-2xl p-6 flex flex-col border border-[#e3d7c3] dark:border-[#382f25]"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Practice Words"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-full text-[#706256] dark:text-[#a89a8a] hover:bg-black/10 dark:hover:bg-white/10"
        >
          <X className="w-5 h-5" />
        </button>

        {isCompleted ? (
          <div className="py-12 flex flex-col items-center justify-center text-center gap-4">
            <div className="w-16 h-16 rounded-full bg-[#e8efe7] dark:bg-[#243422] text-[#2e5934] dark:text-[#86b880] flex items-center justify-center">
              <Sparkles className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-serif-display text-2xl text-[#201a15] dark:text-[#f0e6d6] mb-1">
                {practiceList.length === 0 ? 'Nothing to practice' : 'Session Complete!'}
              </h3>
              <p className="text-sm text-[#706256] dark:text-[#a89a8a]">
                {practiceList.length === 0
                  ? 'Every word in your garden is already learned. Add new words to practice them here.'
                  : `You practiced ${practiceList.length} word${practiceList.length === 1 ? '' : 's'} and marked ${sessionCount} as learned.`}
              </p>
            </div>
            <button
              onClick={onClose}
              className="mt-2 px-6 py-2.5 bg-[#2e5934] text-white rounded-xl text-sm font-semibold hover:bg-[#244729]"
            >
              Done
            </button>
          </div>
        ) : currentWord ? (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a]">
              <span>Word Practice</span>
              <span>
                {index + 1} of {practiceList.length}
              </span>
            </div>

            {/* Flashcard Area */}
            <div className="min-h-[220px] p-6 rounded-2xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] flex flex-col items-center justify-center text-center gap-3">
              <div className="flex items-center gap-2">
                <h2 className="font-serif-display text-3xl sm:text-4xl text-[#201a15] dark:text-[#f0e6d6]">
                  {currentWord.word}
                </h2>
                <button
                  onClick={() => speakWord(currentWord.word, currentWord.audioUrl)}
                  className="p-1.5 rounded-full text-[#706256] dark:text-[#a89a8a] hover:text-[#2e5934]"
                  title="Pronounce"
                >
                  <Volume2 className="w-5 h-5" />
                </button>
              </div>

              {currentWord.phonetic && (
                <span className="text-xs text-[#706256] dark:text-[#a89a8a]">
                  {currentWord.phonetic} {currentWord.partOfSpeech ? `· ${currentWord.partOfSpeech}` : ''}
                </span>
              )}

              {isRevealed ? (
                <div className="mt-3 flex flex-col gap-2 animate-in fade-in duration-200">
                  <p className="text-sm leading-relaxed text-[#201a15] dark:text-[#f0e6d6] font-medium">
                    {currentWord.definition}
                  </p>
                  {currentWord.example && (
                    <p className="text-xs text-[#706256] dark:text-[#a89a8a] italic">
                      “{currentWord.example}”
                    </p>
                  )}
                  {currentWord.bookTitle && (
                    <span className="text-[11px] text-[#2e5934] dark:text-[#86b880] mt-1 font-sans">
                      📖 {currentWord.bookTitle}
                    </span>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setIsRevealed(true)}
                  className="mt-4 px-5 py-2 rounded-xl text-xs font-semibold bg-[#e8efe7] dark:bg-[#243422] text-[#2e5934] dark:text-[#86b880] hover:bg-[#d8e7d7]"
                >
                  Show Meaning
                </button>
              )}
            </div>

            {/* Action Buttons */}
            {isRevealed ? (
              <div className="flex gap-3">
                <button
                  onClick={() => handleNext(false)}
                  className="flex-1 py-3 px-4 rounded-xl border border-[#e3d7c3] dark:border-[#382f25] text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Practice Later</span>
                </button>
                <button
                  onClick={() => handleNext(true)}
                  className="flex-1 py-3 px-4 rounded-xl bg-[#2e5934] text-white text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-[#244729] shadow-sm"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>I Know This!</span>
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="py-12 text-center text-sm text-[#706256] dark:text-[#a89a8a]">
            No words to practice right now.
          </div>
        )}
      </div>
    </div>
  );
};
