import React, { useState } from 'react';
import { checkGoogleBooks, hasOwnGoogleKey, looksLikeGoogleKey, setOwnGoogleKey } from '../services/books';

/**
 * Developer mode only (the Profile shows it while developer mode is on): paste your own Google Books API key.
 * It is kept on this device only (never in a backup, never sent to this site's server) and used instead of the server's key. Clear it to go back.
 */
export const GoogleKeyPanel: React.FC = () => {
  const [saved, setSaved] = useState(hasOwnGoogleKey);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = () => {
    if (!looksLikeGoogleKey(draft)) { setNote({ ok: false, text: 'That does not look like a Google API key (letters, numbers, - and _ only).' }); return; }
    if (!setOwnGoogleKey(draft)) { setNote({ ok: false, text: 'Could not save the key on this device.' }); return; }
    setSaved(true);
    setDraft('');
    setNote({ ok: true, text: 'Saved on this device. Ratings use it from now on.' });
  };
  const clear = () => {
    setOwnGoogleKey('');
    setSaved(false);
    setDraft('');
    setNote({ ok: true, text: 'Removed. The app uses the server key again.' });
  };
  const test = async () => {
    setBusy(true);
    setNote(null);
    const r = await checkGoogleBooks();
    setNote({ ok: r.ok, text: `${r.route === 'own key' ? 'Your key' : 'Server key'}: ${r.message}` });
    setBusy(false);
  };

  return (
    <div className="pt-3 border-t border-[#e3d7c3] dark:border-[#382f25]">
      <div className="p-3 rounded-xl border border-dashed border-[#e3d7c3] dark:border-[#382f25] space-y-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a] block">Google Books key · developer mode</span>
        <p className="text-[11px] text-[#706256] dark:text-[#a89a8a]">
          {saved ? 'Your own key is saved on this device and is used for Google ratings.' : 'Ratings use the server key. Paste your own key to use it instead on this device.'} It is never in a backup and never sent to this site's server.
        </p>
        <label className="text-xs font-semibold text-[#706256] dark:text-[#a89a8a] block" htmlFor="google-books-key">API key</label>
        <input
          id="google-books-key"
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={saved ? 'Saved (paste a new one to replace)' : 'Paste your key'}
          className="w-full py-2 px-3 rounded-xl border border-[#e3d7c3] dark:border-[#382f25] bg-[#f5f0e6] dark:bg-[#181410] text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={!draft.trim()} className="py-2 px-3 rounded-xl text-xs font-semibold border border-[#2e5934] dark:border-[#86b880] text-[#2e5934] dark:text-[#86b880] disabled:opacity-40 active:scale-95 transition-all">Save key</button>
          <button type="button" onClick={test} disabled={busy} className="py-2 px-3 rounded-xl text-xs font-semibold border border-[#e3d7c3] dark:border-[#382f25] text-[#706256] dark:text-[#a89a8a] disabled:opacity-40 active:scale-95 transition-all">{busy ? 'Testing…' : 'Test'}</button>
          {saved && <button type="button" onClick={clear} className="py-2 px-3 rounded-xl text-xs font-semibold text-[#706256] dark:text-[#a89a8a] underline">Remove key</button>}
        </div>
        {note && <p role="status" className={`text-[11px] ${note.ok ? 'text-emerald-600' : 'text-red-600 dark:text-red-400'}`}>{note.text}</p>}
      </div>
    </div>
  );
};
