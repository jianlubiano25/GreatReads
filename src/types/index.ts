export type ShelfKey = 'heal' | 'love' | 'life' | 'joy' | 'prize' | 'world' | 'art' | 'mine';

/** list = on My Library with no status; skip = "Not for me"; dnf = "Did not finish" */
export type BookStatus = 'list' | 'next' | 'now' | 'done' | 'skip' | 'dnf';

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
  /** Place in a popularity-sorted catalog list (0 = most read): set by a genre search, never saved with your data */
  popularRank?: number;
  /** Which site ratingAverage + ratingCount came from (the two always come from the same one). Older saved books have none; it is then worked out when needed. */
  ratingSource?: 'openlibrary' | 'google' | 'apple' | 'library';
  spineColor?: string;
  /** The title the book was saved under when GreatReads replaced it with its English one ("変な絵" -> "Strange Pictures"): kept so the original still finds it in a search. */
  originalTitle?: string;
  /** Set only on a copy drawn with the jacket / chosen author name (displayBook): the author as saved, so the alias group stays one identity. Never saved. */
  originalAuthor?: string;
  source?: 'curated' | 'openlibrary' | 'google' | 'apple' | 'nyt' | 'manual';
  addedAt?: number;
  awardLabel?: string; // e.g. "International Booker 2026" or "Service95 Pick"
  /** Where this book sits in the outside world (work + edition ids). Separate from `id`, which is GreatReads' own record id and never changes. */
  identity?: BookIdentity;
}

/**
 * Work = the book as a creation (Open Library work id). Edition = one publication of it (ISBNs, Open Library edition id,
 * Google Books volume id). Used only to recognise the same book across sources and to pick exact-edition covers.
 */
export interface BookIdentity {
  olWork?: string; // "OL123W"
  olEdition?: string; // "OL456M"
  gbVolume?: string; // Google Books volume id
  isbn13?: string;
  isbn10?: string;
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
  /** When the reader last moved each plant (ms, this device's clock). Lets a move made on one device reach the other instead of the local spot always winning. A plant with no time has a legacy spot. */
  placementTimes?: Record<string, number>;
  celebrated: Record<string, true>; // plantIds whose "new plant" prompt was already shown
  vine: number; // 0..1 window vine growth, high-water mark
}

/** When things happened to one book. Dates are local "YYYY-MM-DD"; you can edit them in Book Info. */
export interface BookHistory {
  added?: string;    // put on your list
  started?: string;  // started reading
  finished?: string; // finished
  lastRead?: number; // when you last read or moved it to Reading now (time stamp; decides which Reading now book comes first)
}

/** When and where the pages for one day were last edited by the user (decides which device's value wins in the cloud). */
export interface DayEdit {
  editedAt: number;  // ms since 1970 by this device's clock; 0 = a value that predates this tracking (any real edit beats it)
  deviceId: string;
  editSeq: number;   // counts this device's edits of the day
}

export interface ReadingState {
  status: Record<string, BookStatus>;
  currentPage: Record<string, number>;
  totalPages: Record<string, number>;
  dailyLog: Record<string, number>; // "YYYY-MM-DD" -> pages read
  dailyLogMeta?: Record<string, DayEdit>; // "YYYY-MM-DD" -> who/when last edited that day; set only by setDayPages and updateBookProgress
  /** When the user last edited a field, by this device's clock (ms). Keys: "status:<book>", "rating:<book>", "word:<id>", "hidden:<book>". A missing key is a legacy value that any real edit beats. */
  editTimes?: Record<string, number>;
  /** Vocabulary words the user deleted: word id -> when. Lets a delete win over a device that still has the word. */
  deletedWords?: Record<string, number>;
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
  history: Record<string, BookHistory>; // bookId -> dates
  ratings: Record<string, number>; // bookId -> your own rating, 0.25 to 5 in quarter stars
}

export type TabType = 'today' | 'store' | 'lib' | 'words' | 'search';
