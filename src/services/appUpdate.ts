/**
 * "New version available" detection.
 *
 * Every build gets an id made from its source files (see vite.config.ts). The running app knows its own id
 * (APP_BUILD) and the service worker knows the id it was built with. A prompt is shown ONLY when a newer
 * service worker is waiting AND its id differs from the one you are running. A worker that merely has different
 * bytes (a redeploy of the same code, a changed asset list) is activated silently and never bothers you.
 */
import { useSyncExternalStore } from 'react';
import { autoUpdatePlan, parseTried, parseVersion, shouldPrompt } from './updateRule';

declare const __APP_BUILD__: string;
export const APP_BUILD: string = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 'dev';

export interface UpdateState {
  available: boolean; // a different build is downloaded and ready
  checking: boolean; // a manual check is running
  upToDate: boolean; // the last manual check found nothing new
}

let snapshot: UpdateState = { available: false, checking: false, upToDate: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<UpdateState>) => {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach(l => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};
const getSnapshot = () => snapshot;

export const useAppUpdate = (): UpdateState => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

let reg: ServiceWorkerRegistration | undefined;
let applying = false;
// Remembered for this session, so "Not now" is not undone by a reload.
let dismissedBuild = (() => { try { return sessionStorage.getItem('rl-dismissed-build') || ''; } catch { return ''; } })();
let reloading = false;
let lastCheck = 0;
/** The newest build the site says it has (from version.json), whether or not a service worker has downloaded it yet. */
let siteBuild: string | null = null;
const CHECK_EVERY = 10 * 60 * 1000;
/** The build id of the service worker that is waiting (when it differs from this app's own). */
let waitingBuild: string | null = null;
/** When the app last came back to the front, and how long it had been away: a natural moment to apply an update (see autoUpdatePlan). */
let resume = { at: 0, hiddenFor: 0 };
let hiddenAt = 0;
const TRIED_KEY = 'readlife.autoUpdate1'; // one tiny control record: the last automatic reload (build + time); never user data

/** Something is in progress: a text field has focus, or a sheet / dialog is open. */
function isBusy(): boolean {
  try {
    const a = document.activeElement as HTMLElement | null;
    if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return true;
    return !!document.querySelector('[role="dialog"],[aria-modal="true"],.fixed.inset-0');
  } catch {
    return true; // cannot tell: do not reload on our own
  }
}

/**
 * A newer build is available. Apply it ourselves only at a natural pause (the app was just opened, or just came back after minutes
 * away) with nothing in progress, and never more than once per build (a failed attempt leaves the banner, not a reload loop).
 * Anywhere else the banner is shown and the reader picks the moment.
 */
function considerAutoApply() {
  if (!snapshot.available || applying || reloading) return;
  const target = siteBuild && siteBuild !== APP_BUILD ? siteBuild : waitingBuild;
  const now = Date.now();
  const plan = autoUpdatePlan({
    appBuild: APP_BUILD,
    targetBuild: target,
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    msSinceLaunch: typeof performance !== 'undefined' ? performance.now() : Infinity,
    hiddenForMs: now - resume.at < 20_000 ? resume.hiddenFor : 0,
    busy: isBusy(),
    tried: (() => { try { return parseTried(localStorage.getItem(TRIED_KEY)); } catch { return null; } })(),
    now,
  });
  if (plan !== 'reload' || !target) return;
  try { localStorage.setItem(TRIED_KEY, JSON.stringify({ build: target, at: now })); } catch { return; } // cannot remember the attempt: not safe to repeat
  applyUpdate();
}

/** Ask a service worker which build it belongs to. Resolves null if it does not answer. */
function askBuild(worker: ServiceWorker): Promise<string | null> {
  return new Promise(resolve => {
    try {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(null), 2500);
      channel.port1.onmessage = e => {
        clearTimeout(timer);
        resolve(typeof e.data?.build === 'string' ? e.data.build : null);
      };
      worker.postMessage({ type: 'GET_BUILD' }, [channel.port2]);
    } catch {
      resolve(null);
    }
  });
}

/** Look at the waiting worker and decide: silent activation (same build) or a prompt (different build). */
async function inspectWaiting(r: ServiceWorkerRegistration, manual = false) {
  const waiting = r.waiting;
  if (!waiting || !navigator.serviceWorker.controller) return;
  const build = await askBuild(waiting);
  if (build && build === APP_BUILD) {
    waiting.postMessage({ type: 'SKIP_WAITING' }); // same code as you are running: nothing to tell you about
    return;
  }
  waitingBuild = build;
  if (!manual && build && build === dismissedBuild) { considerAutoApply(); return; }
  set({ available: true, upToDate: false });
  considerAutoApply();
}

