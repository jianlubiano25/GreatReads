import React, { useState, useSyncExternalStore } from 'react';
import { authVersion, currentUser, isAdminKnown, subscribeAuth } from '../services/supabase';
import { SEARCH_GENRES } from '../data/searchGenres';
import { fillSharedGenre, type FillResult } from '../services/store/genreRows';

/** Admin only: loads every search genre that the shared table does not hold yet, one at a time (the sites are slow), and writes it for every reader. */
export const AdminFillGenres: React.FC = () => {
  useSyncExternalStore(subscribeAuth, authVersion, authVersion);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState('');
  const run = async () => {
    setBusy(true);
    const counts: Record<FillResult, number> = { already: 0, filled: 0, failed: 0, 'not-admin': 0 };
    const failed: string[] = [];
    for (let i = 0; i < SEARCH_GENRES.length; i++) {
      const g = SEARCH_GENRES[i];
      setLine(`${i + 1} of ${SEARCH_GENRES.length}: ${g.label}…`);
      const r = await fillSharedGenre(g).catch(() => 'failed' as FillResult);
      counts[r]++;
      if (r === 'failed') failed.push(g.label);
      if (r === 'not-admin') break;
      await new Promise(res => setTimeout(res, 3000));
    }
    setLine(`Done: ${counts.filled} added, ${counts.already} already there, ${counts.failed} failed${failed.length ? ` (${failed.join(', ')})` : ''}${counts['not-admin'] ? '. This device is not an admin, nothing was written' : ''}.`);
    setBusy(false);
  };
  if (!currentUser() || isAdminKnown() !== true) return null;
  return (
    <div className="pt-3 border-t border-[#e3d7c3] dark:border-[#382f25]">
      <button onClick={run} disabled={busy} className="text-xs font-semibold px-3 py-2 rounded-lg bg-[#2a2118] text-white disabled:opacity-50">{busy ? 'Filling…' : 'Fill shared genre lists'}</button>
      {line ? <p className="text-xs mt-2 opacity-80">{line}</p> : null}
    </div>
  );
};
