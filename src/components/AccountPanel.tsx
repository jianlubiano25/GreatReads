import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { authVersion, checkAdmin, currentUser, isAdminKnown, isRecovering, oauthUrl, sendReset, setPassword, signIn, signOut, signUp, subscribeAuth } from '../services/supabase';

/**
 * Account, in the Profile: email + password sign-in, create account, forgot / change password, or Google.
 * Signing in is optional: the app works the same without it. It is only needed to sync your library later and for the owner's developer tools.
 */
const field = 'w-full px-3 py-2 rounded-xl text-sm bg-white dark:bg-[#1a1511] border border-[#e3d7c3] dark:border-[#382f25] outline-none focus:border-[#2e5934]';
const btn = 'w-full py-2.5 px-3 rounded-xl text-xs font-semibold border border-[#2e5934] dark:border-[#86b880] text-[#2e5934] dark:text-[#86b880] active:scale-95 transition-all hover:bg-[#2e5934]/10 disabled:opacity-50';
const link = 'text-xs underline text-[#706256] dark:text-[#a89a8a]';

export const AccountPanel: React.FC = () => {
  useSyncExternalStore(subscribeAuth, authVersion, authVersion);
  const user = currentUser();
  const recovering = isRecovering();
  const admin = isAdminKnown();
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>('in');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { if (user && admin === undefined) void checkAdmin(); }, [user?.id, admin]);

  const run = async (f: () => Promise<{ ok: boolean; error?: string; note?: string }>, done?: () => void) => {
    setBusy(true); setMsg(null);
    const r = await f();
    setBusy(false);
    if (r.ok) { setMsg(r.note ? { ok: true, text: r.note } : null); setPw(''); setPw2(''); done?.(); }
    else setMsg({ ok: false, text: r.error || 'Something went wrong.' });
  };

  const box = (children: React.ReactNode) => (
    <div className="pt-3 border-t border-[#e3d7c3] dark:border-[#382f25] space-y-2">
      <span className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a] block">Account</span>
      {children}
      {msg && <p role="status" className={`text-xs ${msg.ok ? 'text-[#2e5934] dark:text-[#86b880]' : 'text-red-700 dark:text-red-400'}`}>{msg.text}</p>}
    </div>
  );

  // arrived from the reset link, or changing the password while signed in
  if (user && (recovering || changing)) {
    return (
      box(<>
        <p className="text-xs text-[#706256] dark:text-[#a89a8a]">{recovering ? 'Choose a new password.' : 'Change your password.'}</p>
        <input type="password" autoComplete="new-password" className={field} placeholder="New password (8+ characters)" value={pw} onChange={e => setPw(e.target.value)} />
        <input type="password" autoComplete="new-password" className={field} placeholder="Repeat new password" value={pw2} onChange={e => setPw2(e.target.value)} />
        <button type="button" className={btn} disabled={busy} onClick={() => {
          if (pw.length < 8) return setMsg({ ok: false, text: 'Use at least 8 characters.' });
          if (pw !== pw2) return setMsg({ ok: false, text: 'The two passwords differ.' });
          void run(() => setPassword(pw), () => setChanging(false));
        }}>Save new password</button>
        {!recovering && <button type="button" className={link} onClick={() => { setChanging(false); setMsg(null); }}>Cancel</button>}
      </>)
    );
  }

  if (user) {
    return (
      box(<>
        <div className="flex items-center gap-3 rounded-xl bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] p-3">
          <div className="w-9 h-9 rounded-full bg-[#e8efe7] dark:bg-[#243422] text-[#2e5934] dark:text-[#86b880] flex items-center justify-center font-bold">{(user.email || '?').slice(0, 1).toUpperCase()}</div>
          <div className="min-w-0">
            <p className="text-xs font-semibold break-all">{user.email}</p>
            <p className="text-[11px] text-[#706256] dark:text-[#a89a8a]">{admin ? 'Owner · catalog tools are on' : 'Signed in'}</p>
          </div>
        </div>
        <div className="flex gap-4">
          <button type="button" className={link} onClick={() => { setChanging(true); setMsg(null); }}>Change password</button>
          <button type="button" className={link} onClick={() => void signOut()}>Sign out</button>
        </div>
      </>)
    );
  }

  return (
    box(<>
      <p className="text-xs text-[#706256] dark:text-[#a89a8a]">Signing in is optional. It keeps a backup of your library in the cloud and, for the owner, unlocks the catalog tools.</p>
      <a href={oauthUrl('google')} className={`${btn} flex items-center justify-center gap-2 bg-white dark:bg-[#1a1511]`}>
        <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.5 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
        <span>Continue with Google</span>
      </a>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[#706256] dark:text-[#a89a8a]"><span className="flex-1 h-px bg-[#e3d7c3] dark:bg-[#382f25]" />or with email<span className="flex-1 h-px bg-[#e3d7c3] dark:bg-[#382f25]" /></div>
      <input type="email" autoComplete="email" className={field} placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
      {mode !== 'forgot' && <input type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} className={field} placeholder="Password" value={pw} onChange={e => setPw(e.target.value)} />}
      {mode === 'in' && <button type="button" className={btn} disabled={busy || !email || !pw} onClick={() => void run(() => signIn(email, pw))}>Sign in</button>}
      {mode === 'up' && <button type="button" className={btn} disabled={busy || !email || pw.length < 8} onClick={() => void run(() => signUp(email, pw))}>Create account</button>}
      {mode === 'forgot' && <button type="button" className={btn} disabled={busy || !email} onClick={() => void run(() => sendReset(email))}>Email me a reset link</button>}
      <div className="flex gap-4 flex-wrap">
        {mode !== 'in' && <button type="button" className={link} onClick={() => { setMode('in'); setMsg(null); }}>Sign in</button>}
        {mode !== 'up' && <button type="button" className={link} onClick={() => { setMode('up'); setMsg(null); }}>Create account</button>}
        {mode !== 'forgot' && <button type="button" className={link} onClick={() => { setMode('forgot'); setMsg(null); }}>Forgot password?</button>}
      </div>
    </>)
  );
};
