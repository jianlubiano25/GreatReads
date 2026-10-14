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
