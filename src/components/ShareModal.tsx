import React, { useState } from 'react';
import { copyText } from '../services/clipboard';
import { Share2, Copy, Check, ExternalLink, QrCode, X, Smartphone, Globe } from 'lucide-react';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  if (!isOpen) return null;

  // The address you are using right now is the address to share
  const sharedUrl = typeof window !== 'undefined' && window.location.origin !== 'null' ? window.location.origin : '';

  const handleCopy = async () => {
    const ok = await copyText(sharedUrl);
    setCopyFailed(!ok);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
  };

  const handleNativeShare = () => {
    if (navigator.share) {
      navigator.share({
        title: 'My Reading Life',
        text: 'A quiet reading companion, bookstore, vocabulary garden, and device library.',
        url: sharedUrl,
      }).catch(() => {});
    } else {
      handleCopy();
    }
  };

  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
    sharedUrl
  )}&bgcolor=fbf7ee&color=201a15&margin=6`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[500px] bg-[#fbf7ee] dark:bg-[#231d17] text-[#201a15] dark:text-[#f0e6d6] rounded-3xl shadow-2xl border border-[#e3d7c3] dark:border-[#382f25] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Share URL Link"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#e3d7c3] dark:border-[#382f25] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-[#2e5934] dark:text-[#86b880]" />
            <h3 className="font-serif-display text-xl text-[#201a15] dark:text-[#f0e6d6]">
              Share App Link
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
        <div className="p-6 flex flex-col gap-5 overflow-y-auto max-h-[80dvh]">
          {/* Main URL box with one-tap copy */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a] block mb-1.5">
              Live Web &amp; Mobile URL
            </label>
            <p className="text-xs text-[#706256] dark:text-[#a89a8a] mb-2.5">
              Open this link on your iPad, iPhone, or computer. Bookmark or add it to your Home Screen:
            </p>
            <div className="flex items-center gap-2 p-2 rounded-2xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25]">
              <Globe className="w-4 h-4 text-[#2e5934] dark:text-[#86b880] shrink-0 ml-1" />
              <input
                type="text"
                readOnly
                value={sharedUrl}
                className="flex-1 bg-transparent text-xs font-mono text-[#201a15] dark:text-[#f0e6d6] focus:outline-none truncate"
                onClick={e => (e.target as HTMLInputElement).select()}
              />
              <button
                type="button"
                onClick={handleCopy}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#2e5934] text-white flex items-center gap-1.5 shadow hover:bg-[#244729] active:scale-95 transition-all shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>
            {copyFailed && (
              <p className="text-xs text-red-700 dark:text-red-400 mt-2" role="alert">
                Your browser blocked copying. Tap the link above to select it, then choose Copy.
              </p>
            )}
          </div>

          {/* QR Code for instant phone/iPad camera scan */}
          <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-2xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25]">
            <div className="p-2 rounded-xl bg-white shadow-sm shrink-0">
              <img
                src={qrCodeUrl}
                alt="Scan QR code to open Reading Life"
                className="w-28 h-28 object-contain rounded-lg"
              />
            </div>
            <div className="flex flex-col gap-1 text-center sm:text-left">
              <span className="text-xs font-bold text-[#201a15] dark:text-[#f0e6d6] flex items-center justify-center sm:justify-start gap-1.5">
                <QrCode className="w-3.5 h-3.5 text-[#2e5934] dark:text-[#86b880]" />
                Scan with iPhone or iPad Camera
              </span>
              <p className="text-[11px] text-[#706256] dark:text-[#a89a8a] leading-relaxed">
                Point your iPhone or iPad camera at the code to open instantly in Safari.
              </p>
              <div className="mt-2 flex items-center justify-center sm:justify-start gap-2">
                <button
                  type="button"
                  onClick={handleNativeShare}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[#e3d7c3] dark:border-[#382f25] text-[#201a15] dark:text-[#f0e6d6] hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-1.5"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Share via iOS</span>
                </button>
                <a
                  href={sharedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#2e5934] dark:text-[#86b880] hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open tab</span>
                </a>
              </div>
            </div>
          </div>

          {/* Quick iOS Home Screen Instructions */}
          <div className="p-3.5 rounded-2xl bg-[#e8efe7] dark:bg-[#243422] border border-[#2e5934]/20 text-xs text-[#201a15] dark:text-[#f0e6d6] flex items-start gap-2.5">
            <Smartphone className="w-4 h-4 text-[#2e5934] dark:text-[#86b880] shrink-0 mt-0.5" />
            <div className="leading-relaxed text-[11px]">
              <strong>To save as an app icon on your iPad/iPhone:</strong> In Safari, tap the <strong>Share</strong> button (box with upward arrow) and choose <strong>Add to Home Screen</strong>.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#fbf7ee] dark:bg-[#231d17] border-t border-[#e3d7c3] dark:border-[#382f25]">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl text-xs font-semibold bg-[#2e5934] text-white hover:bg-[#244729] shadow-sm"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
