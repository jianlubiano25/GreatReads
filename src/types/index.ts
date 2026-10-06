import type { BookCanon } from '../services/bookIdentity';

export type ShelfKey = 'heal' | 'love' | 'life' | 'joy' | 'prize' | 'world' | 'art' | 'mine';

export type BookStatus = 'list' | 'next' | 'now' | 'done' | 'skip';

export interface Book {
  id: string | number;
  title: string;
  author: string;
  shelf: ShelfKey;
  difficulty: number; // 0: unrated, 1: Easy, 2: Medium, 3: Long
  notes?: string;
  first12Order?: number;
  isNew?: boolean;
  isOnDevice: boolean;
  year: string;
  genre: string;
  summary: string;
  authorBio: string;
  pageCount: number;
  coverId?: number;
  coverUrl?: string;
  ratingAverage?: number;
  ratingCount?: number;
  spineColor?: string;
  source?: 'curated' | 'openlibrary' | 'google' | 'manual';
  addedAt?: number;
  awardLabel?: string; // e.g. "International Booker 2026" or "Service95 Pick"
  /** Behind-the-scenes identity (work/ISBN/volume ids) used only to match the same book across sources. Never replaces `id`. */
  canon?: BookCanon;
}

export interface WordItem {
  id: string;
  word: string;
  phonetic?: string;
  partOfSpeech?: string;
  definition: string;
  definitions?: string[];
  example?: string;
  etymology?: string;
  synonyms?: string[];
  bookId?: string | number;
  bookTitle?: string;
  quoteSentence?: string;
  audioUrl?: string;
  isLearned: boolean;
  addedAt: number;
}

export interface HighlightItem {
  id: string;
  text: string;
  page?: number;
  timestamp: number;
}

export interface UserProfile {
  name: string;
  photo: string;
  theme: 'auto' | 'light' | 'dark';
}

/** Garden numbers. Books/highlights/words are high-water marks (only go up); the reading-log ones are re-worked from the log each time. */
export interface GardenPeaks {
  bestStreak: number;
  tenPageDays: number; // days with 10+ pages
  maxPagesInDay: number;
  bestWeekGoalDays: number; // most goal-met days seen in any "last 7 days" window
  booksFinished: number;
  totalPages: number;
  highlights: number; // saved quotes/highlights
  wordsAdded: number;
  wordsLearned: number;
}

/** A plant the reader owns for good. Where it stands is stored separately in `placements`. */
export interface OwnedPlant {
  milestoneId: string;
  earnedAt: number;
  growth: number; // 0..1, high-water mark
  completedAt?: number; // set once growth reaches 1
}

/** Achievement -> Plant -> Placement: moving a plant never changes what was earned. */
export interface PlantPlacement {
  areaId: string;
  slot: number;
}

export interface GardenState {
  v: 1;
  peaks: GardenPeaks;
  achievements: Record<string, { earnedAt: number; plantId: string }>; // milestoneId -> award (each milestone once)
  plants: Record<string, OwnedPlant>; // plantId -> owned plant
  placements: Record<string, PlantPlacement>; // plantId -> where it stands
  celebrated: Record<string, true>; // plantIds whose "new plant" prompt was already shown
  vine: number; // 0..1 window vine growth, high-water mark
}

export interface ReadingState {
  status: Record<string, BookStatus>;
  currentPage: Record<string, number>;
  totalPages: Record<string, number>;
  dailyLog: Record<string, number>; // "YYYY-MM-DD" -> pages read
  notes: Record<string, string>;
  highlights: Record<string, HighlightItem[]>;
  goal: number;
  readingIntention: string;
  profile: UserProfile;
  customBooks: Book[];
  onDeviceOverrides: Record<string, boolean>; // bookId -> boolean
  hiddenBookIds: Record<string, boolean>;
  words: WordItem[];
  garden: GardenState;
}

export type TabType = 'today' | 'store' | 'lib' | 'words' | 'dev';
