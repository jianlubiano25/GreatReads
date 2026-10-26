/**
 * A tiny Supabase client written by hand (no dependency): email + password sign-in, password reset, Google sign-in by redirect,
 * and database function calls. Only the PUBLISHABLE key lives here; it is safe to ship. Secret / service-role keys never go in the app.
 * The session is kept on this device only and is never part of a backup.
 */

import { settingsRecordsSyncEnabled } from './settingsRecordsFlag';
const URL_ = ((import.meta as any).env?.VITE_SUPABASE_URL as string) || 'https://amvkwwqcepmxxkfeqjox.supabase.co';
const KEY_ = ((import.meta as any).env?.VITE_SUPABASE_KEY as string) || 'sb_publishable_s-atrWTsjqEYhAyM2moavQ_D0UQRZ51';
const SESSION_KEY = 'readlife.sb1';

export type SbUser = { id: string; email?: string };
type Session = { access: string; refresh: string; exp: number; user: SbUser };
export type AuthResult = { ok: true; note?: string } | { ok: false; error: string };

let session: Session | null | undefined;
let admin: boolean | undefined;
let recovery = false;
const listeners = new Set<() => void>();
let rev = 0;
const emit = () => { rev++; listeners.forEach(l => l()); };

const load = (): Session | null => {
  if (session === undefined) {
    try { const r = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); session = r && r.access && r.refresh ? r : null; } catch { session = null; }
  }
  return session ?? null;
};
const save = (s: Session | null) => {
  session = s;
  admin = undefined;
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch {}
  emit();
};

export const subscribeAuth = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const authVersion = (): number => rev;
export const currentUser = (): SbUser | null => load()?.user ?? null;
export const isRecovering = (): boolean => recovery;
export const isAdminKnown = (): boolean | undefined => admin;

const toSession = (b: any): Session | null => {
  if (!b?.access_token || !b?.refresh_token) return null;
  return { access: b.access_token, refresh: b.refresh_token, exp: Date.now() + (Number(b.expires_in) || 3600) * 1000, user: { id: b.user?.id || '', email: b.user?.email } };
};
const errText = async (res: Response): Promise<string> => {
  try { const b = await res.json(); return String(b.msg || b.error_description || b.message || b.error || `Error ${res.status}`); } catch { return `Error ${res.status}`; }
};
const plain = (m: string): string => {
  if (/invalid login/i.test(m)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(m)) return 'Please confirm your email first (check your inbox).';
  if (/already registered/i.test(m)) return 'That email already has an account. Try signing in.';
  if (/password should be/i.test(m)) return 'Use a longer password (at least 8 characters).';
  if (/rate limit|too many/i.test(m)) return 'Too many tries. Wait a minute and try again.';
  return m;
};

/** Every request gives up after this long. Without a limit, one request that never answers (common on a phone that was suspended mid-request) froze sync until the app was closed. */
let requestTimeoutMs = 25_000;
/** Tests only. */
export const setRequestTimeoutMs = (ms: number) => { requestTimeoutMs = ms; };
async function timedFetch(url: string, init: RequestInit, readBody?: (res: Response) => Promise<unknown>): Promise<{ res: Response; body?: unknown }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), requestTimeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    return { res, body: readBody ? await readBody(res) : undefined };
  } finally { clearTimeout(timer); }
}

