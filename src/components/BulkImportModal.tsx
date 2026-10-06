import React, { useEffect, useRef, useState } from 'react';
import { useModalA11y } from '../hooks/useModalA11y';
import { Book } from '../types';
import { searchBooks } from '../services/books';
import { X, Loader2 } from 'lucide-react';

interface BulkImportModalProps {
  type: 'books' | 'words';
  onClose: () => void;
  onAddBooks?: (books: Book[], isDevice: boolean) => void;
  onAddWords?: (entries: Array<{ word: string; definition?: string }>) => void;
}

export const BulkImportModal: React.FC<BulkImportModalProps> = ({
  type,
  onClose,
  onAddBooks,
  onAddWords,
}) => {
  useModalA11y(onClose);
  const [text, setText] = useState('');
  const [isDevice, setIsDevice] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [done, setDone] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => {
    abortRef.current?.abort();
    clearTimeout(closeTimer.current);
  }, []);

  const splitBookLine = (line: string) => {
    const match = line.match(/^(.*\S)\s+(?:-|–|—|by)\s+(\S.*)$/i);
    return match ? { title: match[1].trim(), author: match[2].trim() } : { title: line, author: '' };
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isProcessing || done) return;
    const lines = text
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    if (lines.length === 0) return;
    setIsProcessing(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (type === 'books' && onAddBooks) {
        const added: Book[] = [];
        const stamp = Date.now();
        for (let i = 0; i < lines.length; i++) {
          if (controller.signal.aborted) return;
          const { title, author } = splitBookLine(lines[i]);
          setProgressMsg(`Importing ${i + 1} of ${lines.length}…`);
          const placeholder = (): Book => ({
            id: `bulk_${stamp}_${i}`,
            title,
            author: author || 'Unknown Author',
            shelf: 'mine',
            difficulty: 0,
            notes: 'Added via bulk list',
            isOnDevice: isDevice,
            year: '',
            genre: 'Book',
            summary: '',
            authorBio: '',
            pageCount: 0,
            spineColor: '#6b6f80',
            source: 'manual',
            addedAt: Date.now(),
          });

          try {
            const results = await searchBooks(title, author, 1, controller.signal);
            if (controller.signal.aborted) return;
            added.push(results.length > 0 ? { ...results[0], isOnDevice: isDevice } : placeholder());
          } catch {
            if (controller.signal.aborted) return;
            added.push(placeholder());
          }
        }
        if (controller.signal.aborted) return;
        onAddBooks(added, isDevice);
        setProgressMsg(`Done! Added ${added.length} books.`);
      } else if (type === 'words' && onAddWords) {
        const parsed = lines.map(line => {
          const parts = line.split(/\s+[-–—:]\s+/);
          return { word: parts[0].trim(), definition: parts.slice(1).join(' - ').trim() || undefined };
        });
        onAddWords(parsed);
        setProgressMsg(`Added ${parsed.length} words to Word Garden!`);
      }
      setDone(true);
      closeTimer.current = setTimeout(onClose, 900);
    } catch (error) {
      console.error('Bulk import failed:', error);
      setProgressMsg('Something went wrong. Nothing was lost. Please try again.');
    } finally {
      if (!controller.signal.aborted) setIsProcessing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[520px] bg-[#fbf7ee] dark:bg-[#231d17] text-[#201a15] dark:text-[#f0e6d6] rounded-3xl shadow-2xl p-6 flex flex-col border border-[#e3d7c3] dark:border-[#382f25]"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Paste list"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-serif-display text-xl text-[#201a15] dark:text-[#f0e6d6]">
            {type === 'books' ? 'Paste Your Book List' : 'Paste Your Words'}
          </h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="p-1 rounded-full text-[#706256] dark:text-[#a89a8a] hover:bg-black/10 dark:hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-[#706256] dark:text-[#a89a8a] mb-4 leading-relaxed">
          {type === 'books'
            ? 'One book per line: "Title - Author" or simply the title. Info, ratings, and covers are discovered automatically.'
            : 'One word per line. Optionally add a meaning after a dash: "ephemeral - short-lived".'}
        </p>

        {type === 'books' && (
          <div className="mb-4 flex items-center gap-3 text-xs">
            <span className="font-semibold text-[#706256] dark:text-[#a89a8a]">Destination:</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="dest"
                checked={isDevice}
                onChange={() => setIsDevice(true)}
                className="accent-[#2e5934]"
              />
              <span>On My Device</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="dest"
                checked={!isDevice}
                onChange={() => setIsDevice(false)}
                className="accent-[#2e5934]"
              />
              <span>Reading List</span>
            </label>
          </div>
        )}

        <form onSubmit={handleImport} className="flex flex-col gap-4">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={
              type === 'books'
                ? "The Midnight Library - Matt Haig\nNormal People - Sally Rooney\nPiranesi - Susanna Clarke"
                : "solace - comfort in distress\npetrichor - scent of fresh rain\nineffable"
            }
            rows={7}
            className="w-full p-3 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#2e5934]"
          />

          {progressMsg && (
            <p className="text-xs text-[#2e5934] dark:text-[#86b880] font-medium flex items-center gap-1.5">
              {isProcessing && !done && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{progressMsg}</span>
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-[#e3d7c3] dark:border-[#382f25] text-xs font-semibold hover:bg-black/5 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!text.trim() || isProcessing || done}
              className="flex-1 py-2.5 rounded-xl bg-[#2e5934] text-white text-xs font-semibold hover:bg-[#244729] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Importing…</span>
                </>
              ) : (
                <span>Add Items</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
