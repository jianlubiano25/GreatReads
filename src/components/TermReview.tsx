import React, { useEffect, useState } from 'react';
import { SECTIONS, loadClassification, setItemStatus, type ClassItem, type ClassStatus } from '../services/catalogTermReview';

/**
 * Owner only (inside Review catalog > Classification): what the four providers and the app suggest for this book's genres, subgenres, subjects & themes, collections, keywords & tags
 * and awards. Approve what is right; readers see only approved ones in Book Information. Nothing is deleted.
 */
const pill = 'px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/5 dark:bg-white/10 text-[#706256] dark:text-[#a89a8a]';
const btn = 'py-1 px-3 rounded-xl text-xs font-semibold border active:scale-95 transition-all disabled:opacity-40';
const SOURCE: Record<string, string> = { openlibrary: 'Open Library', google: 'Google Books', apple: 'Apple Books', hardcover: 'Hardcover', app: 'App', owner: 'You' };

export function TermReview({ workId, onMsg }: { workId: string; onMsg: (m: { ok: boolean; text: string } | null) => void }) {
  const [items, setItems] = useState<ClassItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => { const r = await loadClassification(workId); if (r.ok) setItems(r.data); else onMsg({ ok: false, text: r.error }); };
  useEffect(() => { setItems(null); void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [workId]);
  const set = async (it: ClassItem, status: ClassStatus) => {
    setBusy(true); onMsg(null);
    const r = await setItemStatus(it, status);
    onMsg(r.ok ? { ok: true, text: status === 'approved' ? `Approved “${it.name}”. Readers see it in Book Information.` : `Rejected “${it.name}”.` } : { ok: false, text: r.error || 'Could not save.' });
    await load(); setBusy(false);
  };
  if (!items) return <p className="text-sm text-[#706256] dark:text-[#a89a8a] py-6 text-center">Loading…</p>;
  if (!items.length) return <p className="text-sm text-[#706256] dark:text-[#a89a8a] py-6 text-center">Nothing suggested for this book yet. Save it to the catalog from Book Info so the providers&rsquo; genres, subjects, tags and awards are captured.</p>;
  return (
    <div className="space-y-4">
      <p className="text-xs text-[#706256] dark:text-[#a89a8a]">What Open Library, Google Books, Apple Books, Hardcover and the app suggest for this book. Approve what is right; readers only see approved ones.</p>
      {SECTIONS.map(sec => {
        const rows = items.filter(i => i.section === sec);
        if (!rows.length) return null;
        return (
          <section key={sec} aria-label={sec} className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a]">{sec} ({rows.length})</h4>
            <ul className="space-y-1.5">
              {rows.map(it => (
                <li key={`${it.table}|${it.name}`} className="rounded-xl border border-[#e3d7c3] dark:border-[#382f25] p-2.5 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold break-words min-w-0">{it.name}</span>
                    <span className={pill}>{it.status}</span>
                  </div>
                  <div className="text-[11px] text-[#706256] dark:text-[#a89a8a]">From {it.sources.map(s => SOURCE[s] || s).join(', ')}{it.labels.length ? ` · as “${it.labels.slice(0, 3).join('”, “')}”` : ''}</div>
                  <div className="flex gap-2">
                    <button type="button" disabled={busy || it.status === 'approved'} onClick={() => void set(it, 'approved')} className={`${btn} flex-1 border-[#2e5934] dark:border-[#86b880] text-[#2e5934] dark:text-[#86b880]`}>Approve</button>
                    <button type="button" disabled={busy || it.status === 'rejected'} onClick={() => void set(it, 'rejected')} className={`${btn} flex-1 border-[#a33a2a] dark:border-[#e0897a] text-[#a33a2a] dark:text-[#e0897a]`}>Reject</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
