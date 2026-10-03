import React, { useMemo, useState } from 'react';
import { copyText } from '../services/clipboard';
import { X, Copy, Upload, Check, AlertCircle, RefreshCw } from 'lucide-react';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExportBackup: () => string;
  onImportBackup: (jsonStr: string) => boolean;
}

export const BackupModal: React.FC<BackupModalProps> = ({
  isOpen,
  onClose,
  onExportBackup,
  onImportBackup,
}) => {
  const [pasteText, setPasteText] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  // Built once per open (not on every keystroke in the paste box).
  const currentBackup = useMemo(() => (isOpen ? onExportBackup() : ''), [isOpen, onExportBackup]);

  const backupStats = useMemo(() => {
    const stats = { now: 0, next: 0, highlights: 0, words: 0, customBooks: 0 };
    if (!currentBackup) return stats;
    try {
      const parsed = JSON.parse(currentBackup);
      if (parsed.status) {
        const statuses = Object.values(parsed.status) as unknown[];
        stats.now = statuses.filter(v => v === 'now').length;
        stats.next = statuses.filter(v => v === 'next').length;
      }
      if (parsed.highlights) {
        stats.highlights = (Object.values(parsed.highlights) as unknown[]).reduce<number>(
          (acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0),
          0,
        );
      }
      if (Array.isArray(parsed.words)) stats.words = parsed.words.length;
      if (Array.isArray(parsed.customBooks)) stats.customBooks = parsed.customBooks.length;
    } catch {}
    return stats;
  }, [currentBackup]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    const ok = await copyText(currentBackup);
    if (ok) {
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  const handleRestore = () => {
    if (!pasteText.trim()) {
      setStatus('error');
      setErrorMessage('Please paste your backup JSON text above.');
      return;
    }

    const ok = onImportBackup(pasteText);
    if (ok) {
      setStatus('success');
      setErrorMessage('');
      setTimeout(() => {
        onClose();
        window.location.reload();
      }, 800);
    } else {
      setStatus('error');
      setErrorMessage('Could not parse backup. Ensure it starts with { and ends with }.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[540px] max-h-[90dvh] bg-[#fbf7ee] dark:bg-[#231d17] text-[#201a15] dark:text-[#f0e6d6] rounded-2xl shadow-2xl border border-[#e3d7c3] dark:border-[#382f25] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Backup and Restore"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#e3d7c3] dark:border-[#382f25] flex items-center justify-between bg-[#fbf7ee] dark:bg-[#231d17]">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-[#2e5934] dark:text-[#86b880]" />
            <h3 className="font-serif-display text-xl text-[#201a15] dark:text-[#f0e6d6]">
              Backup &amp; Restore
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-[#706256] dark:text-[#a89a8a] hover:bg-black/10 dark:hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col gap-5 overflow-y-auto">
          {/* Section 1: Copy Current Backup */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a]">
                Everything Included in Your Backup
              </label>
            </div>
            
            {/* Real-time stats indicators */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 mt-1">
              <div className="p-2 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-center">
                <span className="block text-lg font-bold text-[#2e5934] dark:text-[#86b880]">{backupStats.now}</span>
                <span className="text-[10px] text-[#706256] dark:text-[#a89a8a]">Reading Now</span>
              </div>
              <div className="p-2 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-center">
                <span className="block text-lg font-bold text-[#b8892e] dark:text-[#d89e70]">{backupStats.next}</span>
                <span className="text-[10px] text-[#706256] dark:text-[#a89a8a]">Up Next</span>
              </div>
              <div className="p-2 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-center">
                <span className="block text-lg font-bold text-[#925838] dark:text-[#d89e70]">{backupStats.highlights}</span>
                <span className="text-[10px] text-[#706256] dark:text-[#a89a8a]">Highlights</span>
              </div>
              <div className="p-2 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-center">
                <span className="block text-lg font-bold text-[#3a7d80] dark:text-[#86b880]">{backupStats.words}</span>
                <span className="text-[10px] text-[#706256] dark:text-[#a89a8a]">Words &amp; Cue</span>
              </div>
            </div>

            <p className="text-xs text-[#706256] dark:text-[#a89a8a] mb-2">
              Backs up 100% of your data: active reading statuses, Up Next, personal quotes, Word Garden vocabulary, daily reading page logs, and custom books.
            </p>
            <div className="relative">
              <textarea
                readOnly
                value={currentBackup}
                onClick={e => (e.target as HTMLTextAreaElement).select()}
                className="w-full h-24 p-3 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-xs font-mono text-[#706256] dark:text-[#a89a8a] resize-none focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="absolute top-2 right-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#2e5934] text-white flex items-center gap-1.5 shadow hover:bg-[#244729] active:scale-95 transition-all"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied!' : 'Copy Backup'}</span>
              </button>
            </div>
            {copyFailed && (
              <p className="text-xs text-red-700 dark:text-red-400 mt-2" role="alert">
                Your browser blocked copying. Tap inside the box above to select everything, then choose Copy.
              </p>
            )}
          </div>

          {/* Section 2: Restore from Pasted JSON */}
          <div className="pt-2 border-t border-[#e3d7c3] dark:border-[#382f25]">
            <label className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a] block mb-1">
              Restore from Previous Backup
            </label>
            <p className="text-xs text-[#706256] dark:text-[#a89a8a] mb-2">
              Paste your saved backup text from Claude or any previous session below:
            </p>
            <textarea
              value={pasteText}
              onChange={e => {
                setPasteText(e.target.value);
                if (status !== 'idle') setStatus('idle');
              }}
              placeholder='Paste JSON here (e.g. {"st":{...},"words":[...],...})'
              className="w-full h-28 p-3 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] text-xs font-mono placeholder:text-[#a89a8a] focus:outline-none focus:ring-2 focus:ring-[#2e5934]"
            />

            {status === 'success' && (
              <div className="mt-2 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300">
                <Check className="w-4 h-4 shrink-0" />
                <span>Backup restored successfully! Refreshing...</span>
              </div>
            )}

            {status === 'error' && (
              <div className="mt-2 p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 flex items-center gap-2 text-xs text-red-800 dark:text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage || 'Failed to parse backup text.'}</span>
              </div>
            )}

            <button
              type="button"
              onClick={handleRestore}
              className="mt-3 w-full py-2.5 rounded-xl text-xs font-semibold bg-[#2e5934] text-white flex items-center justify-center gap-2 shadow hover:bg-[#244729] active:scale-95 transition-all"
            >
              <Upload className="w-4 h-4" />
              <span>Restore Backup Data</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
