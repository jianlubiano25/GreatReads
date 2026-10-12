/**
 * When to tell the reader a newer version exists. Pure, so it can be tested without a browser.
 *
 * Two independent signals feed the prompt (see appUpdate.ts): a waiting service worker, and the site's own version.json (written at
 * build time with the same build id the running app was built with). The second one does not depend on a service worker being active,
 * so a hard refresh, a browser that is not letting the worker control the page, or a worker that failed to update cannot hide an update.
 */
export function shouldPrompt(o: { appBuild: string; remoteBuild: string | null; dismissed: string; manual: boolean }): boolean {
  const { appBuild, remoteBuild, dismissed, manual } = o;
  if (!remoteBuild || appBuild === 'dev') return false; // nothing to compare with / running a dev server
  if (remoteBuild === appBuild) return false; // same code: a redeploy of unchanged files never bothers anyone
  return manual || remoteBuild !== dismissed; // "Later" is remembered for that build, but "Check for updates" always answers
}

/** Reads the build id out of version.json's content. Anything that is not a short id string is ignored. */
export function parseVersion(data: unknown): string | null {
  const b = (data as { build?: unknown } | null)?.build;
  return typeof b === 'string' && /^[a-z0-9-]{4,40}$/i.test(b) ? b : null;
}

/* ------------------------------ applying an update without being asked ------------------------------ */

export interface AutoUpdateInput {
  appBuild: string;
  /** The newer build that is available (the site's version.json, or the waiting service worker's), or null when none is known */
  targetBuild: string | null;
  online: boolean;
  /** ms since the page started loading (performance.now()): a freshly opened app has not been used yet */
  msSinceLaunch: number;
  /** ms the app was in the background just before it came back to the front (0 when it did not just come back) */
  hiddenForMs: number;
  /** A text field has focus or a sheet / dialog is open: something is in progress */
  busy: boolean;
  /** The last automatic reload made for an update (kept on the device), so one build is tried only once */
  tried: { build: string; at: number } | null;
  now: number;
}
export type AutoUpdateAction = 'reload' | 'prompt' | 'none';

/** A freshly opened app, or one that was away for this long, is at a natural pause: nothing the reader was doing is lost by reloading. */
export const AUTO_LAUNCH_WINDOW_MS = 20_000;
export const AUTO_AWAY_MS = 5 * 60_000;
/** After an automatic attempt for a build, the reader is asked instead (never a second automatic reload) for this long: no reload loop, whatever the network does. */
export const AUTO_RETRY_AFTER_MS = 6 * 60 * 60_000;

/**
 * What to do about a newer build:
 *  - 'reload': apply it now (only at a natural pause, offline-safe, never twice for the same build)
 *  - 'prompt': show the "new version" banner and let the reader choose the moment
 *  - 'none': nothing newer
 * Pure, so the loop and interruption rules are tested without a browser.
 */
export function autoUpdatePlan(i: AutoUpdateInput): AutoUpdateAction {
  if (!i.targetBuild || i.appBuild === 'dev' || i.targetBuild === i.appBuild) return 'none';
  if (i.tried && i.tried.build === i.targetBuild && i.now - i.tried.at < AUTO_RETRY_AFTER_MS) return 'prompt'; // tried already: never a loop
  if (!i.online || i.busy) return 'prompt';
  const naturalPause = i.msSinceLaunch <= AUTO_LAUNCH_WINDOW_MS || i.hiddenForMs >= AUTO_AWAY_MS;
  return naturalPause ? 'reload' : 'prompt';
}

/** The saved record of the last automatic reload, read defensively (anything unexpected counts as "never tried"). */
export function parseTried(raw: string | null): { build: string; at: number } | null {
  try {
    const v = JSON.parse(raw || 'null');
    return v && typeof v.build === 'string' && typeof v.at === 'number' && Number.isFinite(v.at) ? { build: v.build, at: v.at } : null;
  } catch {
    return null;
  }
}
