import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Pencil, X } from 'lucide-react';
import type { Book } from '../types';
import { useModalA11y } from '../hooks/useModalA11y';
import {
  COVER_SOURCE_LABEL,
  clearCoverPick,
  exportCoverPicks,
  getCoverToken,
  getCoversVersion,
  pickBook,
  pickSizedUrl,
  setCoverAdmin,
  setCoverToken,
  sharedCoverPicks,
  subscribeCovers,
  syncSharedCovers,
  type CoverPick,
} from '../services/books';
import { buildDraft, countChanges, draftStatus, publishCovers, type PublishResult } from '../services/books/coverPublish';
import { CoverPickerModal } from './CoverPickerModal';

/**
 * The owner's "Publish book covers" screen: every cover you starred (and what is already published), each with ✕ (take it off) and
 * ✎ (change the cover, in the same viewer). "Publish" sends the whole set to the shared store, after which everyone sees it.
 *
 * Light: nothing is fetched or drawn until it is opened; it asks the server once for the published set, rows skip layout until they scroll
 * near (content-visibility), thumbnails are the small card size and lazy, and nothing is stored here except what you press.
 */

const WHY: Record<Exclude<PublishResult, { ok: true }>['reason'], string> = {
  unauthorized: 'That token was not accepted. Check it and try again.',
  not_configured: 'The shared store is not set up yet: add the COVERS storage and the COVER_ADMIN_TOKEN secret in Cloudflare Pages (see the README).',
  too_large: 'That is too many covers for one publish.',
  invalid: 'The server could not read the list. Try again.',
  network: 'No connection. Nothing was published.',
  error: 'Something went wrong on the server. Nothing was published; try again in a moment.',
};
const STATUS_LABEL = { new: 'New', changed: 'Changed', published: 'Published' } as const;
const STATUS_STYLE = {
  new: 'bg-[#e8efe7] dark:bg-[#243422] text-[#2e5934] dark:text-[#86b880]',
  changed: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300',
  published: 'bg-black/5 dark:bg-white/10 text-[#706256] dark:text-[#a89a8a]',
} as const;