function waitUntilInstalled(worker: ServiceWorker | null, ms = 10000): Promise<void> {
  return new Promise(resolve => {
    if (!worker || worker.state === 'installed' || worker.state === 'activated') return resolve();
    const timer = setTimeout(resolve, ms);
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' || worker.state === 'redundant') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

/** The build id the site is serving right now (version.json, never cached), or null when it cannot be read. */
async function fetchSiteBuild(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    return res.ok ? parseVersion(await res.json()) : null;
  } catch {
    return null; // offline, or a dev server without the file
  }
}

/** Ask the server whether a new version exists. `manual` = the user tapped "Check for updates". */
export async function checkForUpdate(manual = false): Promise<void> {
  const now = Date.now();
  if (!manual && now - lastCheck < CHECK_EVERY) return;
  if (!reg && !import.meta.env.PROD) return;
  lastCheck = now;
  if (manual) set({ checking: true, upToDate: false });
  try {
    // 1) the site itself says which build it is serving: works with or without a service worker
    siteBuild = await fetchSiteBuild();
    if (shouldPrompt({ appBuild: APP_BUILD, remoteBuild: siteBuild, dismissed: dismissedBuild, manual })) { set({ available: true, upToDate: false }); considerAutoApply(); }
    // 2) a service worker that has already downloaded a different build
    if (reg) {
      await reg.update();
      await waitUntilInstalled(reg.installing);
      await inspectWaiting(reg, manual);
    }
    if (manual) set({ upToDate: !snapshot.available });
  } catch {
    lastCheck = 0;
  } finally {
    if (manual) set({ checking: false });
  }
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', async () => {
    try {
      reg = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }); // the worker file itself is always asked for, never taken from the HTTP cache
    } catch (err) {
      console.warn('Service worker not registered:', err);
      return;
    }
    const r = reg;
    void inspectWaiting(r); // an update that arrived while the app was closed
    setTimeout(() => void checkForUpdate(false), 4000); // and ask the site once the app has settled

    r.addEventListener('updatefound', () => {
      const installing = r.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed') void inspectWaiting(r);
      });
    });

    // Only reload when YOU asked for the update (the very first install also changes the controller)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (applying && !reloading) { reloading = true; window.location.reload(); }
    });

    // iOS home-screen apps stay alive for days; look for updates whenever you come back to the app
    const check = () => void checkForUpdate(false);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (document.visibilityState === 'visible') {
        resume = { at: Date.now(), hiddenFor: hiddenAt ? Date.now() - hiddenAt : 0 };
        if (snapshot.available) considerAutoApply(); // an update found while the app was in the background
        if (resume.hiddenFor >= 5 * 60_000) lastCheck = 0; // away for a while: ask the site now, not at the next 10-minute mark
        check();
      }
    });
    window.addEventListener('online', check);
    setInterval(check, 30 * 60 * 1000);
  });
}

/** Install the downloaded update and reload into it. */
export function applyUpdate() {
  applying = true;
  const waiting = reg?.waiting;
  if (waiting) {
    waiting.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(() => { if (!reloading) { reloading = true; window.location.reload(); } }, 3000); // safety net if the browser never reports the switch
  } else {
    // Nothing downloaded yet (the site said there is a newer build, e.g. after a hard refresh): let the worker look once, then reload
    const go = () => { if (!reloading) { reloading = true; window.location.reload(); } };
    void Promise.race([reg?.update() ?? Promise.resolve(), new Promise(r => setTimeout(r, 2500))]).catch(() => {}).then(go);
  }
}

/** "Not now": hide the banner until a different build is released. */
export function dismissUpdate() {
  if (siteBuild) {
    dismissedBuild = siteBuild;
    try { sessionStorage.setItem('rl-dismissed-build', siteBuild); } catch {}
  }
  const w = reg?.waiting;
  if (w) {
    void askBuild(w).then(b => {
      if (!b) return;
      dismissedBuild = b;
      try { sessionStorage.setItem('rl-dismissed-build', b); } catch {}
    });
  }
  set({ available: false });
}

/** Restart the app. Installs a downloaded update if there is one; otherwise just reloads. */
export function restartApp() {
  applyUpdate();
}
