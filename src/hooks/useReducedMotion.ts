import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';
const subscribe = (cb: () => void) => {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener?.('change', cb);
  return () => mq.removeEventListener?.('change', cb);
};
const get = () => (typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches);

/** True when the device asks for less motion (iOS: Settings > Accessibility > Motion > Reduce Motion). */
export const useReducedMotion = (): boolean => useSyncExternalStore(subscribe, get, () => false);