export function CoverPublishModal({ onClose }: { onClose: () => void }) {
  useModalA11y(onClose);
  const version = useSyncExternalStore(subscribeCovers, getCoversVersion, getCoversVersion); // your picks or the published set changed
  const [ready, setReady] = useState(false);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [token, setToken] = useState(getCoverToken);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<Book | null>(null);

  // The latest published set first, so a publish is always "published + your changes" and never overwrites with something stale
  useEffect(() => {
    let live = true;
    syncSharedCovers({ force: true }).then(ok => {
      if (!live) return;
      setReady(true);
      if (!ok) setMessage({ ok: false, text: 'Could not check what is published right now. Showing the last copy; publishing needs a connection.' });
    });
    return () => { live = false; };
  }, []);

  const shared = useMemo(() => sharedCoverPicks(), [version]);
  const draft = useMemo(() => buildDraft(shared, exportCoverPicks(), removed), [shared, removed, version]);
  const rows = useMemo(() => {
    const order = { new: 0, changed: 1, published: 2 } as const;
    return Object.entries(draft)
      .map(([key, rec]) => ({ key, rec, status: draftStatus(key, rec, shared), ...pickBook(key, rec) }))
      .sort((a, b) => order[a.status] - order[b.status] || a.title.localeCompare(b.title));
  }, [draft, shared]);
  const { changed, removed: toRemove } = countChanges(draft, shared);
  const pending = changed + toRemove;

  const remove = (key: string) => {
    setMessage(null);
    const book = { title: pickBook(key, draft[key]).title, author: pickBook(key, draft[key]).author };
    clearCoverPick(book); // your own pick goes; if it was published, it comes off the set when you publish
    if (shared[key]) setRemoved(prev => new Set(prev).add(key));
  };

  const edit = (key: string, rec: CoverPick) => {
    const { title, author } = pickBook(key, rec);
    setRemoved(prev => { if (!prev.has(key)) return prev; const n = new Set(prev); n.delete(key); return n; });
    setEditing({ id: key, title, author } as Book);
  };

  const publish = async () => {
    const t = token.trim();
    if (!t) return setMessage({ ok: false, text: 'Enter your publish token first.' });
    setBusy(true);
    setMessage(null);
    const r = await publishCovers(draft, t);
    setBusy(false);
    if (r.ok) {
      setCoverToken(t);
      setRemoved(new Set());
      setMessage({ ok: true, text: `Published ${r.count} ${r.count === 1 ? 'cover' : 'covers'} for everyone.${r.dropped ? ` ${r.dropped} could not be used and were skipped.` : ''}` });
    } else {
      if (r.reason === 'unauthorized') setCoverToken('');
      setMessage({ ok: false, text: WHY[r.reason] });
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={onClose}>
        <div
          className="relative w-full max-w-[560px] max-h-[90dvh] bg-[#fbf7ee] dark:bg-[#231d17] text-[#201a15] dark:text-[#f0e6d6] rounded-2xl shadow-2xl border border-[#e3d7c3] dark:border-[#382f25] flex flex-col overflow-hidden"
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Publish book covers"
        >
          <div className="px-5 py-4 border-b border-[#e3d7c3] dark:border-[#382f25] flex items-center justify-between">
            <div>
              <h3 className="font-serif-display text-xl leading-tight">Publish book covers</h3>
              <p className="text-xs text-[#706256] dark:text-[#a89a8a]">Covers you starred. Published ones show for every user.</p>
            </div>
            <button type="button" aria-label="Close" onClick={onClose} className="p-1.5 rounded-full text-[#706256] dark:text-[#a89a8a] hover:bg-black/10 dark:hover:bg-white/10">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-2">
            {!ready && <p className="px-2 py-6 text-sm text-center text-[#706256] dark:text-[#a89a8a]" role="status">Checking what is published…</p>}
            {ready && !rows.length && <p className="px-2 py-6 text-sm text-center text-[#706256] dark:text-[#a89a8a]">No starred covers yet. Open a book, tap the cover icon, and star a cover.</p>}
            <ul>
              {rows.map(({ key, rec, status, title, author }) => (
                <li
                  key={key}
                  className="flex items-center gap-3 px-2 py-2 border-b border-[#e3d7c3]/60 dark:border-[#382f25] last:border-0"
                  style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 72px' }}
                >
                  <img
                    src={pickSizedUrl(rec.url, 'S')}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="w-10 h-[60px] rounded object-cover bg-black/10 shrink-0"
                    onError={e => ((e.currentTarget as HTMLElement).style.visibility = 'hidden')}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{title}</div>
                    <div className="text-xs text-[#706256] dark:text-[#a89a8a] truncate">{author || 'Unknown author'}</div>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px]">
                      <span className={`px-1.5 py-0.5 rounded-full font-semibold ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
                      <span className="text-[#706256] dark:text-[#a89a8a]">{COVER_SOURCE_LABEL[rec.source]}</span>
                    </div>
                  </div>
                  <button type="button" onClick={() => edit(key, rec)} aria-label={`Change cover for ${title}`} title="Change cover" className="w-9 h-9 rounded-full flex items-center justify-center text-[#2e5934] dark:text-[#86b880] hover:bg-black/10 dark:hover:bg-white/10">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => remove(key)} aria-label={`Remove cover for ${title}`} title="Remove" className="w-9 h-9 rounded-full flex items-center justify-center text-[#925838] dark:text-[#d89e70] hover:bg-black/10 dark:hover:bg-white/10">
                    <X className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="px-5 py-4 border-t border-[#e3d7c3] dark:border-[#382f25] flex flex-col gap-2.5">
            {toRemove > 0 && (
              <div className="flex items-center justify-between text-xs text-[#706256] dark:text-[#a89a8a]">
                <span>{toRemove} will be taken off when you publish.</span>
                <button type="button" onClick={() => setRemoved(new Set())} className="font-semibold underline">Undo</button>
              </div>
            )}
            {!getCoverToken() && (
              <input
                type="password"
                value={token}
                onChange={e => setToken(e.target.value)}
                placeholder="Publish token (kept on this device only)"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-label="Publish token"
                className="w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25]"
              />
            )}
            {message && (
              <p className={`text-xs ${message.ok ? 'text-[#2e5934] dark:text-[#86b880]' : 'text-[#a33a2a] dark:text-[#e0897a]'}`} role="status" aria-live="polite">{message.text}</p>
            )}
            <button
              type="button"
              onClick={publish}
              disabled={busy || !ready || pending === 0}
              className="w-full py-2.5 rounded-xl text-sm font-semibold bg-[#2e5934] dark:bg-[#86b880] text-white dark:text-[#181410] disabled:opacity-40 active:scale-[0.98] transition-all"
            >
              {busy ? 'Publishing…' : pending ? `Publish ${pending} ${pending === 1 ? 'change' : 'changes'} for everyone` : 'Everything is published'}
            </button>
            <div className="flex items-center justify-between text-[11px] text-[#706256] dark:text-[#a89a8a]">
              {getCoverToken() ? <button type="button" onClick={() => { setCoverToken(''); setToken(''); setMessage(null); }} className="underline">Forget token on this device</button> : <span />}
              <button type="button" onClick={() => { setCoverAdmin(false); onClose(); }} className="underline">Hide cover tools</button>
            </div>
          </div>
        </div>
      </div>
      {editing && <CoverPickerModal book={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
