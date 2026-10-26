/**
 * A "one at a time" lock that cannot get stuck.
 *
 * The sync rounds used a plain true/false flag. If one request hung (an iPhone/iPad app that was suspended mid-request does this),
 * the flag stayed true forever and every later sync was silently skipped until the app was force-closed.
 * This lock gives up on a holder after `maxHoldMs` and lets the next caller in. The old holder's late `leave` is then ignored
 * (it carries its own ticket), so it can never release a newer run's lock.
 */
export type RunGate = { enter: () => number; leave: (ticket: number) => void; busy: () => boolean };

export function createRunGate(maxHoldMs = 60_000, now: () => number = Date.now): RunGate {
  let ticket = 0, holder = 0, since = 0;
  const busy = () => holder !== 0 && now() - since < maxHoldMs;
  return {
    /** Returns a ticket (always > 0) when this caller may run, or 0 when another run still holds the lock. */
    enter: () => { if (busy()) return 0; holder = ++ticket; since = now(); return holder; },
    leave: t => { if (t !== 0 && t === holder) holder = 0; },
    busy,
  };
}
