import React from 'react';
import { useAdminUi } from '../services/adminUi';
import { startFillGenres, useFillState } from '../services/store/fillGenres';
import { POPULAR_SEARCHES } from '../services/store/fillSearches';

/** Admin + developer mode only: starts filling the shared table with every search genre it does not hold yet. It keeps running when Profile is closed (progress shows on Discover). */
export const AdminFillGenres: React.FC = () => {
  const admin = useAdminUi();
  const st = useFillState();
  if (!admin) return null;
  return (
    <div className="pt-3 border-t border-[#e3d7c3] dark:border-[#382f25]">
      <button onClick={() => void startFillGenres(undefined, undefined, undefined, POPULAR_SEARCHES)} disabled={st.running} className="text-xs font-semibold px-3 py-2 rounded-lg bg-[#2a2118] text-white disabled:opacity-50">{st.running ? `Filling ${Math.min(st.done + 1, st.total)} of ${st.total}…` : 'Fill shared genre lists and searches'}</button>
      <p className="text-xs mt-2 opacity-80">{st.running ? `Now: ${st.current}. You can close this; it keeps going.` : st.note}</p>
    </div>
  );
};
