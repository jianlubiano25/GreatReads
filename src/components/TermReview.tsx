import React, { useEffect, useState } from 'react';
import { SECTIONS, STATUS_LABEL, countByStatus, loadClassification, setItemsStatus, type ClassItem, type ClassStatus } from '../services/catalogTermReview';

/**
 * Owner only (inside Review catalog > Classification): what the four providers and the app suggest for this book's genres, subgenres, subjects & themes, collections, keywords & tags
 * and awards. Published = readers see it in Book Information. Tick several (or a whole section) and publish or reject them in one tap. Nothing is deleted.
 */
const pill = 'px-2 py-0.5 rounded-full text-[10px] font-semibold';
const PILL: Record<ClassStatus, string> = { approved: 'bg-[#e8efe7] dark:bg-[#243422] text-[#2e5934] dark:text-[#86b880]', candidate: 'bg-black/5 dark:bg-white/10 text-[#706256] dark:text-[#a89a8a]', rejected: 'bg-[#f6e3df] dark:bg-[#3a2420] text-[#a33a2a] dark:text-[#e0897a]' };
const btn = 'py-1.5 px-3 rounded-xl text-xs font-semibold border active:scale-95 transition-all disabled:opacity-40';
const SOURCE: Record<string, string> = { openlibrary: 'Open Library', google: 'Google Books', apple: 'Apple Books', hardcover: 'Hardcover', app: 'App', owner: 'You' };
const keyOf = (i: ClassItem) => `${i.table}|${i.section}|${i.name}`;

export function TermReview({ workId, bookPublished, onMsg }: { workId: string; bookPublished: boolean; onMsg: (m: { ok: boolean; text: string } | null) => void }) {
  const [items, setItems] = useState<ClassItem[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const load = async () => { const r = await loadClassification(workId); if (r.ok) setItems(r.data); else onMsg({ ok: false, text: r.error }); };
  useEffect(() => { setItems(null); setPicked(new Set()); void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [workId]);

  const apply = async (list: ClassItem[], status: ClassStatus) => {
    if (!list.length) return;
    setBusy(true); onMsg(null);
    const r = await setItemsStatus(list, status);
    onMsg(r.ok ? { ok: true, text: `${status === 'approved' ? 'Published' : 'Rejected'} ${list.length === 1 ? `“${list[0].name}”` : `${list.length} items`}.` } : { ok: false, text: r.error || 'Could not save.' });
    setPicked(new Set());
    await load(); setBusy(false);
  };
  if (!items) return <p className="text-sm text-[#706256] dark:text-[#a89a8a] py-6 text-center">Loading…</p>;
  if (!items.length) return <p className="text-sm text-[#706256] dark:text-[#a89a8a] py-6 text-center">Nothing suggested for this book yet. Save it to the catalog from Book Info so the providers&rsquo; genres, subjects, tags and awards are captured.</p>;
  const total = countByStatus(items);
  const chosen = items.filter(i => picked.has(keyOf(i)));
  const toggle = (i: ClassItem) => setPicked(p => { const n = new Set(p); n.has(keyOf(i)) ? n.delete(keyOf(i)) : n.add(keyOf(i)); return n; });
  return (
    <div className="space-y-4">
      <p className="text-xs text-[#706256] dark:text-[#a89a8a]">
        {total.approved} published · {total.candidate} not published · {total.rejected} rejected. Published means readers see it in Book Information.
        {!bookPublished && ' This book itself is hidden from readers, so nothing here shows until you publish the book.'}
      </p>
      {chosen.length > 0 && (
        <div className="sticky top-0 z-10 flex items-center gap-2 rounded-xl border border-[#e3d7c3] dark:border-[#382f25] bg-[#fdfaf3] dark:bg-[#201a15] p-2">
          <span className="text-xs font-semibold flex-1">{chosen.length} selected</span>
          <button type="button" disabled={busy} onClick={() => void apply(chosen, 'approved')} className={`${btn} border-[#2e5934] dark:border-[#86b880] text-[#2e5934] dark:text-[#86b880]`}>Publish selected</button>
          <button type="button" disabled={busy} onClick={() => void apply(chosen, 'rejected')} className={`${btn} border-[#a33a2a] dark:border-[#e0897a] text-[#a33a2a] dark:text-[#e0897a]`}>Reject selected</button>
        </div>
      )}
      {SECTIONS.map(sec => {
        const rows = items.filter(i => i.section === sec);
        if (!rows.length) return null;
        const c = countByStatus(rows);
        const waiting = rows.filter(i => i.status === 'candidate');
        return (
          <section key={sec} aria-label={sec} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a]">{sec} · {c.approved} published of {rows.length}</h4>
              {waiting.length > 0 && <button type="button" disabled={busy} onClick={() => void apply(waiting, 'approved')} className="text-[11px] underline text-[#2e5934] dark:text-[#86b880] disabled:opacity-40">Publish all {waiting.length} not published</button>}
            </div>
            <ul className="space-y-1.5">
              {rows.map(it => (
                <li key={keyOf(it)} className="rounded-xl border border-[#e3d7c3] dark:border-[#382f25] p-2.5 space-y-1">
                  <div className="flex items-start gap-2">
                    <input type="checkbox" aria-label={`Select ${it.name}`} className="mt-1" checked={picked.has(keyOf(it))} onChange={() => toggle(it)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold break-words min-w-0">{it.name}</span>
                        <span className={`${pill} ${PILL[it.status]}`}>{STATUS_LABEL[it.status]}</span>
                      </div>
                      <div className="text-[11px] text-[#706256] dark:text-[#a89a8a]">From {it.sources.map(s => SOURCE[s] || s).join(', ')}{it.labels.length ? ` · as “${it.labels.slice(0, 3).join('”, “')}”` : ''}</div>
                    </div>
                  </div>
                  <div className="flex gap-2 pl-6">
                    <button type="button" disabled={busy || it.status === 'approved'} onClick={() => void apply([it], 'approved')} className={`${btn} flex-1 border-[#2e5934] dark:border-[#86b880] text-[#2e5934] dark:text-[#86b880]`}>Publish</button>
                    <button type="button" disabled={busy || it.status === 'rejected'} onClick={() => void apply([it], 'rejected')} className={`${btn} flex-1 border-[#a33a2a] dark:border-[#e0897a] text-[#a33a2a] dark:text-[#e0897a]`}>Reject</button>
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
