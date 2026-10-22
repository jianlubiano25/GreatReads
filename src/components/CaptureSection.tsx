import React, { useState, useSyncExternalStore } from 'react';
import type { Book } from '../types';
import { backfillNow } from '../services/captureDevice';
import { captureOn, captureStatus, captureWanted, setCaptureWanted, subscribeCapture } from '../services/capture';
import { authVersion, currentUser, isAdminKnown, subscribeAuth } from '../services/supabase';

/**
 * Owner only. Everything the app fetches is quietly kept in the catalog as hidden candidates; you browse them in the review screen and publish
 * or reject. Nothing becomes visible to readers until you publish it.
 */
const btn = 'w-full py-2.5 px-3 rounded-xl text-xs font-semibold border border-[#2e5934] dark:border-[#86b880] text-[#2e5934] dark:text-[#86b880] active:scale-95 transition-all hover:bg-[#2e5934]/10 disabled:opacity-50';

export const CaptureSection: React.FC<{ books: Book[]; onOpenReview?: () => void }> = ({ books, onOpenReview }) => {
  useSyncExternalStore(subscribeAuth, authVersion, authVersion);
  const st = useSyncExternalStore(subscribeCapture, captureStatus, captureStatus);
  const [wanted, setWanted] = useState(captureWanted);
  if (!currentUser() || isAdminKnown() !== true) return null;
  const active = captureOn();
  return (
    <div className="pt-3 border-t border-[#e3d7c3] dark:border-[#382f25] space-y-2">
      <span className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a] block">Catalog · owner</span>
      <label className="flex items-start gap-3 text-xs cursor-pointer">
        <input type="checkbox" className="mt-0.5" checked={wanted} onChange={e => { setCaptureWanted(e.target.checked); setWanted(e.target.checked); }} />
        <span>Keep what the app fetches (covers, about, author bio, year, pages, genre, ratings) in the catalog as hidden candidates. Nothing goes live until you publish it.</span>
      </label>
      <p role="status" className="text-xs text-[#706256] dark:text-[#a89a8a]">
        {!wanted ? 'Paused.' : st.error ? st.error : st.running ? `Sending to the catalog… ${st.queued} book${st.queued === 1 ? '' : 's'} waiting.` : st.sent ? `Up to date. ${st.sent} items stored this session.` : 'Up to date.'}
      </p>
      <button type="button" className={btn} disabled={!active || st.running} onClick={() => void backfillNow(books)}>Send everything on this device now</button>
      {onOpenReview && <button type="button" className={btn} onClick={onOpenReview}>Review catalog (publish or reject)</button>}
    </div>
  );
};
