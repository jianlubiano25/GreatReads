import React, { useState, useSyncExternalStore } from 'react';
import type { Book } from '../types';
import { backfillNow } from '../services/captureDevice';
import { autoPublishWanted, captureOn, captureStatus, captureWanted, setAutoPublish, setCaptureWanted, subscribeCapture } from '../services/capture';
import { authVersion, currentUser, isAdminKnown, subscribeAuth } from '../services/supabase';

/**
 * Owner only. Everything the app fetches is kept in the catalog. Where a book has nothing published yet, the best stored cover / description / bio / fact / rating is
 * published for everyone; you then edit, publish another or reject in the review screen. A published value is never replaced by itself.
 */
const btn = 'w-full py-2.5 px-3 rounded-xl text-xs font-semibold border border-[#2e5934] dark:border-[#86b880] text-[#2e5934] dark:text-[#86b880] active:scale-95 transition-all hover:bg-[#2e5934]/10 disabled:opacity-50';

export const CaptureSection: React.FC<{ books: Book[]; onOpenReview?: () => void }> = ({ books, onOpenReview }) => {
  useSyncExternalStore(subscribeAuth, authVersion, authVersion);
  const st = useSyncExternalStore(subscribeCapture, captureStatus, captureStatus);
  const [wanted, setWanted] = useState(captureWanted);
  const [pub, setPub] = useState(autoPublishWanted);
  if (!currentUser() || isAdminKnown() !== true) return null;
  const active = captureOn();
  return (
    <div className="pt-3 border-t border-[#e3d7c3] dark:border-[#382f25] space-y-2">
      <span className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a] block">Catalog · owner</span>
      <label className="flex items-start gap-3 text-xs cursor-pointer">
        <input type="checkbox" className="mt-0.5" checked={wanted} onChange={e => { setCaptureWanted(e.target.checked); setWanted(e.target.checked); }} />
        <span>Keep everything the app fetches (covers, about, author bio, year, pages, genre, ratings) in the database.</span>
      </label>
      <label className="flex items-start gap-3 text-xs cursor-pointer">
        <input type="checkbox" className="mt-0.5" checked={pub} disabled={!wanted} onChange={e => { setAutoPublish(e.target.checked); setPub(e.target.checked); }} />
        <span>Publish it for everyone wherever nothing is published yet. Something you published or rejected is never overridden.</span>
      </label>
      <p role="status" className="text-xs text-[#706256] dark:text-[#a89a8a]">
        {!wanted ? 'Paused.' : st.error ? st.error : st.running ? `Sending to the catalog… ${st.queued} book${st.queued === 1 ? '' : 's'} waiting.` : st.sent || st.published ? `Up to date. ${st.sent} stored, ${st.published} published this session.` : 'Up to date.'}
      </p>
      <button type="button" className={btn} disabled={!active || st.running} onClick={() => void backfillNow(books)}>Send and publish everything on this device now</button>
      {onOpenReview && <button type="button" className={btn} onClick={onOpenReview}>Review catalog (publish or reject)</button>}
    </div>
  );
};
