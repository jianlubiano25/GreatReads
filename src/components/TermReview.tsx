import React, { useEffect, useState } from 'react';
import { groupTerms, loadTermRows, setTermsStatus, type TermGroup, type TermRow, type TermStatus } from '../services/catalogTermReview';

/** Owner only (inside Review catalog): the terms suggested for one book, from the four providers and the app, approved or rejected with one tap. Candidates are never shown to readers. */
const KIND_LABEL: Record<string, string> = { genre: 'Genre', subgenre: 'Subgenre', subject: 'Subject / theme', collection: 'Collection', keyword: 'Keyword', tag: 'Tag' };
const pill = 'px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/5 dark:bg-white/10 text-[#706256] dark:text-[#a89a8a]';
const btn = 'py-1.5 px-3 rounded-xl text-xs font-semibold border active:scale-95 transition-all disabled:opacity-40';

export function TermReview({ workId, onMsg }: { workId: string; onMsg: (m: { ok: boolean; text: string } | null) => void }) {
  const [rows, setRows] = useState<TermRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => { const r = await loadTermRows(workId); if (r.ok) setRows(r.data); else onMsg({ ok: false, text: r.error }); };
  useEffect(() => { setRows(null); void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [workId]);
  const set = async (g: TermGroup, status: TermStatus) => {
    setBusy(true); onMsg(null);
    const r = await setTermsStatus(g.ids, status);
    onMsg(r.ok ? { ok: true, text: status === 'approved' ? `Approved “${g.name}”. Readers see it in Book Info.` : status === 'rejected' ? `Rejected “${g.name}”.` : `“${g.name}” is back to a candidate.` } : { ok: false, text: r.error || 'Could not save.' });
    await load(); setBusy(false);
  };
  if (!rows) return <p className="text-sm text-[#706256] dark:text-[#a89a8a] py-6 text-center">Loading terms…</p>;
  const groups = groupTerms(rows);
  if (!groups.length) return <p className="text-sm text-[#706256] dark:text-[#a89a8a] py-6 text-center">No terms suggested for this book yet. Save it to the catalog from Book Info so the providers&rsquo; labels are captured.</p>;
  return (
    <ul className="space-y-2">
      {groups.map(g => (
        <li key={`${g.kind}|${g.name}`} className="rounded-xl border border-[#e3d7c3] dark:border-[#382f25] p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">{g.name}</div>
            <div className="flex gap-1.5 flex-wrap justify-end"><span className={pill}>{KIND_LABEL[g.kind] || g.kind}</span><span className={pill}>{g.status}</span></div>
          </div>
          <div className="text-[11px] text-[#706256] dark:text-[#a89a8a]">From {g.sources.join(', ')}{g.labels.length ? ` · “${g.labels.slice(0, 3).join('”, “')}”` : ''}</div>
          <div className="flex gap-2">
            <button type="button" disabled={busy || g.status === 'approved'} onClick={() => void set(g, 'approved')} className={`${btn} flex-1 border-[#2e5934] dark:border-[#86b880] text-[#2e5934] dark:text-[#86b880]`}>Approve</button>
            <button type="button" disabled={busy || g.status === 'rejected'} onClick={() => void set(g, 'rejected')} className={`${btn} flex-1 border-[#a33a2a] dark:border-[#e0897a] text-[#a33a2a] dark:text-[#e0897a]`}>Reject</button>
          </div>
        </li>
      ))}
    </ul>
  );
}
