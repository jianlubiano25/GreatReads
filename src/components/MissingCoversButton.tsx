import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { RefreshCw, Check, X, ImageOff } from 'lucide-react';
import {
  subscribeMissing,
  getMissingVersion,
  getMissingCount,
  repairMissingCovers,
  type RepairResult,
} from '../services/books';

/**
 * Appears only when some book covers failed to load. One tap re-fetches just those covers.
 */
export function MissingCoversButton() {
  useSyncExternalStore(subscribeMissing, getMissingVersion, getMissingVersion);
  const count = getMissingCount();

  const [show, setShow] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<RepairResult | null>(null);

  // Give slow covers a few seconds (they retry on their own) so the button doesn't flash up for nothing
  useEffect(() => {
    if (count === 0) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 5000);
    return () => clearTimeout(t);
  }, [count > 0]);

  // A fully successful run tidies itself away
  useEffect(() => {
    if (result && result.notFound === 0 && result.failed === 0) {
      const t = setTimeout(() => setResult(null), 4500);
      return () => clearTimeout(t);
    }
  }, [result]);

  const run = async (includeNotFound = false) => {
    setResult(null);
    setProgress({ done: 0, total: 0 });
    setRunning(true);
    try {
      setResult(await repairMissingCovers({ includeNotFound, onProgress: (done, total) => setProgress({ done, total }) }));
    } catch (error) {
      console.warn('Cover repair failed:', error);
    } finally {
      setRunning(false);
    }
  };

  const pill =
    'inline-flex items-center gap-2 rounded-full border border-[#e3d7c3] dark:border-[#382f25] bg-[#fbf7ee] dark:bg-[#231d17] px-3.5 py-1.5 text-xs font-semibold text-[#2e5934] dark:text-[#86b880] shadow-sm';

  let body: ReactNode = null;
  if (running) {
    body = (
      <div className={pill} role="status" aria-live="polite">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        <span>Finding covers… {progress.done}/{progress.total}</span>
      </div>
    );
  } else if (result) {
    const left = result.notFound + result.failed;
    body = (
      <div className={pill} role="status" aria-live="polite">
        {result.fixed > 0 ? <Check className="w-3.5 h-3.5" /> : <ImageOff className="w-3.5 h-3.5" />}
        <span>
          {result.fixed > 0 ? `Fixed ${result.fixed}` : 'No covers found'}
          {result.notFound > 0 ? ` · ${result.notFound} not found online` : ''}
          {result.failed > 0 ? ` · ${result.failed} couldn't connect` : ''}
        </span>
        {left > 0 && (
          <button type="button" onClick={() => run(true)} className="underline underline-offset-2">Try again</button>
        )}
        <button type="button" onClick={() => setResult(null)} aria-label="Dismiss" className="p-0.5 -mr-1 opacity-70">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  } else if (show && count > 0 && !hidden) {
    body = (
      <div className="inline-flex items-center gap-1">
        <button type="button" onClick={() => run()} className={pill}>
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Reload {count} missing cover{count === 1 ? '' : 's'}</span>
        </button>
        <button type="button" onClick={() => setHidden(true)} aria-label="Hide for now" className="p-1.5 rounded-full text-[#706256] dark:text-[#a89a8a] opacity-70">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return body ? <div className="flex justify-center sm:justify-end -mt-2">{body}</div> : null;
}
