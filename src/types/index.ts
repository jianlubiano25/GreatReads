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
}

export type TabType = 'today' | 'store' | 'lib' | 'words' | 'dev';
