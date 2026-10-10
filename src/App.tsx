import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { Book, TabType, WordItem } from './types';
import { useReadingLife } from './hooks/useReadingLife';
import { getCoverUrl, sameWork, withKnownRating } from './services/books';
import { DEFAULT_BOOKS } from './data/defaultBooks';
import { useAppUpdate, applyUpdate, dismissUpdate, restartApp } from './services/appUpdate';

// Modals
import { AppleBookDetailModal } from './components/AppleBookDetailModal';
import { PlantCelebration } from './components/garden/PlantCelebration';
import { MissingCoversButton } from './components/MissingCoversButton';

// Tabs (each is a screen of its own: see components/tabs)
import { TodayTab } from './components/tabs/TodayTab';
import { StoreTab } from './components/tabs/StoreTab';
import { LibraryTab } from './components/tabs/LibraryTab';
import { WordsTab } from './components/tabs/WordsTab';
import { DeviceTab } from './components/tabs/DeviceTab';

// Icons
import {
  BookOpen,
  ShoppingBag,
  Library,
  Sprout,
  Smartphone,
  RotateCcw,
  Sparkles,
  Share2,
  Download,
  AlertTriangle,
  SlidersHorizontal,
} from 'lucide-react';

/**
 * Rarely-used screens load on first open instead of at startup (smaller first download).
 * If a new deploy replaced the old files, reload once to pick up the new version.
 */
function lazyModal<T extends React.ComponentType<any>>(load: () => Promise<Record<string, any>>, name: string) {
  return lazy<T>(async () => {
    try {
      const m = await load();
      try { sessionStorage.removeItem('rl-chunk-reload'); } catch {}
      return { default: m[name] as T };
    } catch (e) {
      try {
        if (!sessionStorage.getItem('rl-chunk-reload')) {
          sessionStorage.setItem('rl-chunk-reload', '1');
          window.location.reload();
          return new Promise<{ default: T }>(() => {});
        }
      } catch {}
      throw e;
    }
  });
}
const AppleLookUpModal = lazyModal<typeof import('./components/AppleLookUpModal').AppleLookUpModal>(() => import('./components/AppleLookUpModal'), 'AppleLookUpModal');
const AddBookModal = lazyModal<typeof import('./components/AddBookModal').AddBookModal>(() => import('./components/AddBookModal'), 'AddBookModal');
const HighlightsModal = lazyModal<typeof import('./components/HighlightsModal').HighlightsModal>(() => import('./components/HighlightsModal'), 'HighlightsModal');
const ProfileModal = lazyModal<typeof import('./components/ProfileModal').ProfileModal>(() => import('./components/ProfileModal'), 'ProfileModal');
const BackupModal = lazyModal<typeof import('./components/BackupModal').BackupModal>(() => import('./components/BackupModal'), 'BackupModal');
const WordPracticeModal = lazyModal<typeof import('./components/WordPracticeModal').WordPracticeModal>(() => import('./components/WordPracticeModal'), 'WordPracticeModal');
const BulkImportModal = lazyModal<typeof import('./components/BulkImportModal').BulkImportModal>(() => import('./components/BulkImportModal'), 'BulkImportModal');
const ShareModal = lazyModal<typeof import('./components/ShareModal').ShareModal>(() => import('./components/ShareModal'), 'ShareModal');

const TAB_TITLES: Record<string, string> = { store: 'Book Store', lib: 'Library', words: 'Word Garden', dev: 'On my device' };

