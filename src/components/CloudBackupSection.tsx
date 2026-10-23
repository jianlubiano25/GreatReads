import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { authVersion, currentUser, subscribeAuth } from '../services/supabase';
import { backUpNow, cloudStatus, fetchCloudBackup, getSafetyCopy, isAutoBackup, lastSynced, markRestored, saveSafetyCopy, setAutoBackup, type CloudStatus } from '../services/cloudSync';
import { hasLibrarySyncConflicts, hasPendingLibrarySync, librarySyncAccountAllowed, resolveLibraryConflictsToLocal } from '../services/librarySync';

/** Cloud backup, inside Backup & Restore. Needs an account (Profile → Account). Restoring always saves the current library aside first. */
export const CloudBackupSection: React.FC<{ onExportBackup: () => string; onImportBackup: (json: string) => boolean }> = ({ onExportBackup, onImportBackup }) => {
  useSyncExternalStore(subscribeAuth, authVersion, authVersion);
  const user = currentUser();
  const [status, setStatus] = useState<CloudStatus | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(isAutoBackup());
  const [confirm, setConfirm] = useState<'restore' | 'replace' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [, refreshSync] = useState(0);
  const conflict = lastSynced().conflict;

  useEffect(() => {
    const refresh = () => refreshSync(v => v + 1);
    window.addEventListener('greatreads-library-sync-status', refresh);
    return () => window.removeEventListener('greatreads-library-sync-status', refresh);
  }, []);
  const libraryConflict = !!user && hasLibrarySyncConflicts(user.id);
  const libraryPending = !!user && hasPendingLibrarySync(user.id);
  const libraryAccountBlocked = !!user && !librarySyncAccountAllowed(user.id);

  const refresh = async () => { const r = await cloudStatus(); if (r.ok) setStatus(r.status); };
  useEffect(() => { if (user) void refresh(); }, [user?.id]);

  const btn = 'w-full py-2 px-3 rounded-xl text-xs font-semibold border border-[#2e5934] dark:border-[#86b880] text-[#2e5934] dark:text-[#86b880] active:scale-95 transition-all disabled:opacity-50';
  const done = (ok: boolean, text: string) => { setMsg({ ok, text }); setBusy(false); setConfirm(null); void refresh(); };

  if (!user) {
    return (
      <div className="pt-3 border-t border-[#e3d7c3] dark:border-[#382f25] space-y-1">
        <span className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a] block">Cloud backup</span>
        <p className="text-xs text-[#706256] dark:text-[#a89a8a]">Sign in (Profile → Account) to keep a backup in your account and restore it on another device.</p>
      </div>
    );
  }

  const upload = async (replace: boolean) => {
    setBusy(true); setMsg(null);
    const r = await backUpNow(onExportBackup(), replace);
    done(r.ok, r.ok ? r.note : r.error);
  };
  const restore = async () => {
    setBusy(true); setMsg(null);
    const r = await fetchCloudBackup();
    if (!r.ok) return done(false, r.error);
    saveSafetyCopy(onExportBackup());
    if (!onImportBackup(r.json)) return done(false, 'The cloud backup could not be read. Nothing was changed.');
    markRestored(r.revision, r.json);
    done(true, 'Restored from your account. The library as it was before is kept on this device in case you need it.');
  };

  return (
    <div className="pt-3 border-t border-[#e3d7c3] dark:border-[#382f25] space-y-2">
      <span className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a] block">Cloud backup</span>
      <p className="text-xs text-[#706256] dark:text-[#a89a8a]">
        {status === undefined ? 'Checking…' : status ? `Latest backup: ${new Date(status.updatedAt).toLocaleString()}` : 'No backup in your account yet.'}
      </p>
      {conflict && <p role="alert" className="text-xs text-amber-800 dark:text-amber-300">Your account has a newer backup (from another device). Restore it, or choose Replace to overwrite it with this device.</p>}
      {libraryConflict && <p role="alert" className="text-xs text-amber-800 dark:text-amber-300">Some library records changed on both this device and the cloud. Those records are paused to protect both copies; JSON backup and restore are still available.</p>}
      {libraryConflict && <button type="button" className={btn} disabled={busy} onClick={() => { if (window.confirm('Use this device’s values for conflicted library records? This replaces those records in your cloud library. Download a JSON backup first if you may need both versions.')) resolveLibraryConflictsToLocal(user!.id); }}>Use this device for conflicts</button>}
      {libraryAccountBlocked && <p role="alert" className="text-xs text-amber-800 dark:text-amber-300">This device’s library is linked to another account. Sign back into that account to sync it; this account’s cloud library was not loaded.</p>}
      {!libraryAccountBlocked && !libraryConflict && libraryPending && <p role="status" className="text-xs text-[#706256] dark:text-[#a89a8a]">Library changes are waiting to sync when the connection is available.</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={btn} disabled={busy} onClick={() => void upload(false)}>Back up now</button>
        <button type="button" className={btn} disabled={busy || !status} onClick={() => setConfirm('restore')}>Restore from cloud</button>
      </div>
      {conflict && <button type="button" className={btn} disabled={busy} onClick={() => setConfirm('replace')}>Replace the cloud backup with this device</button>}
      {confirm && (
        <div className="rounded-xl border border-amber-500/50 p-3 space-y-2 text-xs">
          <p>{confirm === 'restore' ? 'Restoring replaces the library on this device with the cloud copy. The current one is saved aside first.' : 'This overwrites the backup in your account with the library on this device.'}</p>
          <div className="flex gap-2">
            <button type="button" className={btn} disabled={busy} onClick={() => void (confirm === 'restore' ? restore() : upload(true))}>Yes, continue</button>
            <button type="button" className={btn} onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </div>
      )}
      <label className="flex items-start gap-2 text-xs cursor-pointer">
        <input type="checkbox" checked={auto} onChange={e => { setAuto(e.target.checked); setAutoBackup(e.target.checked); }} className="mt-0.5 w-4 h-4 accent-[#2e5934] shrink-0" />
        <span>Back up automatically (every few minutes, only when something changed; never over a newer backup)</span>
      </label>
      {getSafetyCopy() && <p className="text-[11px] text-[#706256] dark:text-[#a89a8a]">A copy from before the last restore is kept on this device.</p>}
      {msg && <p role="status" className={`text-xs ${msg.ok ? 'text-[#2e5934] dark:text-[#86b880]' : 'text-red-700 dark:text-red-400'}`}>{msg.text}</p>}
    </div>
  );
};
