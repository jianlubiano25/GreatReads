import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Book, BookStatus, ReadingState, UserProfile, WordItem, HighlightItem } from '../types';
import { DEFAULT_BOOKS } from '../data/defaultBooks';
import { INITIAL_WORDS } from '../data/defaultWords';
import { normalizeV2, normalizeLegacy, parseBackup } from '../services/stateSanitizer';
import { computeSnapshot, currentStreakFor, evaluateGarden, markCelebrated, movePlant as movePlantIn, pendingCelebrations, seedGarden } from '../services/garden';
import { dateKey } from '../services/dates';
import { applyHistoryEdit, applyRating, stampProgress, stampStatus, type HistoryPatch } from '../services/bookHistory';
import { applyAddBook, type AddDestination, type AddStatus } from '../services/library';
import { clearableCacheKeys } from '../services/books/cache';
import { exportCoverPicks, restoreCoverPicksFromBackup } from '../services/books/covers';
import { displayBook, refreshNames, subscribeNames } from '../services/books/englishTitle';
import { mapPool } from '../services/books/http';
import { exportNookLook, restoreNookLook } from '../services/nookPrefs';
import { exportDeviceSettings, restoreDeviceSettings } from '../services/deviceSettings';
import { applyMerge, findDuplicateGroups, idMapOf, remapCollections } from '../services/mergeDuplicates';
import { exportCollections, loadCollections, restoreCollectionsFromBackup, saveCollections } from '../services/libraryCollections';
import { markPersonalAnnotationDeleted, markPersonalBookDeleted, unmarkPersonalAnnotationDeleted, unmarkPersonalBookDeleted } from '../services/librarySync';
import { stampDayEdit } from '../services/dailyPagesSync';
import { withEdits, withWordsDeleted } from '../services/editTimes';

// Small helper lists that are not persistentCache instances but can be rebuilt (never user data)
export const EXTRA_CLEARABLE = ['readlife.preload', 'readlife.loaded', 'readlife.phoneticTried'];

const STORAGE_KEY = 'readlife.v2';
const LEGACY_KEY = 'readlife.v1';
const RECOVERY_KEY = 'readlife.v2.recovery';
const SAVE_DELAY_MS = 350;
// Things the app can download again live in one registry (books/cache.ts); the cleanup below clears exactly those

export function getTodayKey(): string {
  return dateKey(); // "YYYY-MM-DD" in local time
}

/** A brand-new install starts empty: no names, notes, highlights or reading history. */
function buildDefaultState(): ReadingState {
  return {
    status: {},
    currentPage: {},
    totalPages: {},
    dailyLog: {},
    notes: {},
    highlights: {},
    goal: 10,
    readingIntention: '',
    profile: { name: '', photo: '', theme: 'auto' },
    customBooks: [],
    onDeviceOverrides: {},
    hiddenBookIds: {},
    words: [...INITIAL_WORDS],
    // Starter plants are owned from the first launch (no celebration prompt for them).
    garden: seedGarden({ dailyLog: {}, goal: 10, status: {}, todayKey: getTodayKey() }),
    history: {},
    ratings: {},
  };
}

/** Everything blank: no books (catalog books hidden), no words, no highlights, no reading history, fresh garden. */
function buildEmptyState(): ReadingState {
  return {
    ...buildDefaultState(),
    words: [],
    hiddenBookIds: Object.fromEntries(DEFAULT_BOOKS.map(b => [String(b.id), true as const])),
  };
}

