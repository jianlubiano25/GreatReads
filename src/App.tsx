import React, { useState, useEffect, useMemo, useCallback, useRef, useSyncExternalStore, lazy, Suspense } from 'react';
import { Book, TabType, WordItem } from './types';
import { useReadingLife } from './hooks/useReadingLife';
import { syncCatalog } from './services/catalog';
import { autoBackup } from './services/cloudSync';
import { authVersion, consumeAuthRedirect, checkAdmin, currentUser, isAdminKnown, subscribeAuth } from './services/supabase';
import { initCapture, maybeBackfill } from './services/captureDevice';
import { bookKey, getCoverPick, getCoverUrl, sameWork, withKnownRating, isCoverAdminOn, subscribeCoverAdmin, tapSecret, syncSharedCovers } from './services/books';
import { milestone } from './services/books/perf';
import { formatRating, prettyDate, readingNowOrder } from './services/bookHistory';
import { makeCollection, setBookMembership } from './services/libraryCollections';
import { resolveLibraryId } from './services/library';
import { useLibraryCollections } from './hooks/useLibraryCollections';
import { LibrarySheet } from './components/LibrarySheet';
import { enrichInBackground } from './services/books/infoQueue';
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
import { SearchTab } from './components/tabs/SearchTab';

// Icons
import {
  BookOpen,
  Compass,
  Plus,
  Library,
  Sprout,
  Search,
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
const CatalogReviewModal = lazyModal<typeof import('./components/CatalogReviewModal').CatalogReviewModal>(() => import('./components/CatalogReviewModal'), 'CatalogReviewModal');
const CoverPublishModal = lazyModal<typeof import('./components/CoverPublishModal').CoverPublishModal>(() => import('./components/CoverPublishModal'), 'CoverPublishModal');
const BackupModal = lazyModal<typeof import('./components/BackupModal').BackupModal>(() => import('./components/BackupModal'), 'BackupModal');
const WordPracticeModal = lazyModal<typeof import('./components/WordPracticeModal').WordPracticeModal>(() => import('./components/WordPracticeModal'), 'WordPracticeModal');
const BulkImportModal = lazyModal<typeof import('./components/BulkImportModal').BulkImportModal>(() => import('./components/BulkImportModal'), 'BulkImportModal');
const ShareModal = lazyModal<typeof import('./components/ShareModal').ShareModal>(() => import('./components/ShareModal'), 'ShareModal');

const TAB_TITLES: Record<string, string> = { store: 'Discover', lib: 'My Library', words: 'Word Garden', search: 'Search' };

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
    setBookHistory,
    setBookRating,
    findDuplicates,
    mergeDuplicates,
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

  useEffect(() => { milestone('app-mounted'); }, []); // measurement only (see services/books/perf.ts)

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
  const [moreLike, setMoreLike] = useState<{ book: Book } | null>(null);
  const [selectedBookForHighlights, setSelectedBookForHighlights] = useState<Book | null>(null);
  const [showAddBookModal, setShowAddBookModal] = useState(false);
  const [showLookupModal, setShowLookupModal] = useState<{
    open: boolean;
    initialWord?: string;
    existingWord?: WordItem | null;
  }>({ open: false });
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showCoverPublish, setShowCoverPublish] = useState(false);
  const [showCatalogReview, setShowCatalogReview] = useState(false);

  // Developer mode (the owner's hidden tools): five taps on the greeting switch it on or off. Everyone else never sees it.
  const coverTools = useSyncExternalStore(subscribeCoverAdmin, isCoverAdminOn, isCoverAdminOn);
  const [toolsNote, setToolsNote] = useState('');
  const seenTools = useRef(coverTools);
  useEffect(() => {
    if (seenTools.current === coverTools) return;
    seenTools.current = coverTools;
    setToolsNote(coverTools ? 'Developer mode on' : 'Developer mode off');
    const t = setTimeout(() => setToolsNote(''), 2200);
    return () => clearTimeout(t);
  }, [coverTools]);

  // Covers published for everyone: one quiet check shortly after launch and when the app comes back to the front.
  // It is throttled inside (10 min, ETag), never blocks drawing, and a failure just keeps the saved copy.
  useEffect(() => {
    consumeAuthRedirect();
    if (currentUser()) void checkAdmin(); // asked of the database; only decides whether the owner's tools show
    const t = setTimeout(() => { void syncSharedCovers(); void syncCatalog(); }, 3000);
    const onShow = () => { if (document.visibilityState === 'visible') { void syncSharedCovers(); void syncCatalog(); } };
    document.addEventListener('visibilitychange', onShow);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', onShow); };
  }, []);
  // Owner only: what the app fetches is also kept in the catalog as hidden candidates (to review, publish or reject), and what this device already has is sent once.
  useSyncExternalStore(subscribeAuth, authVersion, authVersion);
  const ownerSignedIn = !!currentUser() && isAdminKnown() === true;
  const booksRef = useRef(allBooks);
  booksRef.current = allBooks;
  useEffect(() => { initCapture(); }, []);
  useEffect(() => {
    if (!ownerSignedIn) return;
    const t = setTimeout(() => maybeBackfill(booksRef.current), 8000);
    return () => clearTimeout(t);
  }, [ownerSignedIn]);
  // Cloud backup (only if turned on in Backup & Restore and signed in): a quiet upload every few minutes and when the app goes to the background.
  const exportRef = useRef(exportBackup);
  exportRef.current = exportBackup;
  useEffect(() => {
    const run = () => void autoBackup(() => exportRef.current());
    const t = setInterval(run, 5 * 60 * 1000);
    const onHide = () => { if (document.visibilityState === 'hidden') run(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onHide); };
  }, []);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [libAddMenuOpen, setLibAddMenuOpen] = useState(false); // the + in the Library header: Add book / Add shelf
  const [newShelfRequest, setNewShelfRequest] = useState(0);
  const { collections, update: updateCollections, reload: reloadCollections } = useLibraryCollections(); // your own shelves and tags
  const [sheetBook, setSheetBook] = useState<Book | null>(null); // the Add to My Library sheet (status, shelves, tags)
  const [showWordPracticeModal, setShowWordPracticeModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState<{ open: boolean; type: 'books' | 'words' }>({
    open: false,
    type: 'books',
  });

  // Customize Shelves is switched on from the page header and footer, so the flag lives here (the layout itself is kept by StoreTab)
  const [customizing, setCustomizing] = useState(false);

  // New-version detection (prompts only when the code really changed)
  const update = useAppUpdate();

  // Books categorization
  const nowReadingBooks = useMemo(() => {
    const statusMap = state.status || {};
    // The book you read most recently comes first
    return readingNowOrder(allBooks.filter(b => statusMap[String(b.id)] === 'now'), state.history);
  }, [allBooks, state.status, state.history]);

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

  // The books whose own rating wins (ratings policy, step 1). One array per library, so its index (see indexKnownRatings) is built once, not on every render.
  // Discover cards show where each book you own stands (status) and your own stars, as one short chip
  const discoverLine = useMemo(() => {
    const byId = new Map(allBooks.map(b => [String(b.id), b]));
    return (b: Book): string | undefined => {
      const owned = byId.get(String(b.id)) ?? allBooks.find(x => sameWork(x, b, true));
      const key = String(owned ? owned.id : b.id);
      const mine = state.ratings[key] ?? (owned ? undefined : state.ratings[`w:${bookKey(b)}`]);
      const stars = mine ? `★ ${formatRating(mine)}` : '';
      if (!owned) return stars || undefined;
      const st = state.status[key];
      // A short chip for the shelf card: where the book stands in the library, plus your own stars. Pages and dates stay in the library.
      const where =
        st === 'now' ? 'Reading now'
        : st === 'next' ? 'Up next'
        : st === 'done' ? 'Finished'
        : st === 'dnf' ? 'Did not finish'
        : st === 'skip' ? 'Not for me' : 'In My Library';
      return [where, stars].filter(Boolean).join(' · ') || undefined;
    };
  }, [allBooks, state.status, state.currentPage, state.totalPages, state.history, state.ratings]);

  const knownPool = useMemo(() => [...DEFAULT_BOOKS, ...libraryBooks], [libraryBooks]);

  // Fill in missing ratings / pages / year / synopsis / author bio in the background while the app is open (a few books at a time, paused when hidden or
  // offline; see services/books/infoQueue.ts), so Book Info already has them. Reading now / up next first, then the library, then the built-in books.
  useEffect(() => {
    const t = setTimeout(() => {
      enrichInBackground([...nowReadingBooks, ...upNextBooks, ...libraryBooks], 0);
      enrichInBackground(DEFAULT_BOOKS, 1);
    }, 4000); // not during startup: the screen comes first
    return () => clearTimeout(t);
  }, [nowReadingBooks, upNextBooks, libraryBooks]);

  // Remember the covers you'll see first (the nook shelves, then reading now / up next) so the next launch can start
  // loading them before the app code runs. Same 'M' size URLs the nook and cards request, so it is one shared cache.
  // The service worker is also asked to download them in the background, so they are on the device the next time.
  useEffect(() => {
    try {
      const urls = [...nowReadingBooks, ...upNextBooks, ...sceneBooks]
        .map(b => getCoverPick(b, 'M') || getCoverUrl(b.coverId, 'M', b.coverUrl))
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
  const statusOf = state.status;
  const confirmRemoveFromLibrary = useCallback((b: Book) => {
    const message = statusOf[String(b.id)] === 'done'
      ? `Remove "${b.title}" from your finished books? Its notes and highlights will be removed too.`
      : b.isOnDevice
        ? `Remove "${b.title}" from your books? It is also on your device, and its notes and highlights will be removed too.`
        : `Remove "${b.title}" from library?`;
    if (!confirm(message)) return false;
    removeBook(b.id);
    return true;
  }, [removeBook, statusOf]);
  const editWord = useCallback((w: WordItem) => setShowLookupModal({ open: true, existingWord: w }), []);
  const lookupAgain = useCallback((word: string) => setShowLookupModal({ open: true, initialWord: word }), []);
  // Tabs ask App to open the modals (App owns every modal's state)
  const openAddBook = useCallback(() => setShowAddBookModal(true), []);
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
            <h1
              className={`font-serif-display text-3xl sm:text-4xl md:text-5xl leading-tight text-[#201a15] dark:text-[#f0e6d6]${tab === 'today' ? ' select-none' : ''}`}
              style={tab === 'today' ? { touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' } : undefined}
              onClick={tab === 'today' ? () => void tapSecret() : undefined}
            >
              {tab === 'today' ? `Hello${state.profile.name ? `, ${state.profile.name}` : ''}` : TAB_TITLES[tab] || 'My reading life'}
            </h1>
            <span className="sr-only" role="status" aria-live="polite">{toolsNote}</span>
            {toolsNote && <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#e8efe7] dark:bg-[#243422] text-[#2e5934] dark:text-[#86b880]" aria-hidden="true">{toolsNote}</span>}
            {tab === 'today' && (
              <p className="text-sm sm:text-base text-[#706256] dark:text-[#a89a8a] mt-1 ">
                A quiet corner, a warm cup, and {state.goal} pages.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {(tab === 'store' || tab === 'search') && (
              <button
                onClick={openAddBook}
                className="w-10 h-10 aspect-square rounded-full border border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17] text-[#2e5934] dark:text-[#86b880] flex items-center justify-center shrink-0 shadow-xs active:scale-95 transition-all hover:border-[#2e5934] dark:hover:border-[#86b880]"
                title="Add a book"
                aria-label="Add book"
              >
                <Plus className="w-5 h-5 text-[#2e5934] dark:text-[#86b880]" />
              </button>
            )}
            {tab === 'store' && (
              <button
                onClick={() => setCustomizing(c => !c)}
                className={`w-10 h-10 aspect-square rounded-full border bg-[#fbf7ee] dark:bg-[#231d17] text-[#2e5934] dark:text-[#86b880] flex items-center justify-center shrink-0 shadow-xs active:scale-95 transition-all hover:border-[#2e5934] dark:hover:border-[#86b880] ${customizing ? 'border-[#2e5934] dark:border-[#86b880] ring-2 ring-[#2e5934]/30' : 'border-[#e3d7c3] dark:border-[#382f25]'}`}
                title="Customize Shelves: reorder, hide and refresh shelves"
                aria-label="Customize Shelves"
                aria-pressed={customizing}
              >
                <SlidersHorizontal className="w-4 h-4 text-[#2e5934] dark:text-[#86b880]" />
              </button>
            )}
            {tab === 'lib' && (
              <div className="relative shrink-0">
                <button
                  onClick={() => setLibAddMenuOpen(o => !o)}
                  className={`w-10 h-10 aspect-square rounded-full border bg-[#fbf7ee] dark:bg-[#231d17] text-[#2e5934] dark:text-[#86b880] flex items-center justify-center shrink-0 shadow-xs active:scale-95 transition-all hover:border-[#2e5934] dark:hover:border-[#86b880] ${libAddMenuOpen ? 'border-[#2e5934] dark:border-[#86b880] ring-2 ring-[#2e5934]/30' : 'border-[#e3d7c3] dark:border-[#382f25]'}`}
                  title="Add a book or a shelf"
                  aria-label="Add"
                  aria-haspopup="menu"
                  aria-expanded={libAddMenuOpen}
                >
                  <Plus className="w-5 h-5 text-[#2e5934] dark:text-[#86b880]" />
                </button>
                {libAddMenuOpen && (
                  <>
                    <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close menu" tabIndex={-1} onClick={() => setLibAddMenuOpen(false)} />
                    <div role="menu" className="absolute right-0 top-12 z-50 w-40 rounded-2xl border border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17] shadow-xl overflow-hidden">
                      <button
                        role="menuitem"
                        onClick={() => { setLibAddMenuOpen(false); openAddBook(); }}
                        className="w-full px-4 py-3 text-left text-sm text-[#201a15] dark:text-[#f0e6d6] hover:bg-black/5"
                      >
                        Add book
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => { setLibAddMenuOpen(false); openPasteList(); }}
                        className="w-full px-4 py-3 text-left text-sm text-[#201a15] dark:text-[#f0e6d6] hover:bg-black/5 border-t border-[#e3d7c3] dark:border-[#382f25]"
                      >
                        Paste list
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => { setLibAddMenuOpen(false); setNewShelfRequest(n => n + 1); }}
                        className="w-full px-4 py-3 text-left text-sm text-[#201a15] dark:text-[#f0e6d6] hover:bg-black/5 border-t border-[#e3d7c3] dark:border-[#382f25]"
                      >
                        Add shelf
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            {tab !== 'store' && tab !== 'search' && tab !== 'lib' && (
            <button
              onClick={() => setShowShareModal(true)}
              className="w-10 h-10 aspect-square rounded-full border border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17] text-[#2e5934] dark:text-[#86b880] flex items-center justify-center shrink-0 shadow-xs active:scale-95 transition-all hover:border-[#2e5934] dark:hover:border-[#86b880]"
              title="Share app link or open on iPhone/iPad"
              aria-label="Share app link"
            >
              <Share2 className="w-4 h-4 text-[#2e5934] dark:text-[#86b880]" />
            </button>
            )}

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
              Your latest changes could not be saved on this device: its storage is full or blocked, even after the app cleared its temporary cache. They are still on screen, but closing the app now would lose them. Open Backup and download or copy your data now.
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
            onOpenSheet={setSheetBook}
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
            mine={discoverLine}
          />
        )}

        {/* Tab 3: LIBRARY VIEW */}
        {visitedTabs.has('lib') && (
          <LibraryTab
            active={tab === 'lib'}
            myBooks={allBooks}
            state={state}
            handleOpenCover={handleOpenCover}
            handleOpenHighlights={handleOpenHighlights}
            setBookStatus={setBookStatus}
            confirmRemoveFromLibrary={confirmRemoveFromLibrary}
            newShelfRequest={newShelfRequest}
            collections={collections}
            onCollectionsChange={updateCollections}
            onOpenSheet={setSheetBook}
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

        {/* Tab 5: SEARCH VIEW (the same search as Discover, and genres to browse) */}
        {visitedTabs.has('search') && (
          <SearchTab
            active={tab === 'search'}
            allBooks={allBooks}
            handleOpenCover={handleOpenCover}
            moreLike={moreLike}
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
                title="Customize Shelves: reorder, hide and refresh shelves"
                aria-label="Customize Shelves"
                aria-pressed={customizing}
              >
                <SlidersHorizontal className="w-4 h-4 text-[#2e5934] dark:text-[#86b880]" />
              </button>
            )}
            {(tab === 'store' || tab === 'search') && (
              <button
                onClick={openAddBook}
                className="w-10 h-10 aspect-square rounded-full border border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17] text-[#2e5934] dark:text-[#86b880] flex items-center justify-center shrink-0 shadow-xs active:scale-95 transition-all hover:border-[#2e5934] dark:hover:border-[#86b880]"
                title="Add a book"
                aria-label="Add book"
              >
                <Plus className="w-5 h-5 text-[#2e5934] dark:text-[#86b880]" />
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
          { id: 'store', label: 'Discover', Icon: Compass },
          { id: 'lib', label: 'Library', Icon: Library },
          { id: 'words', label: 'Words', Icon: Sprout },
          { id: 'search', label: 'Search', Icon: Search },
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
          </button>
        ))}
      </nav>

      {/* Modal 1: Apple Books Detail Modal (when tapping any book cover) */}
      {selectedBookForDetail && (() => {
        // The same book can sit in the library under a different record id (search vs Store vs NYT): use the one you own
        const owned = allBooks.find(b => b.id === selectedBookForDetail.id)
          ?? allBooks.find(b => sameWork(b, selectedBookForDetail, true));
        const ownKey = String(owned ? owned.id : selectedBookForDetail.id);
        // A book not on your list yet keeps your stars under its identity, so they follow it when you add it (whichever copy you add)
        const ratingKey = owned ? ownKey : `w:${bookKey(selectedBookForDetail)}`;
        // Search, Store and NYT copies of a book you own show YOUR copy's rating, so one book never shows two ratings
        const shownBook = withKnownRating(selectedBookForDetail, knownPool);
        return (
        <AppleBookDetailModal
          book={shownBook}
          inLibrary={!!owned}
          readingStatus={state.status[ownKey]}
          currentPage={state.currentPage[ownKey]}
          totalPages={state.totalPages[ownKey]}
          note={state.notes[ownKey]}
          highlightsCount={(state.highlights[ownKey] || []).length}
          history={state.history[ownKey]}
          userRating={state.ratings[ratingKey] ?? state.ratings[ownKey]}
          onRate={stars => { setBookRating(ratingKey, stars); if (ratingKey !== ownKey) setBookRating(ownKey, 0); }}
          onEditHistory={patch => setBookHistory(ownKey, patch)}
          onUpdateProgress={(page, total) => updateBookProgress(ownKey, page, total)}
          onClose={() => setSelectedBookForDetail(null)}
          onMoreLikeThis={() => { setMoreLike({ book: selectedBookForDetail }); setSelectedBookForDetail(null); goTab('search'); }}
          onOpenLibrarySheet={() => setSheetBook(owned ?? selectedBookForDetail)}
          onOpenHighlights={() => {
            const b = owned ?? selectedBookForDetail;
            setSelectedBookForDetail(null);
            setSelectedBookForHighlights(b);
          }}
        />
        );
      })()}

      {sheetBook && (() => {
        // The record this book is (or would be) kept under: a copy of the same book you already have, else its own id
        const key = resolveLibraryId(state, sheetBook);
        const isOwned = allBooks.some(b => String(b.id) === key);
        return (
          <LibrarySheet
            book={sheetBook}
            inLibrary={isOwned}
            status={state.status[key] || 'list'}
            shelves={collections.filter(c => c.kind === 'shelf')}
            tags={collections.filter(c => c.kind === 'tag')}
            checked={collections.filter(c => c.bookIds.includes(key)).map(c => c.id)}
            onCreate={(kind, name) => {
              const c = makeCollection(kind, name);
              if (!c) return null;
              updateCollections(prev => [...prev, c]);
              return c.id;
            }}
            onRemove={isOwned ? () => {
              const mine = allBooks.find(b => String(b.id) === key);
              if (mine && confirmRemoveFromLibrary(mine)) setSheetBook(null);
            } : undefined}
            onApply={({ status, chosen }) => {
              if (!isOwned) addBook(sheetBook, 'library', 'list');
              if (status !== (isOwned ? state.status[key] || 'list' : 'list')) setBookStatus(key, status);
              updateCollections(prev => setBookMembership(prev, key, new Set(chosen)));
              setSheetBook(null);
            }}
            onClose={() => setSheetBook(null)}
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
      {showAddBookModal && (
        <AddBookModal
          onClose={() => setShowAddBookModal(false)}
          onAddBook={newBook => {
            addBook(newBook, 'library');
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
          onOpenCoverPublish={coverTools ? () => setShowCoverPublish(true) : undefined}
          libraryBooks={allBooks}
          onOpenCatalogReview={() => setShowCatalogReview(true)}
        />
      )}

      {coverTools && showCoverPublish && <CoverPublishModal onClose={() => setShowCoverPublish(false)} />}
      {showCatalogReview && <CatalogReviewModal onClose={() => setShowCatalogReview(false)} />}

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
          onAddBooks={books => {
            books.forEach(b => addBook(b, 'library'));
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
          onImportBackup={json => { const ok = importBackup(json); if (ok) reloadCollections(); return ok; }}
          onClearLibrary={clearLibrary}
          onFindDuplicates={findDuplicates}
          onMergeDuplicates={() => { const n = mergeDuplicates(); reloadCollections(); return n; }}
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
