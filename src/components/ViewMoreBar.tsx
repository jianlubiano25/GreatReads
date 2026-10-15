/** "View more" / "View all" under a list that shows only its first few items. Renders nothing when everything already fits. */
/** `outOf`: the figure shown after "of" when the catalog holds more than the list loaded so far */
export function ViewMoreBar({ shown, total, step, outOf, onMore, onAll, onLess }: { shown: number; total: number; step: number; outOf?: number; onMore: () => void; onAll: () => void; onLess: () => void }) {
  if (total <= step) return null;
  const btn = 'px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#e3d7c3] dark:border-[#382f25] text-[#2e5934] dark:text-[#9ed0a6] hover:bg-[#fbf7ee] dark:hover:bg-[#231d17]';
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
      <span className="text-xs text-[#706256] dark:text-[#a89a8a]">Showing {Math.min(shown, total)} of {Math.max(outOf ?? 0, total)}</span>
      {shown < total ? (
        <>
          <button type="button" onClick={onMore} className={btn}>View more</button>
          <button type="button" onClick={onAll} className={btn}>View all ({total})</button>
        </>
      ) : (
        <button type="button" onClick={onLess} className={btn}>Show less</button>
      )}
    </div>
  );
}