export function useReadingLife() {
  const [state, setState] = useState<ReadingState>(() => {
    const defaults = buildDefaultState();

    // 1. Try reading v2 (repaired field-by-field so bad saved data can never crash the app)
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return normalizeV2(parsed, defaults);
        }
      }
    } catch (e) {
      console.warn('Failed to parse state from v2 storage:', e);
      // Keep the unreadable text so it can be recovered; the app is about to save fresh defaults over it.
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw && !localStorage.getItem(RECOVERY_KEY)) localStorage.setItem(RECOVERY_KEY, raw);
      } catch {}
    }

    // 2. Try migrating legacy Claude v1 state
    try {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const p = JSON.parse(legacy);
        if (p && typeof p === 'object') return normalizeLegacy(p, defaults);
      }
    } catch (e) {
      console.warn('Failed to migrate from legacy storage:', e);
    }

    // 3. Fresh install: pre-seeded with your reading profile
    return defaults;
  });

  // Save to localStorage: debounced (typing in notes no longer re-serialises everything on every keystroke)
  // and flushed immediately when the app is hidden/closed so nothing is lost on iPad/iPhone.
  const latestState = useRef(state);
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [saveError, setSaveError] = useState(false);

  const resetting = useRef(false); // true while "Reset everything" is wiping the device: nothing may be written back
  const flushSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    if (!dirty.current || resetting.current) return;
    const write = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(latestState.current));
    try {
      write();
      dirty.current = false;
      setSaveError(false);
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
      // Storage is full or blocked. Throw away the re-downloadable caches first, then try once more.
      try {
        for (const k of [...clearableCacheKeys(), ...EXTRA_CLEARABLE]) localStorage.removeItem(k);
        write();
        dirty.current = false;
        setSaveError(false);
      } catch {
        setSaveError(true);
      }
    }
  }, []);

  useEffect(() => {
    latestState.current = state;
    dirty.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, SAVE_DELAY_MS);
  }, [state, flushSave]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushSave(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushSave);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushSave);
      flushSave();
    };
  }, [flushSave]);

  // Today's date key, refreshed at midnight and whenever the app comes back to the foreground,
  // so a home-screen app left open overnight starts the new day at 0 pages.
  const [todayKey, setTodayKey] = useState(getTodayKey);
  useEffect(() => {
    const refresh = () => setTodayKey(prev => {
      const k = getTodayKey();
      return k === prev ? prev : k;
    });
    const tick = () => { if (document.visibilityState !== 'hidden') refresh(); }; // coming back to the app refreshes (below), so a hidden app need not
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    const timer = setInterval(tick, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
      clearInterval(timer);
    };
  }, []);

  // Sync dark theme (also keeps the iOS status-bar colour in step with the app)
  useEffect(() => {
    const theme = state.profile.theme;
    const root = document.documentElement;
    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    const apply = () => {
      const dark = theme === 'dark' || (theme === 'auto' && !!mq?.matches);
      for (const el of [root, document.body]) {
        if (!el) continue;
        el.classList.toggle('dark', dark);
        el.setAttribute('data-theme', dark ? 'dark' : 'light');
      }
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#181410' : '#f5f0e6');
    };
    apply();

    if (theme === 'auto' && mq) {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [state.profile.theme]);

  const [namesTick, setNamesTick] = useState(0);
  useEffect(() => subscribeNames(() => setNamesTick(n => n + 1)), []); // an owner's title/author choice redraws the lists

  // Merge default books + custom books with overrides
  const allBooks = useMemo<Book[]>(() => {
    const map = new Map<string | number, Book>();

    // 1. Load curated default books
    for (const b of DEFAULT_BOOKS) {
      if (state.hiddenBookIds[String(b.id)]) continue;
      const onDevice = state.onDeviceOverrides[String(b.id)] !== undefined
        ? state.onDeviceOverrides[String(b.id)]
        : b.isOnDevice;
      map.set(b.id, { ...b, isOnDevice: onDevice });
    }

    // 2. Load custom books
    for (const b of state.customBooks) {
      if (state.hiddenBookIds[String(b.id)]) continue;
      const onDevice = state.onDeviceOverrides[String(b.id)] !== undefined
        ? state.onDeviceOverrides[String(b.id)]
        : b.isOnDevice;
      map.set(b.id, { ...b, isOnDevice: onDevice });
    }

    // English title and jacket author name, from what is already known (instant; the saved records are not changed)
    return Array.from(map.values()).map(displayBook);
  }, [state.customBooks, state.hiddenBookIds, state.onDeviceOverrides, namesTick]);

  // What is not known yet is looked up in the background, a few books at a time and each book once a month (all saved books, finished ones too), and shown as soon as it is learned
  useEffect(() => {
    const t = setTimeout(() => {
      const todo = state.customBooks.slice(0, 60);
      void mapPool(todo, 2, async b => { if (await refreshNames(b).catch(() => false)) setNamesTick(n => n + 1); });
    }, 3000);
    return () => clearTimeout(t);
  }, [state.customBooks]);

  // Daily log metrics
  const todayPages = state.dailyLog[todayKey] || 0;

  const currentStreak = useMemo(
    () => currentStreakFor(state.dailyLog, state.goal, todayKey),
    [state.dailyLog, state.goal, todayKey],
  );

  // Garden: award newly reached milestones and keep plants in step with the pages you have logged.
  // A streak that ended still counts, but fixing a wrongly typed page count takes back what it earned.
  // evaluateGarden returns the same object when nothing changed, so this does not cause extra renders.
  useEffect(() => {
    setState(prev => {
      const snap = computeSnapshot({
        dailyLog: prev.dailyLog, goal: prev.goal, status: prev.status, todayKey,
        highlights: prev.highlights, words: prev.words,
      });
      const next = evaluateGarden(prev.garden, snap);
      return next === prev.garden ? prev : { ...prev, garden: next };
    });
  }, [state.dailyLog, state.goal, state.status, state.highlights, state.words, todayKey]);

  // Rearranging only changes where a plant stands (placements); what you own never changes
  const movePlant = useCallback((plantId: string, areaId: string, index: number) => {
    setState(prev => {
      const next = movePlantIn(prev.garden, plantId, areaId, index);
      return next === prev.garden ? prev : { ...prev, garden: next };
    });
  }, []);

  // Plants whose "a new plant has arrived" prompt has not been shown yet
  const newPlantIds = useMemo(() => pendingCelebrations(state.garden), [state.garden]);
  const markPlantsCelebrated = useCallback((ids: string[]) => {
    setState(prev => {
      const next = markCelebrated(prev.garden, ids);
      return next === prev.garden ? prev : { ...prev, garden: next };
    });
  }, []);

  // Actions
  // Set an exact page count for any day (used by tapping a day in the week strip)
  const setDayPages = useCallback((dateKey: string, pages: number) => {
    setState(prev => {
      const value = Math.max(0, pages);
      if (prev.dailyLog[dateKey] === value) return prev; // nothing changed, so nothing to stamp
      return { ...prev, dailyLog: { ...prev.dailyLog, [dateKey]: value }, dailyLogMeta: stampDayEdit(prev.dailyLogMeta, dateKey) };
    });
  }, []);

  const updateBookProgress = useCallback((bookId: string | number, page: number, total?: number) => {
    const idKey = String(bookId);
    setState(prev => {
      const oldPage = prev.currentPage[idKey] || 0;
      const diff = Math.max(0, page) - oldPage; // negative when you correct a page number back down
      const todayK = getTodayKey();

      return {
        ...prev,
        currentPage: {
          ...prev.currentPage,
          [idKey]: Math.max(0, page),
        },
        totalPages: total ? {
          ...prev.totalPages,
          [idKey]: total,
        } : prev.totalPages,
        dailyLog: diff !== 0 ? {
          ...prev.dailyLog,
          [todayK]: Math.max(0, (prev.dailyLog[todayK] || 0) + diff),
        } : prev.dailyLog,
        dailyLogMeta: diff !== 0 ? stampDayEdit(prev.dailyLogMeta, todayK) : prev.dailyLogMeta,
        // Reading pages starts the book and makes it the latest one you read
        history: diff > 0 ? { ...prev.history, [idKey]: stampProgress(prev.history[idKey], todayK, Date.now()) } : prev.history,
      };
    });
  }, []);

  const setBookStatus = useCallback((bookId: string | number, status: BookStatus) => {
    const idKey = String(bookId);
    setState(prev => {
      const next = {
        ...prev,
        status: {
          ...prev.status,
          [idKey]: status,
        },
        history: { ...prev.history, [idKey]: stampStatus(prev.history[idKey], prev.status[idKey], status, getTodayKey(), Date.now()) },
      };
      return prev.status[idKey] === status ? next : withEdits(next, 'status', [idKey]);
    });
  }, []);

  /** Edit when a book was added, started or finished (null clears a date). */
  const setBookHistory = useCallback((bookId: string | number, patch: HistoryPatch) => {
    setState(prev => applyHistoryEdit(prev, bookId, patch, getTodayKey()));
  }, []);

  /** Your own star rating of a book (0 takes it back). */
  const setBookRating = useCallback((bookId: string | number, stars: number) => {
    setState(prev => applyRating(prev, bookId, stars));
  }, []);

  /** Books that are in the Library more than once (changes nothing). */
  const findDuplicates = useCallback(() => findDuplicateGroups(latestState.current), []);

  /** Folds every duplicate into one book, keeping status, pages, notes, quotes, dates and rating. Returns how many books were merged. */
  const mergeDuplicates = useCallback((): number => {
    const groups = findDuplicateGroups(latestState.current);
    if (!groups.length) return 0;
    groups.forEach(group => group.otherIds.forEach(markPersonalBookDeleted));
    setState(prev => applyMerge(prev, findDuplicateGroups(prev)));
    saveCollections(remapCollections(loadCollections(), idMapOf(groups))); // your own tags and shelves follow the kept copy
    return groups.length;
  }, []);

  const toggleOnDevice = useCallback((bookId: string | number, targetValue?: boolean) => {
    const idKey = String(bookId);
    setState(prev => {
      const base = prev.customBooks.find(b => String(b.id) === idKey) ?? DEFAULT_BOOKS.find(b => String(b.id) === idKey);
      const current = prev.onDeviceOverrides[idKey] ?? base?.isOnDevice ?? false;
      const nextValue = targetValue !== undefined ? targetValue : !current;

      return {
        ...prev,
        onDeviceOverrides: {
          ...prev.onDeviceOverrides,
          [idKey]: nextValue,
        },
        customBooks: prev.customBooks.map(cb =>
          String(cb.id) === idKey ? { ...cb, isOnDevice: nextValue } : cb
        ),
      };
    });
  }, []);

  const addBook = useCallback((incoming: Book, destination: AddDestination = 'library', status?: AddStatus) => {
    unmarkPersonalBookDeleted(String(incoming.id));
    setState(prev => applyAddBook(prev, incoming, destination, status));
  }, []);

  const removeBook = useCallback((bookId: string | number) => {
    const idKey = String(bookId);
    markPersonalBookDeleted(idKey);
    setState(prev => {
      const isCustom = prev.customBooks.some(b => String(b.id) === idKey);
      if (!isCustom) {
        // Catalog books are only hidden (they can be restored with their notes intact)
        return withEdits({ ...prev, hiddenBookIds: { ...prev.hiddenBookIds, [idKey]: true } }, 'hidden', [idKey]);
      }
      const without = <T,>(rec: Record<string, T>) => {
        const { [idKey]: _gone, ...rest } = rec;
        return rest;
      };
      return {
        ...prev,
        customBooks: prev.customBooks.filter(b => String(b.id) !== idKey),
        status: without(prev.status),
        currentPage: without(prev.currentPage),
        totalPages: without(prev.totalPages),
        notes: without(prev.notes),
        highlights: without(prev.highlights),
        history: without(prev.history),
        ratings: without(prev.ratings),
        onDeviceOverrides: without(prev.onDeviceOverrides),
      };
    });
  }, []);

  const restoreHiddenBooks = useCallback(() => {
    // Un-hiding is an edit: each book that was hidden gets a newer stamp, so another device cannot hide it again
    setState(prev => withEdits({ ...prev, hiddenBookIds: {} }, 'hidden', Object.keys(prev.hiddenBookIds)));
  }, []);

  const updateBookNote = useCallback((bookId: string | number, note: string) => {
    const idKey = String(bookId);
    if (!note.trim()) markPersonalAnnotationDeleted(idKey, 'note'); else unmarkPersonalAnnotationDeleted(idKey, 'note'); // writing a note again after clearing it is a newer edit
    setState(prev => prev.notes[idKey] === note ? prev : withEdits({
      ...prev,
      notes: {
        ...prev.notes,
        [idKey]: note,
      },
    }, 'note', [idKey]));
  }, []);

  const addHighlight = useCallback((bookId: string | number, text: string, page?: number) => {
    const idKey = String(bookId);
    const newHighlight: HighlightItem = {
      id: `hl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text: text.trim(),
      page,
      timestamp: Date.now(),
    };
    setState(prev => withEdits({
      ...prev,
      highlights: {
        ...prev.highlights,
        [idKey]: [newHighlight, ...(prev.highlights[idKey] || [])],
      },
    }, 'highlight', [`${idKey}:${newHighlight.id}`]));
  }, []);

  const deleteHighlight = useCallback((bookId: string | number, highlightId: string) => {
    const idKey = String(bookId);
    markPersonalAnnotationDeleted(idKey, highlightId);
    setState(prev => withEdits({
      ...prev,
      highlights: {
        ...prev.highlights,
        [idKey]: (prev.highlights[idKey] || []).filter(h => h.id !== highlightId),
      },
    }, 'highlight', [`${idKey}:${highlightId}`])); // the stamp is the delete's time
  }, []);

  const updateHighlight = useCallback((bookId: string | number, highlightId: string, newText: string, newPage?: number) => {
    const idKey = String(bookId);
    setState(prev => withEdits({
      ...prev,
      highlights: {
        ...prev.highlights,
        [idKey]: (prev.highlights[idKey] || []).map(h =>
          h.id === highlightId ? { ...h, text: newText.trim(), page: newPage } : h
        ),
      },
    }, 'highlight', [`${idKey}:${highlightId}`]));
  }, []);

  const updateIntention = useCallback((readingIntention: string) => {
    setState(prev => ({ ...prev, readingIntention }));
  }, []);

  const updateProfile = useCallback((profileUpdates: Partial<UserProfile>) => {
    setState(prev => ({
      ...prev,
      profile: { ...prev.profile, ...profileUpdates },
    }));
  }, []);

  const setGoal = useCallback((goal: number) => {
    // One goal for every day: changing it re-judges your whole history (streaks, best week, plants) with the new number.
    setState(prev => (Math.max(1, goal) === prev.goal ? prev : { ...prev, goal: Math.max(1, goal) }));
  }, []);

  const addWord = useCallback((newWord: WordItem) => {
    setState(prev => {
      // Remove any existing word with same spelling to avoid duplicates
      const filtered = prev.words.filter(
        w => w.id !== newWord.id && (w.word || '').toLowerCase() !== (newWord.word || '').toLowerCase(),
      );
      const dropped = prev.words.filter(w => !filtered.includes(w) && w.id !== newWord.id).map(w => w.id); // same spelling replaced: those are deletes
      const base = withWordsDeleted({ ...prev, words: [newWord, ...filtered] }, dropped);
      // Re-adding a word that was deleted earlier must be newer than the delete
      return withEdits(base, 'word', [newWord.id], Math.max(Date.now(), (prev.deletedWords?.[newWord.id] ?? 0) + 1));
    });
  }, []);

  const toggleWordLearned = useCallback((wordId: string) => {
    setState(prev => withEdits({
      ...prev,
      words: prev.words.map(w => w.id === wordId ? { ...w, isLearned: !w.isLearned } : w),
    }, 'word', [wordId]));
  }, []);

  const setWordLearned = useCallback((wordId: string, learned: boolean) => {
    setState(prev => withEdits({
      ...prev,
      words: prev.words.map(w => (w.id === wordId ? { ...w, isLearned: learned } : w)),
    }, 'word', [wordId]));
  }, []);

  const updateWord = useCallback((wordId: string, updates: Partial<WordItem>) => {
    setState(prev => withEdits({
      ...prev,
      words: prev.words.map(w => w.id === wordId ? { ...w, ...updates } : w),
    }, 'word', [wordId]));
  }, []);

  const deleteWord = useCallback((wordId: string) => {
    setState(prev => withWordsDeleted({
      ...prev,
      words: prev.words.filter(w => w.id !== wordId),
    }, prev.words.some(w => w.id === wordId) ? [wordId] : []));
  }, []);

  /** Remove every book from the library (catalog books are only hidden, so "Restore hidden books" can bring them back). */
  const clearLibrary = useCallback(() => {
    const ids = new Set([...latestState.current.customBooks.map(book => String(book.id)), ...Object.keys(latestState.current.status), ...Object.keys(latestState.current.currentPage), ...Object.keys(latestState.current.totalPages), ...Object.keys(latestState.current.notes), ...Object.keys(latestState.current.highlights), ...Object.keys(latestState.current.history), ...Object.keys(latestState.current.ratings), ...Object.keys(latestState.current.onDeviceOverrides)]);
    ids.forEach(markPersonalBookDeleted);
    setState(prev => withEdits({
      ...prev,
      customBooks: [],
      hiddenBookIds: { ...prev.hiddenBookIds, ...Object.fromEntries(DEFAULT_BOOKS.map(b => [String(b.id), true as const])) },
      status: {},
      currentPage: {},
      totalPages: {},
      notes: {},
      highlights: {},
      history: {},
      ratings: {},
      onDeviceOverrides: {},
    }, 'hidden', DEFAULT_BOOKS.map(b => String(b.id))));
  }, []);

  /** Take every book off the device. Books stay in the library; nothing else changes. */
  const clearOnDevice = useCallback(() => {
    setState(prev => ({
      ...prev,
      onDeviceOverrides: Object.fromEntries([...DEFAULT_BOOKS, ...prev.customBooks].map(b => [String(b.id), false])),
      customBooks: prev.customBooks.map(b => (b.isOnDevice ? { ...b, isOnDevice: false } : b)),
    }));
  }, []);

  /** Erase everything this app keeps on the device (library, device books, words, quotes, reading history, garden, caches, settings) and start blank. */
  const resetEverything = useCallback(() => {
    resetting.current = true; // nothing may be written back while we wipe
    clearTimeout(saveTimer.current);
    try {
      const mine: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && /^(readlife|greatreads)/i.test(k)) mine.push(k);
      }
      mine.forEach(k => localStorage.removeItem(k));
      // Start from a truly empty state rather than "no save", which would bring back the built-in books and starter words
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buildEmptyState()));
    } catch {}
    window.location.reload();
  }, []);

  const exportBackup = useCallback(() => {
    // Covers you picked (the star in the cover viewer) travel with the backup; a backup without picks looks exactly as before
    const coverPicks = exportCoverPicks();
    const nookLook = exportNookLook(); // vine look, clock colours and nook decorations; absent when they are all default
    const libraryCollections = exportCollections(); // your own shelves and tags; absent when you have none
    const deviceSettings = exportDeviceSettings(); // store layout, fonts, nook toggles and name choices; absent when all are default and never changed
    return JSON.stringify({ ...state, ...(Object.keys(coverPicks).length ? { coverPicks } : {}), ...(nookLook ? { nookLook } : {}), ...(deviceSettings ? { deviceSettings } : {}), ...(libraryCollections ? { libraryCollections } : {}) }, null, 2);
  }, [state]);

  const importBackup = useCallback((jsonStr: string) => {
    const restored = parseBackup(jsonStr, buildDefaultState());
    if (!restored) return false;
    const before = latestState.current;
    const oldIds = new Set([...before.customBooks.map(book => String(book.id)), ...Object.keys(before.status), ...Object.keys(before.currentPage), ...Object.keys(before.notes), ...Object.keys(before.highlights), ...Object.keys(before.history), ...Object.keys(before.ratings)]);
    const restoredIds = new Set([...restored.customBooks.map(book => String(book.id)), ...Object.keys(restored.status), ...Object.keys(restored.currentPage), ...Object.keys(restored.notes), ...Object.keys(restored.highlights), ...Object.keys(restored.history), ...Object.keys(restored.ratings)]);
    for (const id of oldIds) {
      if (!restoredIds.has(id)) markPersonalBookDeleted(id);
      else {
        if (before.notes[id] && !restored.notes[id]) markPersonalAnnotationDeleted(id, 'note');
        const nextHighlights = new Set((restored.highlights[id] || []).map(item => item.id));
        for (const item of before.highlights[id] || []) if (!nextHighlights.has(item.id)) markPersonalAnnotationDeleted(id, item.id);
      }
    }
    restoreCoverPicksFromBackup(jsonStr); // a backup made before picks existed leaves the current picks alone
    restoreNookLook(jsonStr); // likewise for a backup made before the nook look was saved
    restoreDeviceSettings(jsonStr); // and for one made before store layout, fonts, nook toggles and name choices were saved
    restoreCollectionsFromBackup(jsonStr); // and for one made before shelves and tags were saved
    // A restore never shows "new plant" prompts: bring the garden up to date silently and mark everything as seen.
    const snap = computeSnapshot({
      dailyLog: restored.dailyLog, goal: restored.goal, status: restored.status, todayKey: getTodayKey(),
      highlights: restored.highlights, words: restored.words,
    });
    let garden = evaluateGarden(restored.garden, snap, Date.now(), { silent: true });
    garden = markCelebrated(garden, Object.keys(garden.plants));
    setState({ ...restored, garden });
    return true;
  }, []);

  const applySyncedState = useCallback((change: (prev: ReadingState) => ReadingState) => setState(prev => change(prev)), []);

  return {
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
    applySyncedState,
    clearLibrary,
    clearOnDevice,
    resetEverything,
    saveError,
  };
}
