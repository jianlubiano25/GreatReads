import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { authVersion, checkAdmin, currentUser, isAdminKnown, isRecovering, oauthUrl, sendReset, setPassword, signIn, signOut, signUp, subscribeAuth } from '../services/supabase';

/**
 * Account, in the Profile: email + password sign-in, create account, forgot / change password, Google and Facebook (free).
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

  const Box = ({ children }: { children: React.ReactNode }) => (
    <div className="pt-3 border-t border-[#e3d7c3] dark:border-[#382f25] space-y-2">
      <span className="text-xs font-bold uppercase tracking-wider text-[#706256] dark:text-[#a89a8a] block">Account</span>
      {children}
      {msg && <p role="status" className={`text-xs ${msg.ok ? 'text-[#2e5934] dark:text-[#86b880]' : 'text-red-700 dark:text-red-400'}`}>{msg.text}</p>}
    </div>
  );

  // arrived from the reset link, or changing the password while signed in
  if (user && (recovering || changing)) {
    return (
      <Box>
        <p className="text-xs text-[#706256] dark:text-[#a89a8a]">{recovering ? 'Choose a new password.' : 'Change your password.'}</p>
        <input type="password" autoComplete="new-password" className={field} placeholder="New password (8+ characters)" value={pw} onChange={e => setPw(e.target.value)} />
        <input type="password" autoComplete="new-password" className={field} placeholder="Repeat new password" value={pw2} onChange={e => setPw2(e.target.value)} />
        <button type="button" className={btn} disabled={busy} onClick={() => {
          if (pw.length < 8) return setMsg({ ok: false, text: 'Use at least 8 characters.' });
          if (pw !== pw2) return setMsg({ ok: false, text: 'The two passwords differ.' });
          void run(() => setPassword(pw), () => setChanging(false));
        }}>Save new password</button>
        {!recovering && <button type="button" className={link} onClick={() => { setChanging(false); setMsg(null); }}>Cancel</button>}
      </Box>
    );
  }

  if (user) {
    return (
      <Box>
        <p className="text-xs">Signed in as <span className="font-semibold break-all">{user.email}</span>{admin ? <span className="ml-1 text-[#2e5934] dark:text-[#86b880]">(owner)</span> : null}</p>
        <div className="flex gap-4">
          <button type="button" className={link} onClick={() => { setChanging(true); setMsg(null); }}>Change password</button>
          <button type="button" className={link} onClick={() => void signOut()}>Sign out</button>
        </div>
      </Box>
    );
  }

  return (
    <Box>
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
      <div className="grid grid-cols-2 gap-2">
        <a href={oauthUrl('google')} className={`${btn} text-center`}>Google</a>
        <a href={oauthUrl('facebook')} className={`${btn} text-center`}>Facebook</a>
      </div>
    </Box>
  );
};
