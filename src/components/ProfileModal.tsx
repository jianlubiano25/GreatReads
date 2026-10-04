import React, { useState } from 'react';
import { GardenState, UserProfile } from '../types';
import { Camera, Moon, Sun, Monitor, RefreshCw, Copy, Check, Upload, X, Download } from 'lucide-react';
import { copyText } from '../services/clipboard';
import { isLocationWeatherEnabled, setLocationWeatherEnabled, fetchLocalWeather } from '../services/weather';
import { getNookMatchesTheme, setNookMatchesTheme, getWindowFollowsTime, setWindowFollowsTime } from '../services/nookPrefs';
import { useAppUpdate, checkForUpdate, applyUpdate, restartApp, APP_BUILD } from '../services/appUpdate';
import { AchievementsModal } from './garden/AchievementsModal';
import { MILESTONES } from '../data/gardenCatalog';

interface ProfileModalProps {
  profile: UserProfile;
  goal: number;
  hiddenCount: number;
  stats: { pagesRead: number; finished: number; toRead: number };
  garden: GardenState;
  onMovePlant: (plantId: string, areaId: string, index: number) => void;
  onClose: () => void;
  onUpdateProfile: (updates: Partial<UserProfile>) => void;
  onUpdateGoal: (goal: number) => void;
  onRestoreHidden: () => void;
  onExportBackup: () => string;
  onImportBackup: (jsonStr: string) => boolean;
  onOpenBackupModal?: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  profile,
  goal,
  hiddenCount,
  stats,
  garden,
  onMovePlant,
  onClose,
  onUpdateProfile,
  onUpdateGoal,
  onRestoreHidden,
  onExportBackup,
  onImportBackup,
  onOpenBackupModal,
}) => {
  const [name, setName] = useState(profile.name);
  const [pageGoal, setPageGoal] = useState(String(goal));
  const [theme, setTheme] = useState(profile.theme);
  const [copied, setCopied] = useState(false);
  const [importStatus, setImportStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const update = useAppUpdate();
  const [locationWeather, setLocationWeather] = useState(isLocationWeatherEnabled);
  const [nookMatchesTheme, setNookTheme] = useState(getNookMatchesTheme);
  const [windowFollowsTime, setWindowTime] = useState(getWindowFollowsTime);
  const [showAchievements, setShowAchievements] = useState(false);
  const plantsEarned = MILESTONES.filter(m => garden.achievements[m.id]).length;

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 160;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const minDim = Math.min(img.width, img.height);
          ctx.drawImage(
            img,
            (img.width - minDim) / 2,
            (img.height - minDim) / 2,
            minDim,
            minDim,
            0,
            0,
            160,
            160
          );
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          onUpdateProfile({ photo: dataUrl });
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    onUpdateProfile({ name: name.trim(), theme });
    const g = Number(pageGoal);
    if (g && g > 0) {
      onUpdateGoal(g);
    }
    onClose();
  };

  const handleCopyBackup = async () => {
    const data = onExportBackup();
    if (await copyText(data)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      // Last resort: show the text so it can be copied by hand
      prompt('Your browser blocked copying. Select all of this text and copy it:', data);
    }
  };

  const handlePasteBackup = () => {
    const jsonStr = prompt('Paste your backup JSON here:');
    if (!jsonStr) return;
    const ok = onImportBackup(jsonStr);
    if (ok) {
      setImportStatus('success');
      setTimeout(() => {
        window.location.reload();
      }, 700);
    } else {
      setImportStatus('error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 overflow-y-auto animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[500px] max-h-[92dvh] sm:max-h-[88dvh] bg-[#fbf7ee] dark:bg-[#231d17] text-[#201a15] dark:text-[#f0e6d6] rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-y-auto overscroll-contain flex flex-col border border-[#e3d7c3] dark:border-[#382f25]"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Profile and Settings"
      >
        <div className="sticky top-0 z-20 px-6 py-4 bg-[#fbf7ee]/95 dark:bg-[#231d17]/95 backdrop-blur-md border-b border-[#e3d7c3] dark:border-[#382f25] flex items-center justify-between">
          <h3 className="font-serif-display text-xl text-[#201a15] dark:text-[#f0e6d6]">
            Profile &amp; Settings
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-[#706256] dark:text-[#a89a8a] hover:bg-black/10 dark:hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-5 overflow-y-auto">
          {/* Avatar and name */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-20 h-20 rounded-full border-2 border-[#e3d7c3] dark:border-[#382f25] bg-[#e8efe7] dark:bg-[#243422] text-[#2e5934] dark:text-[#86b880] flex items-center justify-center font-serif-display text-2xl font-bold overflow-hidden shadow-sm">
                {profile.photo ? (
                  <img src={profile.photo} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span>{(name || '🌿').slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <label className="absolute bottom-0 right-0 p-1.5 rounded-full bg-[#2e5934] text-white shadow hover:bg-[#244729] cursor-pointer">
                <Camera className="w-3.5 h-3.5" />
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={handlePhotoUpload}
                />
              </label>
            </div>

            <div className="flex-1">
              <label className="text-xs font-semibold text-[#706256] dark:text-[#a89a8a] block mb-1">
                Your Name
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Reader name"
                className="w-full px-3.5 py-2 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-sm focus:outline-none focus:ring-2 focus:ring-[#2e5934]"
              />
            </div>
          </div>

          {/* Daily Goal */}
          <div>
            <label className="text-xs font-semibold text-[#706256] dark:text-[#a89a8a] block mb-1">
              Daily Reading Goal (pages per day)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="500"
                value={pageGoal}
                onChange={e => setPageGoal(e.target.value)}
                className="w-28 px-3.5 py-2 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-sm focus:outline-none focus:ring-2 focus:ring-[#2e5934]"
              />
              <span className="text-xs text-[#706256] dark:text-[#a89a8a]">
                pages/day · 10 pages is a gentle, sustainable habit
              </span>
            </div>
          </div>

          {/* Achievements */}
          <div>
            <label className="text-xs font-semibold text-[#706256] dark:text-[#a89a8a] block mb-1.5">
              Achievements
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: '📖', value: stats.pagesRead.toLocaleString(), label: 'Pages read' },
                { icon: '🏁', value: String(stats.finished), label: 'Books finished' },
                { icon: '📚', value: String(stats.toRead), label: 'Up next' },
              ].map(t => (
                <div key={t.label} className="rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] p-3 text-center">
                  <div className="text-lg leading-none mb-1">{t.icon}</div>
                  <div className="text-xl font-bold text-[#2e5934] dark:text-[#86b880]">{t.value}</div>
                  <div className="text-[11px] leading-tight text-[#706256] dark:text-[#a89a8a]">{t.label}</div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowAchievements(true)}
              className="mt-2 w-full py-2.5 px-3 rounded-xl text-xs font-semibold border border-[#e3d7c3] dark:border-[#382f25] bg-[#e8efe7] dark:bg-[#243422] text-[#2e5934] dark:text-[#86b880] flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all"
            >
              <span aria-hidden="true">🌿</span>
              <span>Achievements &amp; garden · {plantsEarned} of {MILESTONES.length} plants</span>
            </button>
          </div>

          {/* Appearance */}
          <div>
            <label className="text-xs font-semibold text-[#706256] dark:text-[#a89a8a] block mb-1.5">
              Appearance
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setTheme('auto');
                  onUpdateProfile({ theme: 'auto' });
                }}
                className={`py-2 px-3 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                  theme === 'auto'
                    ? 'border-[#2e5934] dark:border-[#86b880] bg-[#e8efe7] dark:bg-[#243422] text-[#2e5934] dark:text-[#86b880]'
                    : 'border-[#e3d7c3] dark:border-[#382f25] bg-[#f5f0e6] dark:bg-[#181410]'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                <span>System</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTheme('light');
                  onUpdateProfile({ theme: 'light' });
                }}
                className={`py-2 px-3 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                  theme === 'light'
                    ? 'border-[#2e5934] dark:border-[#86b880] bg-[#e8efe7] dark:bg-[#243422] text-[#2e5934] dark:text-[#86b880]'
                    : 'border-[#e3d7c3] dark:border-[#382f25] bg-[#f5f0e6] dark:bg-[#181410]'
                }`}
              >
                <Sun className="w-3.5 h-3.5" />
                <span>Parchment</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTheme('dark');
                  onUpdateProfile({ theme: 'dark' });
                }}
                className={`py-2 px-3 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                  theme === 'dark'
                    ? 'border-[#2e5934] dark:border-[#86b880] bg-[#e8efe7] dark:bg-[#243422] text-[#2e5934] dark:text-[#86b880]'
                    : 'border-[#e3d7c3] dark:border-[#382f25] bg-[#f5f0e6] dark:bg-[#181410]'
                }`}
              >
                <Moon className="w-3.5 h-3.5" />
                <span>Night</span>
              </button>
            </div>
            <label className="flex items-start justify-between gap-3 cursor-pointer mt-3">
              <span>
                <span className="text-xs font-semibold text-[#706256] dark:text-[#a89a8a] block">Match the reading nook to the theme</span>
                <span className="text-[11px] text-[#706256] dark:text-[#a89a8a] block mt-0.5">
                  The nook's wall, shelves and plants follow Parchment / Night. Off: they follow the time of day shown in the window.
                </span>
              </span>
              <input
                type="checkbox"
                checked={nookMatchesTheme}
                onChange={e => {
                  setNookTheme(e.target.checked);
                  setNookMatchesTheme(e.target.checked);
                }}
                className="mt-0.5 w-4 h-4 accent-[#2e5934] shrink-0"
              />
            </label>
          </div>

          {/* Scene weather (location is optional) */}
          <div className="space-y-3">
            <label className="flex items-start justify-between gap-3 cursor-pointer">
              <span>
                <span className="text-xs font-semibold text-[#706256] dark:text-[#a89a8a] block">Match weather to my location</span>
                <span className="text-[11px] text-[#706256] dark:text-[#a89a8a] block mt-0.5">
                  Off by default. Tap the window to pick sun, clouds, rain or snow. With this on, the window goes back to your real local weather
                  whenever the app is refreshed. Turning it on asks your device for approximate location, used only to look up the local weather.
                </span>
              </span>
              <input
                type="checkbox"
                checked={locationWeather}
                onChange={e => {
                  const on = e.target.checked;
                  setLocationWeather(on);
                  setLocationWeatherEnabled(on);
                  if (on) void fetchLocalWeather(); // shows the device's permission question now, not later
                }}
                className="mt-0.5 w-4 h-4 accent-[#2e5934] shrink-0"
              />
            </label>

            <label className="flex items-start justify-between gap-3 cursor-pointer">
              <span>
                <span className="text-xs font-semibold text-[#706256] dark:text-[#a89a8a] block">Window follows the real time of day</span>
                <span className="text-[11px] text-[#706256] dark:text-[#a89a8a] block mt-0.5">
                  On by default. Turn it off to get a small button on the window that steps through morning, daytime, sunset and night.
                  Turn it back on to return to the real time.
                </span>
              </span>
              <input
                type="checkbox"
                checked={windowFollowsTime}
                onChange={e => {
                  setWindowTime(e.target.checked);
                  setWindowFollowsTime(e.target.checked);
                }}
                className="mt-0.5 w-4 h-4 accent-[#2e5934] shrink-0"
              />
            </label>
          </div>

          {/* Hidden books restoration */}
          {hiddenCount > 0 && (
            <div className="pt-2">
              <button
                type="button"
                onClick={onRestoreHidden}
                className="w-full py-2 px-4 rounded-xl text-xs font-semibold border border-[#e3d7c3] dark:border-[#382f25] hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center gap-2 text-[#706256] dark:text-[#a89a8a]"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Restore {hiddenCount} hidden book{hiddenCount > 1 ? 's' : ''}</span>
              </button>
            </div>
          )}

          {/* Backup & Netlify / Multi-device Sync */}
          <div className="pt-3 border-t border-[#e3d7c3] dark:border-[#382f25]">
            <span className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a] block mb-2">
              Data &amp; Backup Sync
            </span>
            <p className="text-xs text-[#706256] dark:text-[#a89a8a] mb-3">
              Copy your backup to transfer your reading data and device books between your iPhone, iPad, and computer.
            </p>
            {onOpenBackupModal && (
              <div className="mb-2.5">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenBackupModal();
                  }}
                  className="w-full py-2.5 px-3 rounded-xl text-xs font-semibold bg-[#2e5934] dark:bg-[#86b880] text-white dark:text-[#181410] flex items-center justify-center gap-2 shadow-xs active:scale-95 transition-all hover:opacity-90"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Open Full Backup &amp; Restore Manager</span>
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCopyBackup}
                className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold bg-[#e8efe7] dark:bg-[#243422] text-[#2e5934] dark:text-[#86b880] flex items-center justify-center gap-1.5 hover:bg-[#d8e7d7]"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied ✓' : 'Copy Backup'}</span>
              </button>
              <button
                type="button"
                onClick={handlePasteBackup}
                className="flex-1 py-2 px-3 rounded-xl text-xs font-semibold border border-[#e3d7c3] dark:border-[#382f25] flex items-center justify-center gap-1.5 hover:bg-black/5 dark:hover:bg-white/5"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Restore Backup</span>
              </button>
            </div>
            {importStatus === 'success' && (
              <p className="text-xs text-emerald-600 mt-2">Backup restored successfully!</p>
            )}
            {importStatus === 'error' && (
              <p className="text-xs text-red-500 mt-2">Invalid backup format. Please check the text.</p>
            )}
          </div>

          {/* App version & updates */}
          <div className="pt-3 border-t border-[#e3d7c3] dark:border-[#382f25]">
            <span className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a] block mb-1">
              App Updates
            </span>
            <p className="text-xs text-[#706256] dark:text-[#a89a8a] mb-2.5" aria-live="polite">
              {update.available
                ? 'A newer version is downloaded and ready.'
                : update.checking
                ? 'Checking for a newer version…'
                : update.upToDate
                ? 'You have the latest version.'
                : 'The app looks for new versions by itself. You only see a message when there is one.'}
              {' '}<span className="opacity-60">Version {APP_BUILD}</span>
            </p>
            <div className="flex gap-2">
              {update.available ? (
                <button
                  type="button"
                  onClick={applyUpdate}
                  className="flex-1 py-2.5 px-3 rounded-xl text-xs font-semibold bg-[#2e5934] text-white flex items-center justify-center gap-1.5 hover:bg-[#244729] shadow-sm"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Update now</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={update.checking}
                  onClick={() => void checkForUpdate(true)}
                  className="flex-1 py-2.5 px-3 rounded-xl text-xs font-semibold border border-[#e3d7c3] dark:border-[#382f25] flex items-center justify-center gap-1.5 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${update.checking ? 'animate-spin' : ''}`} />
                  <span>Check for updates</span>
                </button>
              )}
              <button
                type="button"
                onClick={restartApp}
                className="py-2.5 px-3 rounded-xl text-xs font-semibold border border-[#e3d7c3] dark:border-[#382f25] text-[#706256] dark:text-[#a89a8a] hover:bg-black/5 dark:hover:bg-white/5"
              >
                Restart
              </button>
            </div>
          </div>
        </div>

        {showAchievements && <AchievementsModal garden={garden} onMovePlant={onMovePlant} onClose={() => setShowAchievements(false)} />}

        <div className="p-4 bg-[#f5f0e6] dark:bg-[#181410] border-t border-[#e3d7c3] dark:border-[#382f25]">
          <button
            onClick={handleSave}
            className="w-full min-h-[44px] rounded-xl text-sm font-semibold bg-[#2e5934] text-white hover:bg-[#244729] shadow-sm flex items-center justify-center"
          >
            Save &amp; Close
          </button>
        </div>
      </div>
    </div>
  );
};
