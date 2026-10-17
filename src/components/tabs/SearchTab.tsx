import { useCallback, useRef, useState } from 'react';
import type { Book } from '../../types';
import { SEARCH_GENRES, type SearchGenre } from '../../data/searchGenres';
import { useKnownBooks } from '../../hooks/useKnownBooks';
import type { SearchScope } from '../../services/books';
import { BookSearch } from '../BookSearch';
import { GenrePicks } from '../GenrePicks';
import { TabPane } from './TabPane';

interface Props {
  active: boolean;
  /** Every book in the library: a result you own shows your rating */
  allBooks: Book[];
  handleOpenCover: (book: Book) => void;
}

/** The Search tab: the same search box as Discover, and under it a list of genres to browse. */
export function SearchTab({ active, allBooks, handleOpenCover }: Props) {
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
  // The genre's page shows while what is searched is the genre or one of its sub-genres; typing anything else leaves it
  const onGenrePage = !!genre && scope === 'keywords' && (query === genre.query || genre.subgenres.some(s => s.query === query));

  return (
    <TabPane active={active}>
      <div className="flex flex-col gap-6">
        <BookSearch active={active} known={known} query={query} setQuery={setQuery} scope={scope} setScope={setScope} handleOpenCover={handleOpenCover} backLabel="Back to Search"
          aboveResults={onGenrePage && genre ? <GenrePicks genre={genre} query={query} known={known} onPick={pickSub} onOpen={handleOpenCover} /> : undefined} />

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
