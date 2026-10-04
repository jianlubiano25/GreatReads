/** "YYYY-MM-DD" in the device's local time. Built by hand so it never depends on locale data. */
export function dateKey(d: Date = new Date()): string {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? '0' : ''}${m}-${day < 10 ? '0' : ''}${day}`;
}

export const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Whole-day number (days since 1970) for a date key, or NaN when the key is not a date. */
export function dayNumber(key: string): number {
  if (!DATE_KEY_RE.test(key)) return NaN;
  return Math.round(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 86_400_000);
}
