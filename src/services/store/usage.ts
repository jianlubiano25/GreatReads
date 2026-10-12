/**
 * GreatReads' own usage data (what readers of THIS app add, start and finish) is not collected yet, so there is nothing to
 * report. When it exists, register a provider here: the Trending score picks it up automatically as one more signal.
 * Until then it is simply absent, and the other signals are re-weighted to fill the gap. Nothing is invented.
 *
 * A provider returns, per book key (see bookKey in books/identity.ts), a non-negative activity count, or null when unavailable.
 */
export type UsageSignals = Map<string, number>;
export type UsageProvider = () => UsageSignals | null;

let provider: UsageProvider | null = null;
export const setUsageProvider = (p: UsageProvider | null) => { provider = p; };
export const readUsage = (): UsageSignals | null => {
  try { return provider ? provider() : null; } catch { return null; }
};
