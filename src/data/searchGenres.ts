/**
 * The genres on the Search tab. Tapping one searches the catalogs' subject index for `query` (the Keywords button), so each query is the word a
 * catalog files its books under; `label` is what the reader sees.
 */
export interface SearchGenre {
  label: string;
  emoji: string;
  query: string;
}

export const SEARCH_GENRES: SearchGenre[] = [
  { label: 'Fantasy', emoji: '🐉', query: 'fantasy' },
  { label: 'Science Fiction', emoji: '🚀', query: 'science fiction' },
  { label: 'Mystery', emoji: '🔍', query: 'mystery' },
  { label: 'Thriller', emoji: '🕶️', query: 'thriller' },
  { label: 'Romance', emoji: '💕', query: 'romance' },
  { label: 'Historical Fiction', emoji: '🏰', query: 'historical fiction' },
  { label: 'Literary Fiction', emoji: '📖', query: 'literary fiction' },
  { label: 'Horror', emoji: '🦇', query: 'horror' },
  { label: 'Cozy', emoji: '☕', query: 'cozy' },
  { label: 'Classics', emoji: '🏛️', query: 'classics' },
  { label: 'Young Adult', emoji: '🎒', query: 'young adult' },
  { label: 'Graphic Novels', emoji: '💭', query: 'graphic novels' },
  { label: 'Short Stories', emoji: '✂️', query: 'short stories' },
  { label: 'Poetry', emoji: '🪶', query: 'poetry' },
  { label: 'Biography', emoji: '🧑', query: 'biography' },
  { label: 'Memoir', emoji: '📓', query: 'memoir' },
  { label: 'History', emoji: '🗺️', query: 'history' },
  { label: 'Science', emoji: '🔬', query: 'science' },
  { label: 'Psychology', emoji: '🧠', query: 'psychology' },
  { label: 'Philosophy', emoji: '🤔', query: 'philosophy' },
  { label: 'Self-Help', emoji: '🌱', query: 'self-help' },
  { label: 'Business', emoji: '💼', query: 'business' },
  { label: 'True Crime', emoji: '🕵️', query: 'true crime' },
  { label: 'Travel', emoji: '🧳', query: 'travel' },
];