async function auth(path: string, body: unknown, method = 'POST', token?: string): Promise<Response> {
  return (await timedFetch(`${URL_}/auth/v1/${path}`, { method, headers: { apikey: KEY_, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })).res;
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  try {
    const res = await auth('token?grant_type=password', { email: email.trim(), password });
    if (!res.ok) return { ok: false, error: plain(await errText(res)) };
    const s = toSession(await res.json());
    if (!s) return { ok: false, error: 'Sign-in did not return a session.' };
    save(s);
    return { ok: true };
  } catch { return { ok: false, error: 'No connection.' }; }
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
  try {
    const res = await auth('signup', { email: email.trim(), password });
    if (!res.ok) return { ok: false, error: plain(await errText(res)) };
    const b = await res.json();
    const s = toSession(b);
    if (s) { save(s); return { ok: true }; }
    return { ok: true, note: 'Check your email to confirm your account, then sign in.' };
  } catch { return { ok: false, error: 'No connection.' }; }
}

export async function sendReset(email: string): Promise<AuthResult> {
  try {
    const redirect = encodeURIComponent(location.origin + location.pathname);
    const res = await auth(`recover?redirect_to=${redirect}`, { email: email.trim() });
    if (!res.ok) return { ok: false, error: plain(await errText(res)) };
    return { ok: true, note: 'If that email has an account, a reset link is on its way.' };
  } catch { return { ok: false, error: 'No connection.' }; }
}

/** Set a new password: after the reset link, or from the profile while signed in. */
export async function setPassword(password: string): Promise<AuthResult> {
  const token = await accessToken();
  if (!token) return { ok: false, error: 'Please sign in first.' };
  try {
    const res = await auth('user', { password }, 'PUT', token);
    if (!res.ok) return { ok: false, error: plain(await errText(res)) };
    recovery = false;
    emit();
    return { ok: true, note: 'Password changed.' };
  } catch { return { ok: false, error: 'No connection.' }; }
}

export async function signOut(): Promise<void> {
  const s = load();
  save(null);
  if (s) { try { await auth('logout', undefined, 'POST', s.access); } catch {} }
}

/** Google: the browser goes to Google and comes back here signed in (Google must be switched on in Supabase). */
export function oauthUrl(provider: 'google'): string {
  return `${URL_}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(location.origin + location.pathname)}`;
}

/** Call once at start: takes the tokens out of the address after a provider / reset-link redirect. */
export function consumeAuthRedirect(): void {
  try {
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    const access = h.get('access_token'), refresh = h.get('refresh_token');
    if (!access || !refresh) return;
    const payload = JSON.parse(atob(access.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    save({ access, refresh, exp: Date.now() + (Number(h.get('expires_in')) || 3600) * 1000, user: { id: payload.sub, email: payload.email } });
    recovery = h.get('type') === 'recovery';
    history.replaceState(null, '', location.pathname + location.search);
    emit();
  } catch {}
}

let refreshing: Promise<Session | null> | undefined;
async function refresh(s: Session): Promise<Session | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const res = await auth('token?grant_type=refresh_token', { refresh_token: s.refresh });
      if (res.status === 400 || res.status === 401) { save(null); return null; } // the refresh token is no longer valid
      if (!res.ok) return s;
      const n = toSession(await res.json());
      if (n) { n.user = n.user.id ? n.user : s.user; save(n); return n; }
      return s;
    } catch { return s; } finally { refreshing = undefined; }
  })();
  return refreshing;
}

export async function accessToken(): Promise<string | null> {
  let s = load();
  if (!s) return null;
  if (s.exp - Date.now() < 60_000) s = await refresh(s);
  return s?.access ?? null;
}

