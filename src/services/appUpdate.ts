/**
 * "New version available" detection.
 *
 * Every build gets an id made from its source files (see vite.config.ts). The running app knows its own id
 * (APP_BUILD) and the service worker knows the id it was built with. A prompt is shown ONLY when a newer
 * service worker is waiting AND its id differs from the one you are running. A worker that merely has different
 * bytes (a redeploy of the same code, a changed asset list) is activated silently and never bothers you.
 */
import { useSyncExternalStore } from 'react';

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
let dismissedBuild = '';
let lastCheck = 0;
const CHECK_EVERY = 10 * 60 * 1000;

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
async function inspectWaiting(r: ServiceWorkerRegistration) {
  const waiting = r.waiting;
  if (!waiting || !navigator.serviceWorker.controller) return;
  const build = await askBuild(waiting);
  if (build && build === APP_BUILD) {
    waiting.postMessage({ type: 'SKIP_WAITING' }); // same code as you are running: nothing to tell you about
    return;
  }
  if (build && build === dismissedBuild) return; // you already said "later" to this one
  set({ available: true, upToDate: false });
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

/** Ask the server whether a new version exists. `manual` = the user tapped "Check for updates". */
export async function checkForUpdate(manual = false): Promise<void> {
  if (!reg) return;
  const now = Date.now();
  if (!manual && now - lastCheck < CHECK_EVERY) return;
  lastCheck = now;
  if (manual) set({ checking: true, upToDate: false });
  try {
    await reg.update();
    await waitUntilInstalled(reg.installing);
    await inspectWaiting(reg);
    if (manual) set({ upToDate: !snapshot.available });
  } catch {
    // offline or blocked: say nothing
  } finally {
    if (manual) set({ checking: false });
  }
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', async () => {
    try {
      reg = await navigator.serviceWorker.register('/sw.js');
    } catch (err) {
      console.warn('Service worker not registered:', err);
      return;
    }
    const r = reg;
    void inspectWaiting(r); // an update that arrived while the app was closed

    r.addEventListener('updatefound', () => {
      const installing = r.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed') void inspectWaiting(r);
      });
    });

    // Only reload when YOU asked for the update (the very first install also changes the controller)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (applying) window.location.reload();
    });

    // iOS home-screen apps stay alive for days; look for updates whenever you come back to the app
    const check = () => void checkForUpdate(false);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
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
    setTimeout(() => window.location.reload(), 3000); // safety net if the browser never reports the switch
  } else {
    window.location.reload();
  }
}

/** "Not now": hide the banner until a different build is released. */
export function dismissUpdate() {
  const w = reg?.waiting;
  if (w) {
    void askBuild(w).then(b => { if (b) dismissedBuild = b; });
  }
  set({ available: false });
}

/** Restart the app. Installs a downloaded update if there is one; otherwise just reloads. */
export function restartApp() {
  applyUpdate();
}
