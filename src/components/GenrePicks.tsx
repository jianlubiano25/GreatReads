import type { Book } from '../types';
import type { SearchGenre } from '../data/searchGenres';
import { genrePicks, genrePopular } from '../services/store/genrePicks';
import { genreRowSource } from '../services/store/genreRows';
import { StoreShelf } from './StoreShelf';

interface Props {
  genre: SearchGenre;
  /** What is searched now: the genre itself, or one of its sub-genres */
  query: string;
  known: Book[];
  onPick: (query: string) => void;
  onOpen: (book: Book) => void;
}

const CHIP = 'shrink-0 px-3.5 py-1.5 rounded-full border text-xs font-semibold whitespace-nowrap transition-all';
const CHIP_ON = 'bg-[#2e5934] text-white border-[#2e5934]';
const CHIP_OFF = 'bg-[#fbf7ee] dark:bg-[#231d17] border-[#e3d7c3] dark:border-[#382f25] text-[#706256] dark:text-[#a89a8a] hover:text-[#201a15]';

const subGenres = new Map<string, SearchGenre>();
/** A sub-genre chip as a genre of its own (its own search word, no genre-wide filters), so it gets its own Hidden gems row; one object per chip. */
export function subGenreOf(genre: SearchGenre, query: string): SearchGenre | null {
  const s = genre.subgenres.find(x => x.query === query);
  if (!s) return null;
  const key = `${genre.label} / ${s.label}`;
  let g = subGenres.get(key);
  if (!g) { g = { label: key, emoji: genre.emoji, query: s.query, kind: genre.kind, subgenres: [] }; subGenres.set(key, g); }
  return g;
}

/** The top of a genre's page: its name, chips for its sub-genres, and (on the genre itself) a row for the genre's official NYT list, where there is one) and a row of hand-picked books. The ranked search results follow below. */
export function GenrePicks({ genre, query, known, onPick, onOpen }: Props) {
  const onGenre = query === genre.query;
  const picks = onGenre ? genrePicks(genre) : null;
  const popular = onGenre ? genrePopular(genre) : null;
  const sub = onGenre ? null : subGenreOf(genre, query);
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-serif-display text-2xl text-[#201a15] dark:text-[#f0e6d6] flex items-center gap-2">
        <span aria-hidden="true">{genre.emoji}</span>
        {genre.label}
      </h2>

      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 py-0.5" role="group" aria-label={`${genre.label} sub-genres`}>
        <button type="button" onClick={() => onPick(genre.query)} aria-pressed={query === genre.query} className={`${CHIP} ${query === genre.query ? CHIP_ON : CHIP_OFF}`}>
          All {genre.label}
        </button>
        {genre.subgenres.map(s => (
          <button key={s.query} type="button" onClick={() => onPick(s.query)} aria-pressed={query === s.query} className={`${CHIP} ${query === s.query ? CHIP_ON : CHIP_OFF}`}>
            {s.label}
          </button>
        ))}
      </div>

      {popular && <StoreShelf key={popular.id} id={popular.id} title="Popular now" source={popular.source} ranked lazy hideIfUnavailable known={known} onOpen={onOpen} />}
      {picks && <StoreShelf key={picks.id} id={picks.id} title="Hand-picked" source={picks.source} known={known} onOpen={onOpen} />}
      {onGenre && <StoreShelf key={`new-${genre.label}`} id={`genre-new-${genre.label}`} title="New releases" source={genreRowSource(genre, 'new')} hideIfUnavailable hideWhileLoading known={known} onOpen={onOpen} />}
      {onGenre && <StoreShelf key={`gems-${genre.label}`} id={`genre-gems-${genre.label}`} title="Hidden gems" source={genreRowSource(genre, 'gems')} known={known} onOpen={onOpen} />}
      {sub && <StoreShelf key={`gems-${sub.label}`} id={`genre-gems-${sub.label}`} title={`Hidden gems in ${sub.label.split(' / ')[1]}`} source={genreRowSource(sub, 'gems')} hideIfUnavailable hideWhileLoading known={known} onOpen={onOpen} />}
    </div>
  );
}
