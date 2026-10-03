import React, { useState } from 'react';
import { Book, ShelfKey } from '../types';
import { searchOnlineBooks, getCoverUrl } from '../services/bookSearch';
import { SHELF_LABELS } from '../data/defaultBooks';
import { Search, Plus, Smartphone, BookOpen, Check, X, Loader2 } from 'lucide-react';

interface AddBookModalProps {
  initialIsDevice?: boolean;
  onClose: () => void;
  onAddBook: (book: Book, destination: 'device' | 'library') => void;
}

export const AddBookModal: React.FC<AddBookModalProps> = ({
  initialIsDevice = false,
  onClose,
  onAddBook,
}) => {
  const [destination, setDestination] = useState<'device' | 'library'>(
    initialIsDevice ? 'device' : 'library'
  );
  const [mode, setMode] = useState<'search' | 'manual'>('search');

  // Search state
  const [searchTitle, setSearchTitle] = useState('');
  const [searchAuthor, setSearchAuthor] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Book[]>([]);
  const [addedIds, setAddedIds] = useState<Record<string, boolean>>({});
  const [searchError, setSearchError] = useState('');

  // Manual entry state
  const [manualTitle, setManualTitle] = useState('');
  const [manualAuthor, setManualAuthor] = useState('');
  const [manualPages, setManualPages] = useState('');
  const [manualYear, setManualYear] = useState('');
  const [manualShelf, setManualShelf] = useState<ShelfKey>('mine');
  const [manualNotes, setManualNotes] = useState('');
  const [manualSummary, setManualSummary] = useState('');
  const [manualSuccess, setManualSuccess] = useState(false);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchTitle.trim()) return;

    setIsSearching(true);
    setSearchError('');
    try {
      const results = await searchOnlineBooks(searchTitle, searchAuthor);
      if (results.length === 0) {
        setSearchError('No matching books found. Try checking the spelling or use Manual Entry.');
      }
      setSearchResults(results);
    } catch (err) {
      setSearchError('Search failed. Switch to Manual Entry to add your book directly.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddSearchResult = (book: Book) => {
    const updatedBook = {
      ...book,
      isOnDevice: destination === 'device',
    };
    onAddBook(updatedBook, destination);
    setAddedIds(prev => ({ ...prev, [String(book.id)]: true }));
    setTimeout(() => {
      onClose();
    }, 600);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTitle.trim()) return;

    const newBook: Book = {
      id: `manual_${Date.now()}`,
      title: manualTitle.trim(),
      author: manualAuthor.trim() || 'Unknown Author',
      shelf: manualShelf,
      difficulty: Number(manualPages) > 400 ? 3 : Number(manualPages) > 220 ? 2 : Number(manualPages) > 0 ? 1 : 0,
      notes: manualNotes.trim() || undefined,
      isOnDevice: destination === 'device',
      year: manualYear.trim(),
      genre: SHELF_LABELS[manualShelf]?.label || 'Book',
      summary: manualSummary.trim(),
      authorBio: '',
      pageCount: Math.max(0, Math.round(Number(manualPages)) || 0), // 0 = unknown (looked up later)
      spineColor: SHELF_LABELS[manualShelf]?.color || '#6b6f80',
      source: 'manual',
      addedAt: Date.now(),
    };

    onAddBook(newBook, destination);
    setManualSuccess(true);
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
        className="relative w-full max-w-[560px] max-h-[92dvh] sm:max-h-[88dvh] bg-[#fbf7ee] dark:bg-[#231d17] text-[#201a15] dark:text-[#f0e6d6] rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-y-auto overscroll-contain flex flex-col border border-[#e3d7c3] dark:border-[#382f25]"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Add Book"
      >
        {/* Header */}
        <div className="sticky top-0 z-20 px-6 py-4 bg-[#fbf7ee]/95 dark:bg-[#231d17]/95 backdrop-blur-md border-b border-[#e3d7c3] dark:border-[#382f25] flex items-center justify-between">
          <div>
            <h3 className="font-serif-display text-xl text-[#201a15] dark:text-[#f0e6d6]">
              {destination === 'device' ? 'Add to On Device Library' : 'Add to Reading List'}
            </h3>
            <p className="text-xs text-[#706256] dark:text-[#a89a8a]">
              {destination === 'device'
                ? 'Books you own or store on your iPad & iPhone'
                : 'Queue for your reading challenge'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-[#706256] dark:text-[#a89a8a] hover:bg-black/10 dark:hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Destination & Mode Selectors */}
        <div className="px-6 pt-4 pb-2 flex flex-col gap-3">
          {/* Destination Selector: On Device vs Reading List */}
          <div className="p-1 bg-[#f5f0e6] dark:bg-[#181410] rounded-xl flex items-center border border-[#e3d7c3] dark:border-[#382f25]">
            <button
              type="button"
              onClick={() => setDestination('device')}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                destination === 'device'
                  ? 'bg-white dark:bg-[#2a221a] text-[#2e5934] dark:text-[#86b880] shadow-sm'
                  : 'text-[#706256] dark:text-[#a89a8a] hover:text-[#201a15]'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>On My Device</span>
            </button>
            <button
              type="button"
              onClick={() => setDestination('library')}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                destination === 'library'
                  ? 'bg-white dark:bg-[#2a221a] text-[#2e5934] dark:text-[#86b880] shadow-sm'
                  : 'text-[#706256] dark:text-[#a89a8a] hover:text-[#201a15]'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Reading List</span>
            </button>
          </div>

          {/* Mode Switch: Search vs Manual */}
          <div className="flex gap-4 border-b border-[#e3d7c3] dark:border-[#382f25] text-xs font-medium">
            <button
              type="button"
              onClick={() => setMode('search')}
              className={`pb-2 transition-colors relative ${
                mode === 'search'
                  ? 'text-[#2e5934] dark:text-[#86b880] font-semibold border-b-2 border-[#2e5934] dark:border-[#86b880]'
                  : 'text-[#706256] dark:text-[#a89a8a]'
              }`}
            >
              Search Online Database
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={`pb-2 transition-colors relative ${
                mode === 'manual'
                  ? 'text-[#2e5934] dark:text-[#86b880] font-semibold border-b-2 border-[#2e5934] dark:border-[#86b880]'
                  : 'text-[#706256] dark:text-[#a89a8a]'
              }`}
            >
              Enter Manually (Guaranteed)
            </button>
          </div>
        </div>

        {/* Mode 1: Search Online */}
        {mode === 'search' ? (
          <div className="p-6 flex flex-col gap-4 overflow-y-auto flex-1">
            <form onSubmit={handleSearch} className="flex flex-col gap-3">
              <div>
                <label className="text-xs font-semibold text-[#706256] dark:text-[#a89a8a] mb-1 block">
                  Book Title *
                </label>
                <input
                  type="text"
                  value={searchTitle}
                  onChange={e => setSearchTitle(e.target.value)}
                  placeholder="e.g. Tomorrow, and Tomorrow, and Tomorrow"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-sm focus:outline-none focus:ring-2 focus:ring-[#2e5934]"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[#706256] dark:text-[#a89a8a] mb-1 block">
                  Author (Optional)
                </label>
                <input
                  type="text"
                  value={searchAuthor}
                  onChange={e => setSearchAuthor(e.target.value)}
                  placeholder="e.g. Gabrielle Zevin"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-sm focus:outline-none focus:ring-2 focus:ring-[#2e5934]"
                />
              </div>

              <button
                type="submit"
                disabled={!searchTitle.trim() || isSearching}
                className="w-full min-h-[44px] bg-[#2e5934] text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 hover:bg-[#244729] disabled:opacity-50 transition-all shadow-sm"
              >
                {isSearching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Searching catalog…</span>
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    <span>Find Book</span>
                  </>
                )}
              </button>
            </form>

            {searchError && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-200 text-xs rounded-xl">
                {searchError}
              </div>
            )}

            {/* Results list */}
            {searchResults.length > 0 && (
              <div className="flex flex-col gap-3 mt-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a]">
                  Matches ({searchResults.length})
                </span>
                {searchResults.map(b => {
                  const isAdded = addedIds[String(b.id)];
                  const cover = getCoverUrl(b.coverId, 'S', b.coverUrl);
                  return (
                    <div
                      key={b.id}
                      className="p-3 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] flex items-center gap-3"
                    >
                      <div className="w-12 h-16 rounded bg-[#2e5934] shrink-0 overflow-hidden relative shadow">
                        {cover ? (
                          <img
                            src={cover}
                            alt=""
                            className="w-full h-full object-cover"
                            onError={e => ((e.target as HTMLElement).style.display = 'none')}
                          />
                        ) : null}
                      </div>

                      <div className="flex-1 min-w-0">
                        <b className="text-sm font-semibold text-[#201a15] dark:text-[#f0e6d6] block truncate">
                          {b.title}
                        </b>
                        <span className="text-xs text-[#706256] dark:text-[#a89a8a] block truncate">
                          {b.author} {b.year ? `· ${b.year}` : ''} {b.pageCount ? `· ${b.pageCount} p.` : ''}
                        </span>
                      </div>

                      <button
                        onClick={() => handleAddSearchResult(b)}
                        disabled={isAdded}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 shrink-0 transition-all ${
                          isAdded
                            ? 'bg-emerald-600 text-white'
                            : 'bg-[#2e5934] text-white hover:bg-[#244729]'
                        }`}
                      >
                        {isAdded ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Added ✓</span>
                          </>
                        ) : (
                          <>
                            <Plus className="w-3.5 h-3.5" />
                            <span>Add</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* Mode 2: Manual Direct Entry */
          <form onSubmit={handleManualSubmit} className="p-6 flex flex-col gap-4 overflow-y-auto flex-1">
            <div>
              <label className="text-xs font-semibold text-[#706256] dark:text-[#a89a8a] mb-1 block">
                Book Title *
              </label>
              <input
                type="text"
                required
                value={manualTitle}
                onChange={e => setManualTitle(e.target.value)}
                placeholder="Title of the book"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-sm focus:outline-none focus:ring-2 focus:ring-[#2e5934]"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-[#706256] dark:text-[#a89a8a] mb-1 block">
                Author
              </label>
              <input
                type="text"
                value={manualAuthor}
                onChange={e => setManualAuthor(e.target.value)}
                placeholder="Author name"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-sm focus:outline-none focus:ring-2 focus:ring-[#2e5934]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-[#706256] dark:text-[#a89a8a] mb-1 block">
                  Page Count
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  placeholder="Optional"
                  value={manualPages}
                  onChange={e => setManualPages(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-sm focus:outline-none focus:ring-2 focus:ring-[#2e5934]"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#706256] dark:text-[#a89a8a] mb-1 block">
                  Year
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Optional"
                  value={manualYear}
                  onChange={e => setManualYear(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-sm focus:outline-none focus:ring-2 focus:ring-[#2e5934]"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#706256] dark:text-[#a89a8a] mb-1 block">
                Shelf Category
              </label>
              <select
                value={manualShelf}
                onChange={e => setManualShelf(e.target.value as ShelfKey)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-sm focus:outline-none"
              >
                {Object.entries(SHELF_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.emoji} {v.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#706256] dark:text-[#a89a8a] mb-1 block">
                Short Note / Why you have it (optional)
              </label>
              <input
                type="text"
                value={manualNotes}
                onChange={e => setManualNotes(e.target.value)}
                placeholder="e.g. Bought for summer reading"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-sm focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={!manualTitle.trim() || manualSuccess}
              className={`w-full min-h-[46px] rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all shadow-sm ${
                manualSuccess
                  ? 'bg-emerald-600 text-white'
                  : 'bg-[#2e5934] text-white hover:bg-[#244729]'
              }`}
            >
              {manualSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>
                    {destination === 'device' ? 'Added to On Device ✓' : 'Added to Library ✓'}
                  </span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>
                    {destination === 'device' ? 'Save Book to On Device' : 'Save Book to Library'}
                  </span>
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