/** PostgREST call (table read / write or a function). Signed in when there is a session, otherwise as the public reader. */
export async function rest<T = unknown>(path: string, init: { method?: string; body?: unknown; prefer?: string; ifModifiedSince?: never } = {}): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  try {
    const token = await accessToken();
    const { res, body } = await timedFetch(`${URL_}/rest/v1/${path}`, {
      method: init.method || 'GET',
      headers: { apikey: KEY_, authorization: `Bearer ${token || KEY_}`, 'content-type': 'application/json', ...(init.prefer ? { prefer: init.prefer } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }, async r => (r.ok ? await r.text() : await errText(r)));
    if (!res.ok) return { ok: false, status: res.status, error: String(body) };
    const text = String(body ?? '');
    return { ok: true, data: (text ? JSON.parse(text) : null) as T };
  } catch { return { ok: false, status: 0, error: 'No connection.' }; }
}
export const rpc = <T = unknown>(fn: string, args: Record<string, unknown> = {}) => rest<T>(`rpc/${fn}`, { method: 'POST', body: args });

/**
 * Subscribe to the authenticated user's personal tables using Supabase Realtime's Phoenix websocket protocol.
 * The messages are arrays [join_ref, ref, topic, event, payload], which is serializer version 2.0.0. Asking for 1.0.0 (object messages)
 * made the server reject every join and heartbeat ("V1 JSON Serializer expected a map"), so live updates never arrived.
 */
import { createLinkHealth } from './linkHealth';
import { createProbeWatcher, probeFingerprint, type ProbeRest } from './changeProbe';

export function subscribeLibraryRealtime(userId: string, onChange: (table: string) => void): () => void {
  let stopped = false;
  let socket: WebSocket | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = 1000;
  const health = createLinkHealth(60_000);
  const probeWatcher = createProbeWatcher();
  let probing = false;
  const unAuth = subscribeAuth(() => {
    if (currentUser()?.id !== userId) { socket?.close(); return; }
    if (socket?.readyState === WebSocket.OPEN) socket.close(); // a refreshed login token: reconnect so the live channel is re-authorised
  });
  const tables = ['user_library_books', 'user_book_annotations', 'user_shelves', 'user_shelf_books', 'user_reading_sessions', 'user_library_preferences', 'user_daily_pages', ...(settingsRecordsSyncEnabled() ? ['user_settings', 'user_words'] : [])]; // the two Phase 4 tables exist only once the migrations are applied and the switch is on
  let hasConnected = false;
  const topic = `realtime:greatreads:${userId}`;
  const connect = async () => {
    retry = undefined;
    if (stopped || currentUser()?.id !== userId || typeof WebSocket === 'undefined') return;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    const token = await accessToken();
    if (!token || stopped || currentUser()?.id !== userId) return;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    const base = URL_.replace(/^http/, 'ws');
    const ws = new WebSocket(`${base}/realtime/v1/websocket?apikey=${encodeURIComponent(KEY_)}&vsn=2.0.0`);
    socket = ws;
    let closed = false;
    ws.onopen = () => {
      if (socket !== ws) { ws.close(); return; }
      delay = 1000;
      health.opened(Date.now());
      // Anything that changed while the socket was down was never delivered: after a RE-connect, ask the app to pull everything once.
      if (hasConnected) onChange('resync'); hasConnected = true;
      const postgres_changes = tables.map(table => ({ event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` }));
      ws.send(JSON.stringify(['1', '1', topic, 'phx_join', { config: { broadcast: { ack: false, self: false }, presence: { key: '' }, postgres_changes }, access_token: token }]));
      heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify([null, String(Date.now()), 'phoenix', 'heartbeat', {}])); }, 20_000);
    };
    ws.onmessage = event => {
      if (socket !== ws) return;
      health.heard(Date.now()); // any message, including a heartbeat reply, proves the link is alive
      try {
        const message = JSON.parse(String(event.data));
        if (!Array.isArray(message)) return;
        const kind = message[3], payload = message[4];
        // The server refused or dropped our channel (for example the login token expired): rebuild instead of waiting for events that will never come
        if (message[2] === topic && ((kind === 'phx_reply' && payload?.status === 'error') || kind === 'phx_error' || kind === 'phx_close')) { health.channelFailed(); rebuild(); return; }
        if (kind !== 'postgres_changes') return;
        const table = payload?.data?.table || payload?.table;
        if (typeof table === 'string' && tables.includes(table) && currentUser()?.id === userId) onChange(table);
      } catch {}
    };
    const onEnd = () => {
      if (closed) return; closed = true; // onerror and onclose both fire: handle the end of this socket once
      if (socket === ws) { if (heartbeat) clearInterval(heartbeat); heartbeat = undefined; socket = undefined; }
      if (!stopped && currentUser()?.id === userId && !retry) { retry = setTimeout(() => void connect(), delay); delay = Math.min(30_000, delay * 2); }
    };
    ws.onclose = onEnd; ws.onerror = onEnd;
  };
  /** Throw the current connection away and open a new one now. */
  const rebuild = () => {
    const old = socket;
    if (heartbeat) { clearInterval(heartbeat); heartbeat = undefined; }
    socket = undefined;
    try { old?.close(); } catch {}
    if (retry) { clearTimeout(retry); retry = undefined; }
    if (!stopped) retry = setTimeout(() => void connect(), 0);
  };
  const checkLink = () => {
    if (stopped || currentUser()?.id !== userId) return;
    const open = !!socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING);
    if (health.shouldRebuild(Date.now(), open)) { if (socket || !retry) rebuild(); }
  };
  /** Safety net: a tiny revision-only check. If anything changed in the cloud, pull it, whatever the live connection did or did not deliver. */
  const probe = async () => {
    if (stopped || probing || currentUser()?.id !== userId || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    probing = true;
    try {
      const fp = await probeFingerprint(userId, rest as ProbeRest);
      if (!stopped && probeWatcher.changed(fp)) onChange('resync');
    } catch {} finally { probing = false; }
  };
  const onWake = () => { if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return; checkLink(); void probe(); };
  const watchdog = setInterval(checkLink, 10_000);
  // Safety net next to the live channel: while the app is on screen, a tiny revision check every 10 seconds catches anything the live connection missed.
  const probeTimer = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void probe(); }, 10_000);
  if (typeof document !== 'undefined') { document.addEventListener('visibilitychange', onWake); window.addEventListener('online', onWake); window.addEventListener('pageshow', onWake); window.addEventListener('focus', onWake); }
  void probe(); // baseline
  void connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    if (heartbeat) clearInterval(heartbeat);
    clearInterval(watchdog); clearInterval(probeTimer);
    if (typeof document !== 'undefined') { document.removeEventListener('visibilitychange', onWake); window.removeEventListener('online', onWake); window.removeEventListener('pageshow', onWake); window.removeEventListener('focus', onWake); }
    socket?.close();
    unAuth();
  };
}

/** Is the signed-in user on the admin list? Asked of the database, never decided in the app. */
export async function checkAdmin(): Promise<boolean> {
  if (!currentUser()) { admin = false; return false; }
  const r = await rpc<boolean>('catalog_is_admin');
  admin = r.ok && r.data === true;
  emit();
  return admin;
}
