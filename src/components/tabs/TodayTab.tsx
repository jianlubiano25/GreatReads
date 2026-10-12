import { useMemo } from 'react';
import type { Book, BookStatus, ReadingState } from '../../types';
import { dateKey } from '../../services/dates';
import { ReadingScene } from '../ReadingScene';
import { DayStrip } from '../DayStrip';
import { NowReadingCard, UpNextCard } from '../cards';
import { TabPane } from './TabPane';

interface Props {
  active: boolean;
  state: Pick<ReadingState, 'goal' | 'readingIntention' | 'currentPage' | 'totalPages' | 'highlights' | 'notes' | 'dailyLog' | 'garden'>;
  todayKey: string;
  todayPages: number;
  currentStreak: number;
  /** Books on the nook shelves */
  sceneBooks: Book[];
  nowReadingBooks: Book[];
  upNextBooks: Book[];
  finishedCount: number;
  handleOpenCover: (book: Book) => void;
  handleOpenHighlights: (book: Book) => void;
  startReading: (id: string | number) => void;
  setDayPages: (dateKey: string, pages: number) => void;
  updateIntention: (text: string) => void;
  updateBookProgress: (id: string | number, page: number, total?: number) => void;
  setBookStatus: (id: string | number, status: BookStatus) => void;
  updateBookNote: (id: string | number, text: string) => void;
}

/** The Today tab: the reading nook, today's goal, what you are reading now and up next. */
export function TodayTab({
  active, state, todayKey, todayPages, currentStreak, sceneBooks, nowReadingBooks, upNextBooks, finishedCount,
  handleOpenCover, handleOpenHighlights, startReading, setDayPages, updateIntention, updateBookProgress, setBookStatus, updateBookNote,
}: Props) {
  // 7-day dots for streak
  const last7Days = useMemo(() => {
    const days = [];
    const dayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const log = state.dailyLog || {};
    const goal = state.goal || 10;
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = dateKey(d);
      const pages = log[k] || 0;
      days.push({
        letter: dayLetters[d.getDay()],
        pages,
        isGoalMet: pages >= goal,
        key: k,
        isToday: i === 0,
      });
    }
    return days;
  }, [state.dailyLog, state.goal, todayKey]);

  return (
    <>
      {/* Reading nook: window, shelves of your real covers, coffee & growing plants */}
      <TabPane active={active}>
      <ReadingScene
        books={sceneBooks}
        streak={currentStreak}
        todayPages={todayPages}
        goal={state.goal}
        garden={state.garden}
        dailyLog={state.dailyLog}
        onOpenBook={handleOpenCover}
      />
      </TabPane>

      <TabPane active={active}>
      <div className="flex flex-col gap-6">
        <p className="text-sm text-[#706256] dark:text-[#a89a8a] ">
          {state.goal} pages a day is the whole goal. Keep going if you're enjoying it, stop if you're not.
        </p>

        {/* iPad / Desktop Split: Left Dashboard & Right Now Reading */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
          {/* Left Column: Progress Ring & Daily Goal & Intention */}
          <div className="md:col-span-5 flex flex-col gap-4">
            {/* Daily Goal Card */}
            <div className="p-6 rounded-2xl bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] border-l-4 border-l-[#2e5934] shadow-sm flex flex-col gap-4">
              <div className="flex items-center gap-5">
                <div>
                  <span className="font-serif-display text-5xl leading-none text-[#2e5934] dark:text-[#86b880]">
                    {todayPages}
                  </span>
                  <span className="text-xs text-[#706256] dark:text-[#a89a8a] block mt-1">pages today</span>
                </div>

                <div className="flex-1 flex flex-col gap-2">
                  <div className="w-full h-3 rounded-full bg-[#e3d7c3] dark:bg-[#382f25] overflow-hidden">
                    <div
                      className="h-full bg-[#2e5934] dark:bg-[#86b880] transition-all duration-500 rounded-full"
                      style={{ width: `${Math.min(100, (todayPages * 100) / state.goal)}%` }}
                    />
                  </div>
                  <div className="text-xs text-[#706256] dark:text-[#a89a8a]">
                    {todayPages >= state.goal
                      ? 'Goal reached. Anything more is a bonus.'
                      : `${state.goal - todayPages} more to hit today's goal`} · {currentStreak}-day streak
                  </div>
                </div>
              </div>

              <DayStrip days={last7Days} onSetPages={setDayPages} />
            </div>

            {/* Reading Intention Card */}
            <div className="p-5 rounded-2xl bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] border-l-4 border-l-[#925838] shadow-sm flex flex-col gap-2">
              <label className="text-xs font-bold uppercase tracking-wider text-[#925838] dark:text-[#d89e70] font-sans">
                My Reading Intention
              </label>
              <textarea
                value={state.readingIntention}
                onChange={e => updateIntention(e.target.value)}
                rows={2}
                placeholder="What are you hoping to find in books right now?"
                className="w-full bg-transparent text-sm italic  text-[#201a15] dark:text-[#f0e6d6] focus:outline-none resize-none leading-relaxed"
              />
            </div>
          </div>

          {/* Right Column: Currently Reading Books */}
          <div className="md:col-span-7 flex flex-col gap-4">
            <h2 className="font-serif-display text-2xl text-[#201a15] dark:text-[#f0e6d6]">
              Reading now
            </h2>

            {nowReadingBooks.length === 0 ? (
              <div className="p-8 rounded-2xl bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] text-center text-[#706256] dark:text-[#a89a8a] text-sm">
                Nothing in progress. Open the Library or Book Store to choose your first book.
              </div>
            ) : (
              nowReadingBooks.map(b => (
                <NowReadingCard
                  key={b.id}
                  book={b}
                  currentPage={state.currentPage[String(b.id)] || 0}
                  totalPages={state.totalPages[String(b.id)] || b.pageCount || 0}
                  highlightCount={(state.highlights[String(b.id)] || []).length}
                  note={state.notes[String(b.id)] || ''}
                  onOpen={handleOpenCover}
                  onProgress={updateBookProgress}
                  onStatus={setBookStatus}
                  onQuotes={handleOpenHighlights}
                  onNote={updateBookNote}
                />
              ))
            )}

            {/* Up Next List */}
            <div className="mt-4 flex flex-col gap-3">
              <h3 className="font-serif-display text-xl text-[#201a15] dark:text-[#f0e6d6]">
                Up next
              </h3>
              {upNextBooks.length === 0 ? (
                <div className="p-4 rounded-xl bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] text-center text-xs text-[#706256] dark:text-[#a89a8a]">
                  Pick up to three books to read next.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {upNextBooks.map(b => (
                    <UpNextCard key={b.id} book={b} onOpen={handleOpenCover} onStart={startReading} />
                  ))}
                </div>
              )}
              {upNextBooks.length > 3 && (
                <p className="text-xs text-[#706256] dark:text-[#a89a8a] italic">
                  That's more than three. A shorter Next list is easier to actually start.
                </p>
              )}
            </div>

            <div className="text-xs text-[#706256] dark:text-[#a89a8a] mt-2">
              Books finished so far: <b>{finishedCount}</b>
            </div>
          </div>
        </div>
      </div>
      </TabPane>
    </>
  );
}
