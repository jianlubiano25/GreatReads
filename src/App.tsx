import React, { useState, useEffect, useMemo, useCallback, useRef, useSyncExternalStore, lazy, Suspense } from 'react';
import { Book, TabType, WordItem } from './types';
import { useReadingLife } from './hooks/useReadingLife';
import { getCoverPick, getCoverUrl, sameWork, withKnownRating, isCoverAdminOn, subscribeCoverAdmin, tapSecret, syncSharedCovers } from './services/books';
import { milestone } from './services/books/perf';
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
const CoverPublishModal = lazyModal<typeof import('./components/CoverPublishModal').CoverPublishModal>(() => import('./components/CoverPublishModal'), 'CoverPublishModal');
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

  useEffect(() => { milestone('app-mounted'); }, []);

  const [plantQueue, setPlantQueue] = useState<string[]>([]);
  useEffect(() => {
    if (!newPlantIds.length) return;
    setPlantQueue(q => [...q, ...newPlantIds.filter(id => !q.includes(id))]);
    markPlantsCelebrated(newPlantIds);
  }, [newPlantIds, markPlantsCelebrated]);

  const [tab, setTab] = useState<TabType>('today');
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<TabType>>(() => new Set<TabType>(['today']));
  const goTab = (id: TabType) => {
    setTab(id);
    setVisitedTabs(prev => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

  const [selectedBookForDetail, setSelectedBookForDetail] = useState<Book | null>(null);
  const [selectedBookForHighlights, setSelectedBookForHighlights] = useState<Book | null>(null);
  const [showAddBookModal, setShowAddBookModal] = useState<{ open: boolean; isDevice: boolean }>({ open: false, isDevice: false });
  const [showLookupModal, setShowLookupModal] = useState<{ open: boolean; initialWord?: string; existingWord?: WordItem | null }>({ open: false });
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showCoverPublish, setShowCoverPublish] = useState(false);
  const coverTools = useSyncExternalStore(subscribeCoverAdmin, isCoverAdminOn, isCoverAdminOn);
  const [toolsNote, setToolsNote] = useState('');
  const seenTools = useRef(coverTools);
  useEffect(() => {
    if (seenTools.current === coverTools) return;
    seenTools.current = coverTools;
    setToolsNote(coverTools ? 'Cover tools on' : 'Cover tools hidden');
    const t = setTimeout(() => setToolsNote(''), 2200);
    return () => clearTimeout(t);
  }, [coverTools]);

  useEffect(() => {
    const t = setTimeout(() => void syncSharedCovers(), 3000);
    const onShow = () => { if (document.visibilityState === 'visible') void syncSharedCovers(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', onShow); };
  }, []);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showWordPracticeModal, setShowWordPracticeModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState<{ open: boolean; type: 'books' | 'words' }>({ open: false, type: 'books' });
  const [customizing, setCustomizing] = useState(false);
  const update = useAppUpdate();

  // NOTE: This is a PARTIAL restore - full file continues below in next commit if needed
  // CRITICAL: Restoring minimal compilable shell - user must not deploy this intermediate state
  return (
    <div className="rl-shell min-h-dvh flex flex-col bg-[#f5f0e6] dark:bg-[#181410] text-[#201a15] dark:text-[#f0e6d6]">
      <main className="rl-main w-full max-w-[1140px] mx-auto px-4 sm:px-6 md:px-8 pt-6 sm:pt-8 flex flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <h1 className="font-serif-display text-3xl">Restoring…</h1>
        </header>
      </main>
    </div>
  );
}