export default function App() {
  const {
    state,
    allBooks,
    todayKey,
    todayPages,
    currentStreak,
    newPlantIds,
    markPlantsCelebrated,
    movePlant,
    setDayPages,
    updateBookProgress,
    setBookStatus,
    toggleOnDevice,
    addBook,
    removeBook,
    restoreHiddenBooks,
    updateBookNote,
    addHighlight,
    updateHighlight,
    deleteHighlight,
    updateIntention,
    updateProfile,
    setGoal,
    addWord,
    toggleWordLearned,
    setWordLearned,
    updateWord,
    deleteWord,
    exportBackup,
    importBackup,
    clearLibrary,
    clearOnDevice,
    resetEverything,
    saveError,
  } = useReadingLife();

  // "A new plant has arrived" prompts. A plant is marked as shown the moment it is queued (and that is saved),
  // so reloading the app or restoring a backup never shows the same prompt again.
  const [plantQueue, setPlantQueue] = useState<string[]>([]);
  useEffect(() => {
    if (!newPlantIds.length) return;
    setPlantQueue(q => [...q, ...newPlantIds.filter(id => !q.includes(id))]);
    markPlantsCelebrated(newPlantIds);
  }, [newPlantIds, markPlantsCelebrated]);

  // Navigation tab
  const [tab, setTab] = useState<TabType>('today');
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<TabType>>(() => new Set<TabType>(['today']));
  const goTab = (id: TabType) => {
    setTab(id);
    setVisitedTabs(prev => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

  // Modals state
  const [selectedBookForDetail, setSelectedBookForDetail] = useState<Book | null>(null);
  const [selectedBookForHighlights, setSelectedBookForHighlights] = useState<Book | null>(null);
  const [showAddBookModal, setShowAddBookModal] = useState<{ open: boolean; isDevice: boolean }>({
    open: false,
    isDevice: false,
  });
  const [showLookupModal, setShowLookupModal] = useState<{
    open: boolean;
    initialWord?: string;
    existingWord?: WordItem | null;
  }>({ open: false });
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showWordPracticeModal, setShowWordPracticeModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState<{ open: boolean; type: 'books' | 'words' }>({
    open: false,
    type: 'books',
  });

  // Customize Store is switched on from the page header and footer, so the flag lives here (the layout itself is kept by StoreTab)
  const [customizing, setCustomizing] = useState(false);

  // New-version detection (prompts only when the code really changed)
  const update = useAppUpdate();

  // Books categorization
  const nowReadingBooks = useMemo(() => {
    const statusMap = state.status || {};
    return allBooks.filter(b => statusMap[String(b.id)] === 'now');
  }, [allBooks, state.status]);

  const upNextBooks = useMemo(() => {
    const statusMap = state.status || {};
    return allBooks.filter(b => statusMap[String(b.id)] === 'next');
  }, [allBooks, state.status]);

  const libraryBooks = useMemo(() => {
    const statusMap = state.status || {};
    return allBooks.filter(b => statusMap[String(b.id)] !== 'done');
  }, [allBooks, state.status]);

  const finishedBooks = useMemo(() => {
    const statusMap = state.status || {};
    return allBooks.filter(b => statusMap[String(b.id)] === 'done');
  }, [allBooks, state.status]);

  const onDeviceBooks = useMemo(() => {
    const statusMap = state.status || {};
    return allBooks.filter(b => b.isOnDevice && statusMap[String(b.id)] !== 'done');
  }, [allBooks, state.status]);

  const finishedCount = finishedBooks.length;

  // Totals for the profile's Achievements card
  const stats = useMemo(() => {
    const st = state.status || {};
    let finished = 0;
    let toRead = 0;
    allBooks.forEach(b => {
      const s = st[String(b.id)] || 'list';
      if (s === 'done') finished++;
      else if (s === 'next') toRead++;
    });
    const pagesRead = Object.values(state.dailyLog || {}).reduce((a: number, n) => a + (Number(n) || 0), 0);
    return { pagesRead, finished, toRead };
  }, [allBooks, state.status, state.dailyLog]);

  // Books shown on the scene shelves: finished books are kept off the nook shelf.
  const sceneBooks = useMemo(() => {
    const st = state.status || {};
    const rank = (b: Book) => (st[String(b.id)] === 'now' ? 0 : st[String(b.id)] === 'next' ? 1 : 2);
    return libraryBooks.filter(b => b.coverId || b.coverUrl).slice().sort((x, y) => rank(x) - rank(y)).slice(0, 72);
  }, [libraryBooks, state.status]);

  // Remember the covers you'll see first (the nook shelves, then reading now / up next) so the next launch can start
  // loading them before the app code runs. Same 'M' size URLs the nook and cards request, so it is one shared cache.
  // The service worker is also asked to download them in the background, so they are on the device the next time.
  useEffect(() => {
    try {
      const urls = [...nowReadingBooks, ...upNextBooks, ...sceneBooks]
        .map(b => getCoverUrl(b.coverId, 'M', b.coverUrl))
        .filter((u, i, a) => !!u && a.indexOf(u) === i)
        .slice(0, 60);
      localStorage.setItem('readlife.preload', JSON.stringify(urls));
      navigator.serviceWorker?.controller?.postMessage({ type: 'WARM_COVERS', urls });
    } catch {}
  }, [sceneBooks, nowReadingBooks, upNextBooks]);


  // Handlers (stable references so the memoized cards don't redraw when something unrelated changes)
  const handleOpenCover = useCallback((book: Book) => setSelectedBookForDetail(book), []);
  const handleOpenHighlights = useCallback((book: Book) => setSelectedBookForHighlights(book), []);
  const startReading = useCallback((id: string | number) => setBookStatus(id, 'now'), [setBookStatus]);
  const moveToReadingList = useCallback((id: string | number) => {
    setBookStatus(id, 'next');
  }, [setBookStatus]);
  const readAgain = useCallback((id: string | number) => setBookStatus(id, 'list'), [setBookStatus]);
  const confirmRemoveFromLibrary = useCallback((b: Book) => {
    const message = b.isOnDevice
      ? `Remove "${b.title}" from your books? It is also on your device, and its notes and highlights will be removed too.`
      : `Remove "${b.title}" from library?`;
    if (confirm(message)) removeBook(b.id);
  }, [removeBook]);
  const confirmRemoveFromDevice = useCallback((b: Book) => {
    if (confirm(`Remove "${b.title}" from your device? It stays in your Library.`)) toggleOnDevice(b.id, false);
  }, [toggleOnDevice]);
  const confirmRemoveFinished = useCallback((b: Book) => {
    if (confirm(`Remove "${b.title}" from your finished books? Its notes and highlights will be removed too.`)) removeBook(b.id);
  }, [removeBook]);
  const editWord = useCallback((w: WordItem) => setShowLookupModal({ open: true, existingWord: w }), []);
  const lookupAgain = useCallback((word: string) => setShowLookupModal({ open: true, initialWord: word }), []);
  // Tabs ask App to open the modals (App owns every modal's state)
  const openAddBook = useCallback(() => setShowAddBookModal({ open: true, isDevice: false }), []);
  const openAddToDevice = useCallback(() => setShowAddBookModal({ open: true, isDevice: true }), []);
  const openLookupNew = useCallback(() => setShowLookupModal({ open: true }), []);
  const openPractice = useCallback(() => setShowWordPracticeModal(true), []);
  const openPasteWords = useCallback(() => setShowBulkModal({ open: true, type: 'words' }), []);
  const openPasteList = useCallback(() => setShowBulkModal({ open: true, type: 'books' }), []);
  const confirmDeleteWord = useCallback((w: WordItem) => {
    if (confirm(`Remove "${w.word}" from Word Garden?`)) deleteWord(w.id);
  }, [deleteWord]);

  return (
    <div className="rl-shell min-h-dvh flex flex-col bg-[#f5f0e6] dark:bg-[#181410] text-[#201a15] dark:text-[#f0e6d6]">
      {/* Main Container - Optimized for iPad and iPhone */}
      <main className="rl-main w-full max-w-[1140px] mx-auto px-4 sm:px-6 md:px-8 pt-6 sm:pt-8 flex flex-col gap-6">
        {/* Header: Large greeting on left, Share & Profile on right */}
        <header className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0 pr-2">
            <h1 className="font-serif-display text-3xl sm:text-4xl md:text-5xl leading-tight text-[#201a15] dark:text-[#f0e6d6]">
              {tab === 'today' ? `Hello${state.profile.name ? `, ${state.profile.name}` : ''}` : TAB_TITLES[tab] || 'My reading life'}
            </h1>
            {tab === 'today' && (
              <p className="text-sm sm:text-base text-[#706256] dark:text-[#a89a8a] mt-1 ">
                A quiet corner, a warm cup, and {state.goal} pages.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {tab === 'store' && (
              <button
                onClick={() => setCustomizing(c => !c)}
                className={`w-10 h-10 aspect-square rounded-full border bg-[#fbf7ee] dark:bg-[#231d17] text-[#2e5934] dark:text-[#86b880] flex items-center justify-center shrink-0 shadow-xs active:scale-95 transition-all hover:border-[#2e5934] dark:hover:border-[#86b880] ${customizing ? 'border-[#2e5934] dark:border-[#86b880] ring-2 ring-[#2e5934]/30' : 'border-[#e3d7c3] dark:border-[#382f25]'}`}
                title="Customize Store: reorder, hide and refresh shelves"
                aria-label="Customize Store"
                aria-pressed={customizing}
              >
                <SlidersHorizontal className="w-4 h-4 text-[#2e5934] dark:text-[#86b880]" />
              </button>
            )}
            <button
              onClick={() => setShowShareModal(true)}
              className="w-10 h-10 aspect-square rounded-full border border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17] text-[#2e5934] dark:text-[#86b880] flex items-center justify-center shrink-0 shadow-xs active:scale-95 transition-all hover:border-[#2e5934] dark:hover:border-[#86b880]"
              title="Share app link or open on iPhone/iPad"
              aria-label="Share app link"
            >
              <Share2 className="w-4 h-4 text-[#2e5934] dark:text-[#86b880]" />
            </button>

            <button
              onClick={() => setShowProfileModal(true)}
              className="w-11 h-11 aspect-square rounded-full border-2 border-[#e3d7c3] dark:border-[#382f25] bg-[#e8efe7] dark:bg-[#243422] text-[#2e5934] dark:text-[#86b880] flex items-center justify-center shrink-0 font-bold text-base sm:text-lg overflow-hidden shadow-xs active:scale-95 transition-all hover:ring-2 hover:ring-[#2e5934]/30"
              aria-label="Profile and Settings"
              title="Profile & Settings"
            >
              {state.profile.photo ? (
                <img src={state.profile.photo} alt="" className="w-full h-full object-cover" />
              ) : (
                <span>{(state.profile.name || '🌿').slice(0, 1).toUpperCase()}</span>
              )}
            </button>
          </div>
        </header>

        <MissingCoversButton />

        {/* Saving failed: tell the user instead of losing changes silently */}
        {saveError && (
          <div role="alert" className="flex items-start gap-2.5 p-3 rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-800 dark:text-red-300">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Your changes could not be saved on this device (storage is full or blocked). Open Backup and copy your data now so nothing is lost.
            </span>
          </div>
        )}

        {/* "New version" banner: only when the code really is newer than what you are running */}
        {update.available && (
          <aside
            aria-label="App update available"
            className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 w-max max-w-[calc(100vw-24px)] px-4 py-3 rounded-2xl bg-[#201a15] dark:bg-[#2e261f] text-[#f0e6d6] shadow-2xl flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border border-[#382f25]"
          >
            <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse shrink-0" />
            <span className="text-xs font-medium">New version ready</span>
            <button
              onClick={applyUpdate}
              className="px-3 py-1 rounded-xl bg-[#2e5934] hover:bg-[#244729] text-white text-xs font-semibold shadow-sm transition-all active:scale-95 shrink-0"
            >
              Update now
            </button>
            <button onClick={dismissUpdate} className="px-2 py-1 text-xs text-white/70 hover:text-white shrink-0" aria-label="Not now">
              Later
            </button>
          </aside>
        )}

        {/* Tab 1: TODAY VIEW (the reading nook and today's goal) */}
        {visitedTabs.has('today') && (
          <TodayTab
            active={tab === 'today'}
            state={state}
            todayKey={todayKey}
            todayPages={todayPages}
            currentStreak={currentStreak}
            sceneBooks={sceneBooks}
            nowReadingBooks={nowReadingBooks}
            upNextBooks={upNextBooks}
            finishedCount={finishedCount}
            handleOpenCover={handleOpenCover}
            handleOpenHighlights={handleOpenHighlights}
            startReading={startReading}
            setDayPages={setDayPages}
            updateIntention={updateIntention}
            updateBookProgress={updateBookProgress}
            setBookStatus={setBookStatus}
            updateBookNote={updateBookNote}
          />
        )}

        {/* Tab 2: BOOK STORE VIEW */}
        {visitedTabs.has('store') && (
          <StoreTab
            active={tab === 'store'}
            allBooks={allBooks}
            customizing={customizing}
            setCustomizing={setCustomizing}
            handleOpenCover={handleOpenCover}
            onAddBook={openAddBook}
          />
        )}

        {/* Tab 3: LIBRARY VIEW */}
        {visitedTabs.has('lib') && (
          <LibraryTab
            active={tab === 'lib'}
            libraryBooks={libraryBooks}
            state={state}
            handleOpenCover={handleOpenCover}
            handleOpenHighlights={handleOpenHighlights}
            setBookStatus={setBookStatus}
            confirmRemoveFromLibrary={confirmRemoveFromLibrary}
            onAddBook={openAddBook}
          />
        )}

        {/* Tab 4: WORD GARDEN VIEW */}
        {visitedTabs.has('words') && (
          <WordsTab
            active={tab === 'words'}
            state={state}
            updateWord={updateWord}
            editWord={editWord}
            lookupAgain={lookupAgain}
            toggleWordLearned={toggleWordLearned}
            confirmDeleteWord={confirmDeleteWord}
            onLookupNew={openLookupNew}
            onPractice={openPractice}
            onPasteWords={openPasteWords}
          />
        )}

        {/* Tab 5: ON MY DEVICE VIEW */}
        {visitedTabs.has('dev') && (
          <DeviceTab
            active={tab === 'dev'}
            onDeviceBooks={onDeviceBooks}
            finishedBooks={finishedBooks}
            state={state}
            handleOpenCover={handleOpenCover}
            handleOpenHighlights={handleOpenHighlights}
            moveToReadingList={moveToReadingList}
            readAgain={readAgain}
            confirmRemoveFromDevice={confirmRemoveFromDevice}
            confirmRemoveFinished={confirmRemoveFinished}
            onAddToDevice={openAddToDevice}
            onPasteList={openPasteList}
          />
        )}

        {/* Footer: Cozy footer with perfectly rounded Backup & Refresh buttons */}
        <footer className="mt-8 pt-6 pb-24 sm:pb-16 border-t border-[#e3d7c3]/60 dark:border-[#382f25]/60 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#706256] dark:text-[#a89a8a]">
          <div className="flex items-center gap-2">
            <span className="italic font-medium">GreatReads</span>
            <span>·</span>
            <span>A quiet corner for your books</span>
          </div>

          <div className="flex items-center gap-3">
            {tab === 'store' && (
              <button
                onClick={() => setCustomizing(c => !c)}
                className={`w-10 h-10 aspect-square rounded-full border bg-[#fbf7ee] dark:bg-[#231d17] text-[#2e5934] dark:text-[#86b880] flex items-center justify-center shrink-0 shadow-xs active:scale-95 transition-all hover:border-[#2e5934] dark:hover:border-[#86b880] ${customizing ? 'border-[#2e5934] dark:border-[#86b880] ring-2 ring-[#2e5934]/30' : 'border-[#e3d7c3] dark:border-[#382f25]'}`}
                title="Customize Store: reorder, hide and refresh shelves"
                aria-label="Customize Store"
                aria-pressed={customizing}
              >
                <SlidersHorizontal className="w-4 h-4 text-[#2e5934] dark:text-[#86b880]" />
              </button>
            )}
            <button
              onClick={() => setShowBackupModal(true)}
              className="w-10 h-10 aspect-square rounded-full border border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17] text-[#2e5934] dark:text-[#86b880] flex items-center justify-center shrink-0 shadow-xs active:scale-95 transition-all hover:border-[#2e5934] dark:hover:border-[#86b880]"
              title="Backup and Export reading data"
              aria-label="Backup and export reading data"
            >
              <Download className="w-4 h-4 text-[#2e5934] dark:text-[#86b880]" />
            </button>

            <button
              onClick={() => restartApp()}
              className="w-10 h-10 aspect-square rounded-full border border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17] text-[#2e5934] dark:text-[#86b880] flex items-center justify-center shrink-0 shadow-xs active:scale-95 transition-all hover:border-[#2e5934] dark:hover:border-[#86b880]"
              title="Restart app & refresh all cached covers"
              aria-label="Restart app & refresh covers"
            >
              <RotateCcw className="w-4 h-4 text-[#2e5934] dark:text-[#86b880]" />
            </button>
          </div>
        </footer>
      </main>

      {/* Floating tab bar (phone + iPad portrait) / side rail (iPad landscape + desktop) */}
      <nav
        aria-label="Main"
        className="rl-nav fixed z-40 bg-[#fbf7ee]/90 dark:bg-[#231d17]/90 backdrop-blur-xl border border-[#e3d7c3] dark:border-[#382f25] shadow-xl"
      >
        {([
          { id: 'today', label: 'Today', Icon: BookOpen },
          { id: 'store', label: 'Store', Icon: ShoppingBag },
          { id: 'lib', label: 'Library', Icon: Library },
          { id: 'words', label: 'Words', Icon: Sprout },
          { id: 'dev', label: 'Device', Icon: Smartphone },
        ] as const).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => {
              goTab(id);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`rl-tab ${tab === id ? 'is-active' : ''}`}
          >
            <Icon className="rl-tab-icon" strokeWidth={tab === id ? 2.2 : 1.8} />
            <span className="rl-tab-label">{label}</span>
            {id === 'dev' && onDeviceBooks.length + finishedBooks.length > 0 && <i className="rl-tab-dot" aria-hidden="true" />}
          </button>
        ))}
      </nav>

      {/* Modal 1: Apple Books Detail Modal (when tapping any book cover) */}
      {selectedBookForDetail && (() => {
        // The same book can sit in the library under a different record id (search vs Store vs NYT): use the one you own
        const owned = libraryBooks.find(b => b.id === selectedBookForDetail.id)
          ?? libraryBooks.find(b => sameWork(b, selectedBookForDetail, true));
        const ownKey = String(owned ? owned.id : selectedBookForDetail.id);
        // Search, Store and NYT copies of a book you own show YOUR copy's rating, so one book never shows two ratings
        const shownBook = withKnownRating(selectedBookForDetail, [...DEFAULT_BOOKS, ...libraryBooks]);
        return (
        <AppleBookDetailModal
          book={shownBook}
          inLibrary={!!owned}
          onDevice={allBooks.some(b => String(b.id) === ownKey && (b.isOnDevice || state.status[ownKey] === 'done'))}
          readingStatus={state.status[ownKey]}
          currentPage={state.currentPage[ownKey]}
          totalPages={state.totalPages[ownKey]}
          note={state.notes[ownKey]}
          highlightsCount={(state.highlights[ownKey] || []).length}
          onClose={() => setSelectedBookForDetail(null)}
          onAddToLibrary={b => {
            addBook(b, 'library');
          }}
          onAddToDevice={b => {
            addBook(b, 'device');
          }}
          onOpenHighlights={() => {
            const b = owned ?? selectedBookForDetail;
            setSelectedBookForDetail(null);
            setSelectedBookForHighlights(b);
          }}
        />
        );
      })()}

      <Suspense fallback={null}>
      {/* Modal 2: Apple Look Up Modal */}
      {showLookupModal.open && (
        <AppleLookUpModal
          initialWord={showLookupModal.initialWord}
          existingWordItem={showLookupModal.existingWord}
          books={allBooks}
          onClose={() => setShowLookupModal({ open: false })}
          onSaveWord={w => {
            addWord(w);
          }}
        />
      )}

      {/* Modal 3: Add Book Modal */}
      {showAddBookModal.open && (
        <AddBookModal
          initialIsDevice={showAddBookModal.isDevice}
          onClose={() => setShowAddBookModal({ open: false, isDevice: false })}
          onAddBook={(newBook, dest) => {
            addBook(newBook, dest);
          }}
        />
      )}

      {/* Modal 4: Highlights / Quotes Modal */}
      {selectedBookForHighlights && (
        <HighlightsModal
          book={selectedBookForHighlights}
          highlights={state.highlights[String(selectedBookForHighlights.id)] || []}
          onClose={() => setSelectedBookForHighlights(null)}
          onAddHighlight={(txt, pg) => {
            addHighlight(selectedBookForHighlights.id, txt, pg);
          }}
          onUpdateHighlight={(hlId, txt, pg) => {
            updateHighlight(selectedBookForHighlights.id, hlId, txt, pg);
          }}
          onDeleteHighlight={hlId => {
            deleteHighlight(selectedBookForHighlights.id, hlId);
          }}
        />
      )}

      {/* Modal 5: Profile & Settings Modal */}
      {showProfileModal && (
        <ProfileModal
          profile={state.profile}
          goal={state.goal}
          hiddenCount={Object.keys(state.hiddenBookIds).length}
          stats={stats}
          garden={state.garden}
          onMovePlant={movePlant}
          onClose={() => setShowProfileModal(false)}
          onUpdateProfile={updateProfile}
          onUpdateGoal={setGoal}
          onRestoreHidden={restoreHiddenBooks}
          onExportBackup={exportBackup}
          onImportBackup={importBackup}
          onOpenBackupModal={() => setShowBackupModal(true)}
        />
      )}

      {/* Modal 6: Word Practice / Quiz Modal */}
      {showWordPracticeModal && (
        <WordPracticeModal
          words={state.words}
          onClose={() => setShowWordPracticeModal(false)}
          onMarkLearned={id => setWordLearned(id, true)}
        />
      )}

      {/* Modal 7: Bulk Import Modal */}
      {showBulkModal.open && (
        <BulkImportModal
          type={showBulkModal.type}
          onClose={() => setShowBulkModal({ open: false, type: 'books' })}
          onAddBooks={(books, isDev) => {
            books.forEach(b => addBook(b, isDev ? 'device' : 'library'));
          }}
          onAddWords={entries => {
            entries.forEach(e => {
              addWord({
                id: `bulk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                word: e.word,
                definition: e.definition || 'Definition added from list.',
                isLearned: false,
                addedAt: Date.now(),
              });
            });
          }}
        />
      )}

      {/* Modal 8: Backup & Restore Modal */}
      {showBackupModal && (
        <BackupModal
          isOpen
          onClose={() => setShowBackupModal(false)}
          onExportBackup={exportBackup}
          onImportBackup={importBackup}
          onClearLibrary={clearLibrary}
          onClearOnDevice={clearOnDevice}
          onResetEverything={resetEverything}
        />
      )}

      {/* New plant prompt (one at a time) */}
      {plantQueue.length > 0 && (
        <PlantCelebration
          plantId={plantQueue[0]}
          garden={state.garden}
          onClose={() => setPlantQueue(q => q.slice(1))}
        />
      )}

      {/* Modal 9: Share Link & QR Code Modal */}
      {showShareModal && <ShareModal isOpen onClose={() => setShowShareModal(false)} />}
      </Suspense>
    </div>
  );
}
