import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useModalA11y } from '../hooks/useModalA11y';
import { listWorks, loadCandidates, publishCandidate, rejectCandidate, setWorkStatus, syncCatalog, type Candidate, type WorkRow } from '../services/catalog';

/**
 * Owner only (developer mode, signed in, on the admin list). Pick a book, then browse every stored version of its cover, description,
 * author bio and rating with ‹ ›, and publish one or reject one. A rejected version never comes back. Nothing is fetched until it is opened.
 */
const KINDS: { kind: Candidate['kind']; label: string }[] = [
  { kind: 'cover', label: 'Cover' },
  { kind: 'book_description', label: 'Description' },
  { kind: 'author_bio', label: 'Author bio' },
  { kind: 'rating', label: 'Rating' },
];
const pill = 'px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/5 dark:bg-white/10 text-[#706256] dark:text-[#a89a8a]';
const btn = 'py-2 px-3 rounded-xl text-xs font-semibold border active:scale-95 transition-all disabled:opacity-40';

export function CatalogReviewModal({ onClose }: { onClose: () => void }) {
  useModalA11y(onClose);
  const [q, setQ] = useState('');
  const [works, setWorks] = useState<WorkRow[] | null>(null);
  const [work, setWork] = useState<WorkRow | null>(null);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [kind, setKind] = useState<Candidate['kind']>('cover');
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (work) return;
    let live = true;
    const t = setTimeout(() => { listWorks(q).then(r => { if (!live) return; if (r.ok) { setWorks(r.data); setMsg(null); } else setMsg({ ok: false, text: r.error }); }); }, q ? 300 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [q, work]);

  const reload = async (w: WorkRow) => {
    const r = await loadCandidates(w.id);
    if (r.ok) setCands(r.data); else setMsg({ ok: false, text: r.error });
  };
  const open = async (w: WorkRow) => { setWork(w); setIdx(0); setKind('cover'); setMsg(null); await reload(w); };

  const list = useMemo(() => cands.filter(c => c.kind === kind), [cands, kind]);
  const cur = list[Math.min(idx, Math.max(list.length - 1, 0))];

  const act = async (f: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    if (!work) return;
    setBusy(true); setMsg(null);
    const r = await f();
    if (r.ok) { await reload(work); await syncCatalog({ force: true }); setMsg({ ok: true, text: done }); } else setMsg({ ok: false, text: r.error || 'Failed.' });
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="relative w-full max-w-[560px] max-h-[90dvh] bg-[#fbf7ee] dark:bg-[#231d17] text-[#201a15] dark:text-[#f0e6d6] rounded-2xl shadow-2xl border border-[#e3d7c3] dark:border-[#382f25] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Review catalog">
        <div className="px-5 py-4 border-b border-[#e3d7c3] dark:border-[#382f25] flex items-center justify-between">
          <div>
            <h3 className="font-serif-display text-xl leading-tight">{work ? work.canonical_title : 'Review catalog'}</h3>
            <p className="text-xs text-[#706256] dark:text-[#a89a8a]">{work ? (work.canonical_author || 'Unknown author') + ' · ' + work.status : 'Pick a book to review its versions.'}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="p-1.5 rounded-full text-[#706256] dark:text-[#a89a8a] hover:bg-black/10 dark:hover:bg-white/10"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 space-y-3">
          {!work && (
            <>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search title or author" aria-label="Search the catalog" className="w-full px-3 py-2 rounded-xl text-sm bg-white dark:bg-[#1a1511] border border-[#e3d7c3] dark:border-[#382f25]" />
              {works === null && <p className="text-sm text-center text-[#706256] dark:text-[#a89a8a]" role="status">Loading…</p>}
              {works && !works.length && <p className="text-sm text-center text-[#706256] dark:text-[#a89a8a]">Nothing here yet. Publish covers, or use the catalog button in Book Info.</p>}
              <ul>
                {works?.map(w => (
                  <li key={w.id}>
                    <button type="button" onClick={() => void open(w)} className="w-full text-left px-2 py-2 border-b border-[#e3d7c3]/60 dark:border-[#382f25] hover:bg-black/5 dark:hover:bg-white/5">
                      <div className="text-sm font-semibold truncate">{w.canonical_title}</div>
                      <div className="text-xs text-[#706256] dark:text-[#a89a8a] truncate">{w.canonical_author || 'Unknown author'} · {w.status}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {work && (
            <>
              <div className="flex gap-1.5 flex-wrap" role="tablist">
                {KINDS.map(k => (
                  <button key={k.kind} role="tab" aria-selected={kind === k.kind} type="button" onClick={() => { setKind(k.kind); setIdx(0); }} className={`px-3 py-1 rounded-full text-xs font-semibold border ${kind === k.kind ? 'bg-[#2e5934] text-white border-[#2e5934]' : 'border-[#e3d7c3] dark:border-[#382f25]'}`}>
                    {k.label} ({cands.filter(c => c.kind === k.kind).length})
                  </button>
                ))}
              </div>
              {!cur && <p className="text-sm text-[#706256] dark:text-[#a89a8a] py-6 text-center">No versions stored for this yet.</p>}
              {cur && (
                <div className="rounded-xl border border-[#e3d7c3] dark:border-[#382f25] p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <button type="button" aria-label="Previous version" disabled={idx <= 0} onClick={() => setIdx(i => i - 1)} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-30"><ChevronLeft className="w-5 h-5" /></button>
                    <span className="text-xs text-[#706256] dark:text-[#a89a8a]">Version {Math.min(idx, list.length - 1) + 1} of {list.length}</span>
                    <button type="button" aria-label="Next version" disabled={idx >= list.length - 1} onClick={() => setIdx(i => i + 1)} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-30"><ChevronRight className="w-5 h-5" /></button>
                  </div>
                  {cur.kind === 'cover'
                    ? <img src={cur.text} alt="Cover version" referrerPolicy="no-referrer" className="mx-auto max-h-64 rounded object-contain bg-black/10" />
                    : <p className="text-sm whitespace-pre-wrap max-h-60 overflow-y-auto">{cur.text}</p>}
                  <div className="flex gap-1.5 flex-wrap">
                    <span className={pill}>{cur.status}</span>
                    {cur.selected && <span className={pill}>live</span>}
                    {cur.source && <span className={pill}>{cur.source}</span>}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" disabled={busy || cur.selected || cur.status === 'rejected'} onClick={() => void act(() => publishCandidate(cur), 'Published.')} className={`${btn} flex-1 border-[#2e5934] dark:border-[#86b880] text-[#2e5934] dark:text-[#86b880]`}>Publish this</button>
                    <button type="button" disabled={busy || cur.status === 'rejected'} onClick={() => void act(() => rejectCandidate(cur, 'rejected in review'), 'Rejected. It will not come back.')} className={`${btn} flex-1 border-[#a33a2a] dark:border-[#e0897a] text-[#a33a2a] dark:text-[#e0897a]`}>Reject</button>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between text-[11px]">
                <button type="button" className="underline text-[#706256] dark:text-[#a89a8a]" onClick={() => { setWork(null); setWorks(null); setCands([]); setMsg(null); }}>All books</button>
                <button type="button" disabled={busy} className="underline text-[#706256] dark:text-[#a89a8a]" onClick={() => void act(() => setWorkStatus(work.id, work.status === 'published' ? 'draft' : 'published').then(r => { if (r.ok) setWork({ ...work, status: work.status === 'published' ? 'draft' : 'published' }); return r; }), work.status === 'published' ? 'Hidden from readers.' : 'Visible to readers.')}>
                  {work.status === 'published' ? 'Hide this book from readers' : 'Publish this book'}
                </button>
              </div>
            </>
          )}
          {msg && <p role="status" className={`text-xs ${msg.ok ? 'text-[#2e5934] dark:text-[#86b880]' : 'text-[#a33a2a] dark:text-[#e0897a]'}`}>{msg.text}</p>}
        </div>
      </div>
    </div>
  );
}
