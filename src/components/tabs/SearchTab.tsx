import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book } from '../../types';
import { SEARCH_GENRES, type SearchGenre } from '../../data/searchGenres';
import { useKnownBooks } from '../../hooks/useKnownBooks';
import type { SearchScope } from '../../services/books';
import { genreForQuery, moreLikeThis } from '../../services/books/genreRank';
import { clearRecentSearches, forgetSearch, getRecentSearches, rememberSearch } from '../../services/books/recentSearches';
import { BookSearch } from '../BookSearch';
import { GenrePicks } from '../GenrePicks';
import { TabPane } from './TabPane';

interface Props {
  active: boolean;
  /** Every book in the library: a result you own shows your rating */
  allBooks: Book[];
  handleOpenCover: (book: Book) => void;
  /** "More like this" on a book's page: the book to find more of (a new object each time, so asking twice for the same book still searches) */
  moreLike?: { book: Book } | null;
}

/** The Search tab: the same search box as Discover, and under it a list of genres to browse. */
export function SearchTab({ active, allBooks, handleOpenCover, moreLike }: Props) {
  const known = useKnownBooks(allBooks);
  const [query, setQueryState] = useState('');
  const [scope, setScopeState] = useState<SearchScope>('all');
  // A genre is searched with the Keywords button on. When you leave that search the button goes back to All, so the next thing you type is an ordinary search
  // (a button you picked yourself stays as you left it, like in Discover).
  const byGenre = useRef(false);
  const [genre, setGenre] = useState<SearchGenre | null>(null);

  const setQuery = useCallback((q: string) => {
    setQueryState(q);
    if (!q.trim()) { setGenre(null); if (byGenre.current) { byGenre.current = false; setScopeState('all'); } }
  }, []);
  const setScope = useCallback((s: SearchScope) => { byGenre.current = false; setGenre(null); setScopeState(s); }, []);
  const pickGenre = useCallback((g: SearchGenre) => { byGenre.current = true; setGenre(g); setScopeState('keywords'); setQueryState(g.query); }, []);
  /** A sub-genre chip (or "All Fantasy") on a genre's page: another Keywords search inside the same genre */
  const pickSub = useCallback((q: string) => { byGenre.current = true; setScopeState('keywords'); setQueryState(q); }, []);
  /** Open a genre's page on a given search of it (the genre itself or one of its sub-genres) */
  const openGenre = useCallback((g: SearchGenre, q: string) => { byGenre.current = true; setGenre(g); setScopeState('keywords'); setQueryState(q); }, []);
  const [recent, setRecent] = useState<string[]>(getRecentSearches);
  const recordSearch = useCallback((q: string) => { if (!genreForQuery(q)) setRecent(rememberSearch(q)); }, []);
  const searchRecent = useCallback((q: string) => { byGenre.current = false; setGenre(null); setScopeState('all'); setQueryState(q); }, []);

  // "More like this": the book's genre page, or (when its genre is not one we browse) its author's books
  useEffect(() => {
    if (!moreLike) return;
    const m = moreLikeThis(moreLike.book);
    if (!m) return;
    if (m.kind === 'genre') openGenre(m.genre, m.query);
    else { byGenre.current = false; setGenre(null); setScopeState('author'); setQueryState(m.query); }
  }, [moreLike, openGenre]);

  // The genre's page shows while what is searched is the genre or one of its sub-genres; typing anything else leaves it
  const onGenrePage = !!genre && scope === 'keywords' && (query === genre.query || genre.subgenres.some(s => s.query === query));
  // Typing a genre's name in an ordinary search offers its page (nothing is switched for you)
  const typedGenre = onGenrePage ? undefined : genreForQuery(query);

  return (
    <TabPane active={active}>
      <div className="flex flex-col gap-6">
        <BookSearch active={active} known={known} query={query} setQuery={setQuery} scope={scope} setScope={setScope} handleOpenCover={handleOpenCover} backLabel="Back to Search" recordSearch={recordSearch}
          aboveResults={onGenrePage && genre ? <GenrePicks genre={genre} query={query} known={known} onPick={pickSub} onOpen={handleOpenCover} /> : typedGenre ? (
            <button type="button" onClick={() => openGenre(typedGenre.genre, typedGenre.query)} className="self-start px-3.5 py-2 rounded-full border border-[#2e5934] dark:border-[#86b880] text-xs font-semibold text-[#2e5934] dark:text-[#9ed0a6] bg-[#fbf7ee] dark:bg-[#231d17]">
              <span aria-hidden="true">{typedGenre.genre.emoji}</span> Browse the {typedGenre.genre.label} page
            </button>
          ) : undefined} />

        {!query.trim() && recent.length > 0 && (
          <section className="flex flex-col gap-2" aria-label="Recent searches">
            <div className="flex items-center justify-between">
              <h3 className="font-serif-display text-xl text-[#201a15] dark:text-[#f0e6d6]">Recent searches</h3>
              <button type="button" onClick={() => setRecent(clearRecentSearches())} className="text-xs font-semibold text-[#706256] dark:text-[#a89a8a] underline">Clear</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {recent.map(q => (
                <span key={q} className="inline-flex items-center rounded-full border border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17] text-xs font-semibold text-[#201a15] dark:text-[#f0e6d6]">
                  <button type="button" onClick={() => searchRecent(q)} className="pl-3.5 pr-2 py-1.5">{q}</button>
                  <button type="button" aria-label={`Remove ${q} from recent searches`} onClick={() => setRecent(forgetSearch(q))} className="pr-3 pl-1 py-1.5 text-[#706256] dark:text-[#a89a8a]">×</button>
                </span>
              ))}
            </div>
          </section>
        )}

        {!query.trim() && (
          <section className="flex flex-col gap-3" aria-label="Browse by genre">
            <h3 className="font-serif-display text-xl text-[#201a15] dark:text-[#f0e6d6]">Browse by genre</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {SEARCH_GENRES.map(g => (
                <button
                  key={g.label}
                  type="button"
                  onClick={() => pickGenre(g)}
                  className="min-h-[56px] px-4 py-3 rounded-2xl border border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17] text-left flex items-center gap-3 hover:border-[#2e5934] dark:hover:border-[#86b880] active:scale-[0.98] transition-all"
                >
                  <span className="text-xl leading-none" aria-hidden="true">{g.emoji}</span>
                  <span className="text-sm font-semibold text-[#201a15] dark:text-[#f0e6d6] leading-tight">{g.label}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </TabPane>
  );
}
