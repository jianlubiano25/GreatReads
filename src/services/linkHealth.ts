/**
 * Is the live-update connection still alive? A phone that was asleep can leave a socket that still says "open" but delivers nothing.
 * We note the last time ANY message arrived from the server (heartbeat replies count); if nothing was heard for too long, or the
 * server said the channel failed, the connection is treated as dead and rebuilt.
 */
export type LinkHealth = {
  opened: (at: number) => void;
  heard: (at: number) => void;
  channelFailed: () => void;
  /** True when the connection should be thrown away and rebuilt. */
  shouldRebuild: (at: number, socketOpen: boolean) => boolean;
};

export function createLinkHealth(staleAfterMs = 60_000): LinkHealth {
  let lastHeard = -1, failed = false;
  return {
    opened: at => { lastHeard = at; failed = false; },
    heard: at => { lastHeard = at; },
    channelFailed: () => { failed = true; },
    shouldRebuild: (at, socketOpen) => !socketOpen || failed || (lastHeard >= 0 && at - lastHeard > staleAfterMs),
  };
}
