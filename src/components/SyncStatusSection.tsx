import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { currentUser } from '../services/supabase';
import { deviceId } from '../services/cloudSync';
import { APP_BUILD } from '../services/appUpdate';
import { hasLibrarySyncConflicts, hasPendingLibrarySync } from '../services/librarySync';
import { getSyncStatus, subscribeSyncStatus, verdict } from '../services/syncStatus';

const LABELS: [string, string][] = [
  ['library-push', 'Library upload'],
  ['library-pull', 'Library from other devices'],
  ['daily-pages', 'Daily pages'],
  ['settings', 'Settings, words, garden, nook'],
  ['live-connection', 'Live connection'],
  ['safety-check', 'Safety check (every few seconds)'],
];

/** Live sync status, inside Backup & Restore: what works, what failed and why, on this device. Shows no personal data. */
export const SyncStatusSection: React.FC = () => {
  const snap = useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 5000); return () => clearInterval(t); }, []);
  const user = currentUser();
  if (!user) return null;
  const pending = hasPendingLibrarySync(user.id), conflict = hasLibrarySyncConflicts(user.id);
  const live = snap.live === 'connected' ? 'connected' : snap.live === 'refused' ? 'refused by the server, retrying' : snap.live === 'closed' ? 'reconnecting' : 'connecting';
  return (
    <div className="space-y-2" aria-label="Live sync status">
      <p className="text-xs font-bold">Live sync status</p>
      <ul className="space-y-1">
        {LABELS.map(([key, label]) => {
          const v = verdict(snap.parts[key]);
          return (
            <li key={key} className="flex items-start gap-2 text-[11px] leading-snug">
              <span aria-hidden className={`mt-1 w-2 h-2 rounded-full shrink-0 ${v.ok === null ? 'bg-gray-400' : v.ok ? 'bg-green-600' : 'bg-red-600'}`} />
              <span><span className="font-semibold">{label}:</span> {key === 'live-connection' ? `${live}${snap.lastCloudEventAt ? `, last cloud event ${verdict({ okCount: 1, failCount: 0, lastOkAt: snap.lastCloudEventAt }).text.replace('working, last ', '')}` : ''}` : v.text}</span>
            </li>
          );
        })}
      </ul>
      {(pending || conflict) && <p role="status" className="text-[11px] text-amber-800 dark:text-amber-300">{conflict ? 'Some library records are paused because two devices changed them differently.' : 'Library changes are waiting to upload.'}</p>}
      <p className="text-[10px] text-[#706256] dark:text-[#a89a8a]">Build {APP_BUILD} · device {deviceId().slice(0, 8)} · {user.email || 'signed in'}</p>
      <button type="button" className="w-full py-2 px-3 rounded-xl text-xs font-semibold border border-[#2e5934] dark:border-[#86b880] text-[#2e5934] dark:text-[#86b880] active:scale-95 transition-all" onClick={() => { window.dispatchEvent(new Event('greatreads-library-sync-request')); window.dispatchEvent(new Event('greatreads-daily-pages-run')); window.dispatchEvent(new Event('greatreads-settings-records-run')); }}>Sync now</button>
    </div>
  );
};
