import React, { useState } from 'react';
import { Book, HighlightItem } from '../types';
import { Bookmark, Plus, Trash2, Search, X, Check, Edit3, Save } from 'lucide-react';

interface HighlightsModalProps {
  book: Book;
  highlights: HighlightItem[];
  onClose: () => void;
  onAddHighlight: (text: string, page?: number) => void;
  onUpdateHighlight?: (id: string, text: string, page?: number) => void;
  onDeleteHighlight: (id: string) => void;
}

export const HighlightsModal: React.FC<HighlightsModalProps> = ({
  book,
  highlights = [],
  onClose,
  onAddHighlight,
  onUpdateHighlight,
  onDeleteHighlight,
}) => {
  const [newText, setNewText] = useState('');
  const [newPage, setNewPage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showBatchImport, setShowBatchImport] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editPage, setEditPage] = useState('');

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;
    onAddHighlight(newText.trim(), newPage ? Number(newPage) : undefined);
    setNewText('');
    setNewPage('');
  };

  const handleBatchImport = () => {
    if (!batchText.trim()) return;
    // Split on blank lines
    const chunks = batchText
      .split(/\n\s*\n/)
      .map(x => x.trim())
      .filter(x => x && !/^excerpt from/i.test(x) && !/protected by copyright/i.test(x));

    chunks.forEach(c => {
      onAddHighlight(c);
    });
    setBatchText('');
    setShowBatchImport(false);
  };

  const filtered = highlights.filter(h =>
    h.text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchDeltaY, setTouchDeltaY] = useState(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.currentTarget as HTMLElement;
    if (target.scrollTop <= 5) {
      setTouchStart(e.touches[0].clientY);
    } else {
      setTouchStart(null);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStart === null) return;
    const diff = e.touches[0].clientY - touchStart;
    if (diff > 0) {
      setTouchDeltaY(diff);
    } else {
      setTouchDeltaY(0);
    }
  };

  const handleTouchEnd = () => {
    if (touchDeltaY > 100) {
      onClose();
    }
    setTouchStart(null);
    setTouchDeltaY(0);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 overflow-y-auto animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[580px] max-h-[92dvh] sm:max-h-[88dvh] bg-[#fbf7ee] dark:bg-[#231d17] text-[#201a15] dark:text-[#f0e6d6] rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-y-auto overscroll-contain flex flex-col border border-[#e3d7c3] dark:border-[#382f25] transition-transform duration-100 ease-out"
        style={{
          transform: touchDeltaY > 0 ? `translateY(${touchDeltaY}px)` : undefined,
          opacity: touchDeltaY > 0 ? Math.max(0.4, 1 - touchDeltaY / 300) : 1,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Highlights"
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden pt-3 pb-1 cursor-grab active:cursor-grabbing flex flex-col items-center">
          <div className="w-12 h-1.5 bg-black/25 dark:bg-white/30 rounded-full" />
        </div>
        {/* Header */}
        <div className="sticky top-0 z-20 px-6 py-4 bg-[#fbf7ee]/95 dark:bg-[#231d17]/95 backdrop-blur-md border-b border-[#e3d7c3] dark:border-[#382f25] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bookmark className="w-5 h-5 text-[#925838] dark:text-[#d89e70]" />
            <div>
              <h3 className="font-serif-display text-lg text-[#201a15] dark:text-[#f0e6d6]">
                Highlights &amp; Quotes
              </h3>
              <p className="text-xs text-[#706256] dark:text-[#a89a8a] truncate max-w-[320px]">
                {book.title}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-[#706256] dark:text-[#a89a8a] hover:bg-black/10 dark:hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Add Highlight Form */}
        <div className="p-5 border-b border-[#e3d7c3] dark:border-[#382f25] bg-[#f5f0e6]/50 dark:bg-[#181410]/50">
          <form onSubmit={handleSave} className="flex flex-col gap-3">
            <textarea
              value={newText}
              onChange={e => setNewText(e.target.value)}
              placeholder="Type or paste a line worth remembering…"
              rows={3}
              className="w-full p-3 rounded-xl bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] text-sm focus:outline-none focus:ring-2 focus:ring-[#2e5934]"
            />
            <div className="flex items-center justify-between gap-3">
              <input
                type="number"
                min="1"
                value={newPage}
                onChange={e => setNewPage(e.target.value)}
                placeholder="Page"
                className="w-24 px-3 py-2 rounded-xl bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] text-sm focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowBatchImport(!showBatchImport)}
                  className="px-3 py-2 rounded-xl text-xs font-medium text-[#706256] dark:text-[#a89a8a] hover:bg-black/5 dark:hover:bg-white/5"
                >
                  Import Apple Books
                </button>
                <button
                  type="submit"
                  disabled={!newText.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#2e5934] text-white hover:bg-[#244729] disabled:opacity-50 flex items-center gap-1 shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Save Highlight</span>
                </button>
              </div>
            </div>
          </form>

          {/* Batch Import Accordion */}
          {showBatchImport && (
            <div className="mt-4 p-4 rounded-xl bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] flex flex-col gap-2">
              <span className="text-xs font-semibold text-[#201a15] dark:text-[#f0e6d6]">
                Import from Apple Books Highlights
              </span>
              <p className="text-xs text-[#706256] dark:text-[#a89a8a]">
                Paste your exported highlights. Separate quotes by a blank line.
              </p>
              <textarea
                value={batchText}
                onChange={e => setBatchText(e.target.value)}
                rows={4}
                className="w-full p-2.5 rounded-lg bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-xs focus:outline-none"
                placeholder="Paste quotes here..."
              />
              <button
                type="button"
                onClick={handleBatchImport}
                disabled={!batchText.trim()}
                className="self-end px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#2e5934] text-white hover:bg-[#244729] disabled:opacity-50"
              >
                Import Quotes
              </button>
            </div>
          )}
        </div>

        {/* Search Highlights */}
        {highlights.length > 2 && (
          <div className="px-5 pt-3 pb-1">
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-[#706256] dark:text-[#a89a8a] absolute left-3 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search quotes in this book"
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-xs focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Highlights List */}
        <div className="p-5 flex-1 flex flex-col gap-3 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-[#706256] dark:text-[#a89a8a] text-sm">
              {highlights.length === 0
                ? 'No quotes saved yet for this book.'
                : 'No quotes match your search.'}
            </div>
          ) : (
            filtered.map(h => {
              const isEditing = editingId === h.id;

              if (isEditing) {
                return (
                  <div
                    key={h.id}
                    className="p-4 rounded-xl bg-[#fbf7ee] dark:bg-[#231d17] border-2 border-[#2e5934] dark:border-[#86b880] flex flex-col gap-3 shadow-md"
                  >
                    <div className="flex items-center justify-between text-xs font-semibold text-[#2e5934] dark:text-[#86b880]">
                      <span>Editing Quote</span>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="text-[#706256] dark:text-[#a89a8a] hover:underline"
                      >
                        Cancel
                      </button>
                    </div>

                    <textarea
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      rows={4}
                      className="w-full p-3 rounded-lg bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-base  italic leading-relaxed text-[#201a15] dark:text-[#f0e6d6] focus:outline-none focus:ring-2 focus:ring-[#2e5934]"
                      autoFocus
                    />

                    <div className="flex items-center justify-between gap-3 pt-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[#706256] dark:text-[#a89a8a]">Page:</span>
                        <input
                          type="number"
                          min="1"
                          value={editPage}
                          onChange={e => setEditPage(e.target.value)}
                          placeholder="Page"
                          className="w-20 px-2.5 py-1.5 rounded-lg bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-sm focus:outline-none"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (onUpdateHighlight && editText.trim()) {
                              onUpdateHighlight(h.id, editText.trim(), editPage ? Number(editPage) : undefined);
                            }
                            setEditingId(null);
                          }}
                          disabled={!editText.trim()}
                          className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#2e5934] text-white hover:bg-[#244729] flex items-center gap-1.5 shadow"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>Save changes</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={h.id}
                  onClick={() => {
                    setEditingId(h.id);
                    setEditText(h.text);
                    setEditPage(h.page ? String(h.page) : '');
                  }}
                  className="p-4 sm:p-5 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] flex flex-col gap-2.5 relative group cursor-pointer hover:border-[#2e5934] transition-all"
                  title="Tap to edit this quote"
                >
                  <blockquote className="text-base sm:text-lg  italic leading-relaxed text-[#201a15] dark:text-[#f0e6d6] pl-3.5 border-l-3 border-[#925838] dark:border-[#d89e70]">
                    “{h.text}”
                  </blockquote>

                  <div className="flex items-center justify-between text-xs text-[#706256] dark:text-[#a89a8a] pt-1">
                    <span className="font-sans font-medium">
                      {h.page ? `Page ${h.page}` : 'Excerpt'} · <span className="underline opacity-80">Tap to edit</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          setEditingId(h.id);
                          setEditText(h.text);
                          setEditPage(h.page ? String(h.page) : '');
                        }}
                        className="p-1.5 text-[#706256] dark:text-[#a89a8a] hover:text-[#2e5934] dark:hover:text-[#86b880] transition-colors"
                        title="Edit highlight"
                        aria-label="Edit quote"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          if (confirm('Delete this highlight?')) {
                            onDeleteHighlight(h.id);
                          }
                        }}
                        className="p-1.5 text-[#706256] dark:text-[#a89a8a] hover:text-red-500 transition-colors"
                        title="Delete highlight"
                        aria-label="Delete quote"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
